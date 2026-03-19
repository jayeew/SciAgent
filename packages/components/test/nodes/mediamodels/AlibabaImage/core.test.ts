import { secureAxiosRequest, secureFetch } from '../../../../src/httpSecurity'
import { addSingleFileToStorage, getFileFromStorage } from '../../../../src/storageUtils'
import {
    AlibabaImageModel,
    DEFAULT_ALIBABA_IMAGE_MODEL,
    normalizeAlibabaImageCount,
    normalizeAlibabaImageSize,
    normalizeAlibabaPromptExtend,
    normalizeAlibabaSeed,
    resolveAlibabaImageGenerationArgs
} from '../../../../nodes/mediamodels/AlibabaImage/core'

jest.mock('../../../../src/httpSecurity', () => ({
    secureAxiosRequest: jest.fn(),
    secureFetch: jest.fn()
}))

jest.mock('../../../../src/storageUtils', () => ({
    addSingleFileToStorage: jest.fn(),
    getFileFromStorage: jest.fn()
}))

const mockedSecureAxiosRequest = secureAxiosRequest as jest.MockedFunction<typeof secureAxiosRequest>
const mockedSecureFetch = secureFetch as jest.MockedFunction<typeof secureFetch>
const mockedAddSingleFileToStorage = addSingleFileToStorage as jest.MockedFunction<typeof addSingleFileToStorage>
const mockedGetFileFromStorage = getFileFromStorage as jest.MockedFunction<typeof getFileFromStorage>

const createDownloadResponse = (contentType: string, body: string = 'image-bytes') =>
    ({
        ok: true,
        status: 200,
        headers: {
            get: (header: string) => (header === 'content-type' ? contentType : null)
        },
        arrayBuffer: async () => Buffer.from(body)
    } as any)

const createModel = (overrides: Partial<ConstructorParameters<typeof AlibabaImageModel>[0]> = {}) =>
    new AlibabaImageModel({
        apiKey: 'alibaba-key',
        credentialId: 'credential-1',
        model: DEFAULT_ALIBABA_IMAGE_MODEL,
        imageCount: 1,
        promptExtend: true,
        watermark: false,
        chatflowid: 'flow-1',
        orgId: 'org-1',
        ...overrides
    })

describe('AlibabaImage helpers', () => {
    it('normalizes supported size separators and rejects invalid sizes', () => {
        expect(normalizeAlibabaImageSize('2048x2048')).toBe('2048*2048')
        expect(normalizeAlibabaImageSize('1536*1024')).toBe('1536*1024')
        expect(() => normalizeAlibabaImageSize('1033*1032')).toThrow('multiples of 16')
        expect(() => normalizeAlibabaImageSize('4096*2048')).toThrow('Total pixels')
        expect(() => normalizeAlibabaImageSize('square')).toThrow('Unsupported Alibaba image size')
    })

    it('normalizes image count, prompt extend, and seed inputs', () => {
        expect(normalizeAlibabaImageCount()).toBe(1)
        expect(normalizeAlibabaImageCount(6)).toBe(6)
        expect(() => normalizeAlibabaImageCount(7)).toThrow('between 1 and 6')
        expect(normalizeAlibabaPromptExtend()).toBe(true)
        expect(normalizeAlibabaPromptExtend(false)).toBe(false)
        expect(normalizeAlibabaSeed(0)).toBe(0)
        expect(() => normalizeAlibabaSeed(2147483648)).toThrow('Seed must be between 0 and 2147483647')
    })

    it('resolves runtime args over node defaults', () => {
        const resolved = resolveAlibabaImageGenerationArgs(
            {
                prompt: '  surreal city skyline  ',
                size: '1536x1024',
                imageCount: 2,
                negativePrompt: ' blur ',
                promptExtend: false,
                watermark: true,
                seed: 42
            },
            {
                model: 'custom-model',
                imageCount: 1,
                promptExtend: true,
                watermark: false
            }
        )

        expect(resolved).toEqual({
            prompt: 'surreal city skyline',
            model: 'custom-model',
            size: '1536*1024',
            imageCount: 2,
            negativePrompt: 'blur',
            promptExtend: false,
            watermark: true,
            seed: 42
        })
    })
})

describe('AlibabaImageModel', () => {
    beforeEach(() => {
        jest.resetAllMocks()
        jest.spyOn(Date, 'now').mockReturnValue(1700000000000)
    })

    afterEach(() => {
        jest.restoreAllMocks()
    })

    it('keeps text-to-image payload unchanged when no reference image is provided', async () => {
        mockedSecureAxiosRequest.mockResolvedValue({
            status: 200,
            data: {
                output: {
                    choices: [
                        {
                            message: {
                                content: [{ image: 'https://example.com/generated.png' }]
                            }
                        }
                    ]
                },
                usage: {
                    image_count: 1,
                    width: 2048,
                    height: 2048
                }
            }
        } as any)

        const result = await createModel({ chatflowid: undefined, orgId: undefined }).invoke({
            prompt: 'Draw a neon fox'
        })

        expect(mockedSecureAxiosRequest).toHaveBeenCalledWith(
            expect.objectContaining({
                data: {
                    model: DEFAULT_ALIBABA_IMAGE_MODEL,
                    input: {
                        messages: [
                            {
                                role: 'user',
                                content: [{ text: 'Draw a neon fox' }]
                            }
                        ]
                    },
                    parameters: {
                        n: 1,
                        prompt_extend: true,
                        watermark: false
                    }
                }
            })
        )
        expect(result.artifacts).toEqual([{ type: 'png', data: 'https://example.com/generated.png' }])
        expect(result.mediaBilling).toEqual({
            provider: 'alibaba-dashscope',
            credentialId: 'credential-1',
            model: DEFAULT_ALIBABA_IMAGE_MODEL,
            source: 'media_generation',
            billingMode: 'image_count',
            usage: {
                units: 1
            }
        })
    })

    it('sends a stored-file reference image as a data URI and omits size when editing without an explicit size', async () => {
        mockedGetFileFromStorage.mockResolvedValue(Buffer.from('stored-image'))
        mockedSecureAxiosRequest.mockResolvedValue({
            status: 200,
            data: {
                output: {
                    choices: [
                        {
                            message: {
                                content: [{ image: 'https://example.com/generated.png' }]
                            }
                        }
                    ]
                },
                usage: {
                    image_count: 1,
                    width: 1024,
                    height: 1024
                }
            }
        } as any)
        mockedSecureFetch.mockResolvedValue(createDownloadResponse('image/png'))
        mockedAddSingleFileToStorage.mockResolvedValue({
            path: 'FILE-STORAGE::alibaba_generated_image_1700000000000_1.png'
        } as any)

        const result = await createModel().invoke(
            {
                prompt: 'Add a handwritten poem in the corner',
                referenceImages: [
                    {
                        type: 'stored-file',
                        name: 'FILE-STORAGE::reference.png',
                        mime: 'image/png',
                        data: ''
                    }
                ]
            },
            {
                chatId: 'chat-1'
            }
        )

        expect(mockedSecureAxiosRequest).toHaveBeenCalledWith(
            expect.objectContaining({
                data: {
                    model: DEFAULT_ALIBABA_IMAGE_MODEL,
                    input: {
                        messages: [
                            {
                                role: 'user',
                                content: [
                                    {
                                        image: 'data:image/png;base64,c3RvcmVkLWltYWdl'
                                    },
                                    {
                                        text: 'Add a handwritten poem in the corner'
                                    }
                                ]
                            }
                        ]
                    },
                    parameters: {
                        n: 1,
                        prompt_extend: true,
                        watermark: false
                    }
                }
            })
        )
        expect(result.artifacts).toEqual([{ type: 'png', data: 'FILE-STORAGE::alibaba_generated_image_1700000000000_1.png' }])
    })

    it('sends multiple reference images in order for multi-image fusion', async () => {
        mockedSecureAxiosRequest.mockResolvedValue({
            status: 200,
            data: {
                output: {
                    choices: [
                        {
                            message: {
                                content: [{ image: 'https://example.com/generated.png' }]
                            }
                        }
                    ]
                },
                usage: {
                    image_count: 1
                }
            }
        } as any)

        await createModel({ chatflowid: undefined, orgId: undefined }).invoke({
            prompt: 'Blend the character into the city scene',
            referenceImages: [
                {
                    type: 'url',
                    name: 'scene',
                    mime: 'image/png',
                    data: 'https://example.com/scene.png'
                },
                {
                    type: 'url',
                    name: 'character',
                    mime: 'image/png',
                    data: 'https://example.com/character.png'
                }
            ]
        })

        expect(mockedSecureAxiosRequest).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    input: {
                        messages: [
                            {
                                role: 'user',
                                content: [
                                    { image: 'https://example.com/scene.png' },
                                    { image: 'https://example.com/character.png' },
                                    { text: 'Blend the character into the city scene' }
                                ]
                            }
                        ]
                    }
                })
            })
        )
    })

    it('rejects more than three reference images before calling Alibaba', async () => {
        await expect(
            createModel({ chatflowid: undefined, orgId: undefined }).invoke({
                prompt: 'Too many images',
                referenceImages: [
                    { type: 'url', name: '1', mime: 'image/png', data: 'https://example.com/1.png' },
                    { type: 'url', name: '2', mime: 'image/png', data: 'https://example.com/2.png' },
                    { type: 'url', name: '3', mime: 'image/png', data: 'https://example.com/3.png' },
                    { type: 'url', name: '4', mime: 'image/png', data: 'https://example.com/4.png' }
                ]
            })
        ).rejects.toThrow('supports up to 3 reference images')

        expect(mockedSecureAxiosRequest).not.toHaveBeenCalled()
    })

    it('prefers usage.image_count for billing but falls back to artifact count when usage is absent', async () => {
        mockedSecureAxiosRequest.mockResolvedValueOnce({
            status: 200,
            data: {
                output: {
                    choices: [
                        {
                            message: {
                                content: [
                                    { image: 'https://example.com/generated-1.png' },
                                    { image: 'https://example.com/generated-2.png' }
                                ]
                            }
                        }
                    ]
                },
                usage: {
                    image_count: 2
                }
            }
        } as any)

        const resultWithUsage = await createModel({ chatflowid: undefined, orgId: undefined }).invoke({
            prompt: 'Generate two posters',
            imageCount: 2
        })
        expect(resultWithUsage.mediaBilling?.usage.units).toBe(2)

        mockedSecureAxiosRequest.mockResolvedValueOnce({
            status: 200,
            data: {
                output: {
                    choices: [
                        {
                            message: {
                                content: [
                                    { image: 'https://example.com/generated-1.png' },
                                    { image: 'https://example.com/generated-2.png' }
                                ]
                            }
                        }
                    ]
                },
                usage: {
                    width: 1024,
                    height: 1024
                }
            }
        } as any)

        const resultWithoutUsage = await createModel({ chatflowid: undefined, orgId: undefined }).invoke({
            prompt: 'Generate two thumbnails',
            imageCount: 2
        })
        expect(resultWithoutUsage.mediaBilling?.usage.units).toBe(2)
    })

    it('surfaces readable response bodies for non-2xx responses', async () => {
        mockedSecureAxiosRequest.mockResolvedValue({
            status: 400,
            data: {
                code: 'InvalidParameter',
                message: 'bad request'
            }
        } as any)

        await expect(
            createModel({ chatflowid: undefined, orgId: undefined }).invoke({
                prompt: 'bad prompt'
            })
        ).rejects.toThrow('InvalidParameter: bad request')
    })
})
