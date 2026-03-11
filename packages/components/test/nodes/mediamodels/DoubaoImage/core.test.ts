import { secureAxiosRequest, secureFetch } from '../../../../src/httpSecurity'
import { addSingleFileToStorage, getFileFromStorage } from '../../../../src/storageUtils'
import {
    DEFAULT_DOUBAO_IMAGE_MODEL,
    DoubaoImageModel,
    normalizeDoubaoImageSize,
    normalizeDoubaoOutputFormat,
    resolveDoubaoImageGenerationArgs
} from '../../../../nodes/mediamodels/DoubaoImage/core'

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

const createModel = (overrides: Partial<ConstructorParameters<typeof DoubaoImageModel>[0]> = {}) =>
    new DoubaoImageModel({
        apiKey: 'ark-key',
        credentialId: 'credential-1',
        model: DEFAULT_DOUBAO_IMAGE_MODEL,
        size: '2K',
        outputFormat: 'png',
        watermark: false,
        chatflowid: 'flow-1',
        orgId: 'org-1',
        ...overrides
    })

describe('DoubaoImage helpers', () => {
    it('normalizes jpg output format to jpeg', () => {
        expect(normalizeDoubaoOutputFormat('jpg')).toBe('jpeg')
        expect(normalizeDoubaoOutputFormat('jpeg')).toBe('jpeg')
        expect(normalizeDoubaoOutputFormat()).toBe('png')
    })

    it('normalizes doubao image size labels and legacy values to pixels', () => {
        expect(normalizeDoubaoImageSize('2K (4:3)')).toBe('2304x1728')
        expect(normalizeDoubaoImageSize('2048 x 1152')).toBe('2048x1152')
        expect(normalizeDoubaoImageSize('2K')).toBe('2048x2048')
    })

    it('resolves runtime args over node defaults', () => {
        const resolved = resolveDoubaoImageGenerationArgs(
            {
                prompt: '  future city poster  ',
                size: '1024x1024',
                outputFormat: 'jpg',
                watermark: true
            },
            {
                model: 'custom-model',
                size: '2K',
                outputFormat: 'png',
                watermark: false
            }
        )

        expect(resolved).toEqual({
            prompt: 'future city poster',
            model: 'custom-model',
            size: '1024x1024',
            outputFormat: 'jpeg',
            watermark: true
        })
    })
})

describe('DoubaoImageModel', () => {
    beforeEach(() => {
        jest.resetAllMocks()
        jest.spyOn(Date, 'now').mockReturnValue(1700000000000)
    })

    afterEach(() => {
        jest.restoreAllMocks()
    })

    it('advertises image-to-image capability', () => {
        expect(createModel().capabilities).toEqual({
            textToImage: true,
            imageToImage: true,
            multiTurnPrompting: true
        })
    })

    it('keeps text-to-image payload unchanged when no reference image is provided', async () => {
        mockedSecureAxiosRequest.mockResolvedValue({
            data: {
                model: DEFAULT_DOUBAO_IMAGE_MODEL,
                data: [{ url: 'https://example.com/generated.png', size: '2048x2048' }],
                usage: { generated_images: 1 }
            }
        } as any)

        const result = await createModel({ chatflowid: undefined, orgId: undefined }).invoke({
            prompt: 'Draw a neon fox'
        })

        expect(mockedSecureAxiosRequest).toHaveBeenCalledWith(
            expect.objectContaining({
                data: {
                    model: DEFAULT_DOUBAO_IMAGE_MODEL,
                    prompt: 'Draw a neon fox',
                    size: '2048x2048',
                    output_format: 'png',
                    watermark: false
                }
            })
        )
        expect(result.artifacts).toEqual([{ type: 'png', data: 'https://example.com/generated.png' }])
    })

    it('sends a single stored-file reference image as base64 for image-to-image', async () => {
        mockedGetFileFromStorage.mockResolvedValue(Buffer.from('base-image-binary'))
        mockedSecureAxiosRequest.mockResolvedValue({
            data: {
                model: DEFAULT_DOUBAO_IMAGE_MODEL,
                created: 1757321139,
                data: [{ url: 'https://example.com/image-1', size: '3104x1312' }],
                usage: { generated_images: 1, output_tokens: 5, total_tokens: 10 }
            }
        } as any)
        mockedSecureFetch.mockResolvedValue(createDownloadResponse('image/png'))
        mockedAddSingleFileToStorage.mockResolvedValue({
            path: 'FILE-STORAGE::doubao_generated_image_1700000000000_1.png',
            totalSize: 0.5
        })

        const result = await createModel().invoke(
            {
                prompt: 'Keep the pose but turn the outfit into clear water',
                referenceImages: [{ type: 'stored-file', name: 'base.png', mime: 'image/png' }]
            },
            { chatId: 'chat-1' }
        )

        expect(mockedGetFileFromStorage).toHaveBeenCalledWith('base.png', 'org-1', 'flow-1', 'chat-1')
        expect(mockedSecureAxiosRequest).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    image: `data:image/png;base64,${Buffer.from('base-image-binary').toString('base64')}`
                })
            })
        )
        expect(result.artifacts).toEqual([{ type: 'png', data: 'FILE-STORAGE::doubao_generated_image_1700000000000_1.png' }])
        expect(result.mediaBilling).toEqual({
            provider: 'doubao-ark',
            credentialId: 'credential-1',
            model: DEFAULT_DOUBAO_IMAGE_MODEL,
            source: 'media_generation',
            billingMode: 'image_count',
            usage: {
                units: 1
            }
        })
    })

    it('retries image-to-image requests with raw base64 when Ark returns a 5xx for data URI input', async () => {
        mockedGetFileFromStorage.mockResolvedValue(Buffer.from('base-image-binary'))
        mockedSecureAxiosRequest
            .mockResolvedValueOnce({
                status: 502,
                data: {
                    error: {
                        message: 'upstream connect error'
                    }
                }
            } as any)
            .mockResolvedValueOnce({
                status: 200,
                data: {
                    data: [{ url: 'https://example.com/generated.png', size: '1760x2368' }]
                }
            } as any)
        mockedSecureFetch.mockResolvedValue(createDownloadResponse('image/png'))
        mockedAddSingleFileToStorage.mockResolvedValue({
            path: 'FILE-STORAGE::doubao_generated_image_1700000000000_1.png',
            totalSize: 0.5
        })

        await createModel().invoke(
            {
                prompt: 'Edit this portrait',
                referenceImages: [{ type: 'stored-file', name: 'base.png', mime: 'image/png' }]
            },
            { chatId: 'chat-1' }
        )

        expect(mockedSecureAxiosRequest).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                data: expect.objectContaining({
                    image: `data:image/png;base64,${Buffer.from('base-image-binary').toString('base64')}`
                })
            })
        )
        expect(mockedSecureAxiosRequest).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                data: expect.objectContaining({
                    image: Buffer.from('base-image-binary').toString('base64')
                })
            })
        )
    })

    it('passes URL reference images through to the Doubao API', async () => {
        mockedSecureAxiosRequest.mockResolvedValue({
            data: {
                data: [{ url: 'https://example.com/generated.jpeg', size: '1760x2368' }]
            }
        } as any)

        const result = await createModel({ chatflowid: undefined, orgId: undefined }).invoke({
            prompt: 'Turn this portrait into an editorial poster',
            referenceImages: [
                {
                    type: 'url',
                    name: 'remote.png',
                    mime: 'image/png',
                    data: 'https://example.com/reference.png'
                }
            ]
        })

        expect(mockedSecureAxiosRequest).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    image: 'https://example.com/reference.png'
                })
            })
        )
        expect(result.artifacts).toEqual([{ type: 'png', data: 'https://example.com/generated.jpeg' }])
    })

    it('keeps code-level data URI reference images intact', async () => {
        mockedSecureAxiosRequest.mockResolvedValue({
            data: {
                data: [{ url: 'https://example.com/generated.png', size: '1760x2368' }]
            }
        } as any)

        await createModel({ chatflowid: undefined, orgId: undefined }).invoke({
            prompt: 'Turn this sketch into a polished illustration',
            referenceImages: [
                {
                    type: 'image',
                    name: 'inline.png',
                    mime: 'image/png',
                    data: 'data:image/png;base64,aGVsbG8='
                }
            ]
        })

        expect(mockedSecureAxiosRequest).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    image: 'data:image/png;base64,aGVsbG8='
                })
            })
        )
    })

    it('throws when more than one reference image is provided', async () => {
        await expect(
            createModel().invoke(
                {
                    prompt: 'Edit this image',
                    referenceImages: [
                        { type: 'stored-file', name: 'base-1.png', mime: 'image/png' },
                        { type: 'stored-file', name: 'base-2.png', mime: 'image/png' }
                    ]
                },
                { chatId: 'chat-1' }
            )
        ).rejects.toThrow('Doubao image-to-image supports exactly one reference image')

        expect(mockedSecureAxiosRequest).not.toHaveBeenCalled()
    })

    it('throws when a stored reference image cannot be loaded', async () => {
        mockedGetFileFromStorage.mockRejectedValue(new Error('missing file'))

        await expect(
            createModel().invoke(
                {
                    prompt: 'Edit this image',
                    referenceImages: [{ type: 'stored-file', name: 'missing.png', mime: 'image/png' }]
                },
                { chatId: 'chat-1' }
            )
        ).rejects.toThrow('missing file')

        expect(mockedSecureAxiosRequest).not.toHaveBeenCalled()
    })

    it('throws when prompt is empty', async () => {
        await expect(
            createModel({ chatflowid: undefined, orgId: undefined }).invoke({
                prompt: '   '
            })
        ).rejects.toThrow('Prompt is required')
    })

    it('surfaces readable response bodies for non-2xx responses', async () => {
        mockedSecureAxiosRequest.mockResolvedValue({
            status: 502,
            data: {
                error: {
                    message: 'upstream connect error or disconnect/reset before headers'
                }
            }
        } as any)

        await expect(
            createModel({ chatflowid: undefined, orgId: undefined }).invoke({
                prompt: 'Draw a poster'
            })
        ).rejects.toThrow('upstream connect error or disconnect/reset before headers')
    })
})
