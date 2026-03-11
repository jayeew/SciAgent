import { secureAxiosRequest, secureFetch } from '../../../../src/httpSecurity'
import { addSingleFileToStorage, getFileFromStorage } from '../../../../src/storageUtils'
import {
    DEFAULT_DOUBAO_VIDEO_MODEL,
    DoubaoVideoModel,
    DOUBAO_VIDEO_MAX_DURATION,
    normalizeDoubaoVideoModel,
    normalizeDoubaoVideoRatio,
    normalizeDoubaoVideoResolution,
    resolveDoubaoVideoGenerationArgs
} from '../../../../nodes/mediamodels/DoubaoVideo/core'

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

const createDownloadResponse = (contentType: string, body: string = 'video-bytes') =>
    ({
        ok: true,
        status: 200,
        headers: {
            get: (header: string) => (header === 'content-type' ? contentType : null)
        },
        arrayBuffer: async () => Buffer.from(body)
    } as any)

const createModel = (overrides: Partial<ConstructorParameters<typeof DoubaoVideoModel>[0]> = {}) =>
    new DoubaoVideoModel({
        apiKey: 'ark-key',
        credentialId: 'credential-1',
        model: DEFAULT_DOUBAO_VIDEO_MODEL,
        ratio: '16:9',
        resolution: '720p',
        duration: 5,
        cameraFixed: false,
        watermark: false,
        chatflowid: 'flow-1',
        orgId: 'org-1',
        ...overrides
    })

describe('DoubaoVideo helpers', () => {
    it('normalizes ratio and resolution values', () => {
        expect(normalizeDoubaoVideoRatio('16 : 9')).toBe('16:9')
        expect(normalizeDoubaoVideoResolution('720P')).toBe('720p')
    })

    it('normalizes legacy unversioned video model aliases', () => {
        expect(normalizeDoubaoVideoModel('doubao-seedance-1-5-pro')).toBe(DEFAULT_DOUBAO_VIDEO_MODEL)
        expect(normalizeDoubaoVideoModel('doubao-seedance-1-0-pro')).toBe('doubao-seedance-1-0-pro-250528')
    })

    it('resolves runtime args over node defaults', () => {
        const resolved = resolveDoubaoVideoGenerationArgs(
            {
                prompt: '  小猫对着镜头打哈欠  ',
                ratio: '9 : 16',
                resolution: '1080P',
                duration: 8,
                seed: 11,
                cameraFixed: true,
                watermark: true
            },
            {
                model: 'custom-model',
                ratio: '16:9',
                resolution: '720p',
                duration: 5,
                watermark: false
            }
        )

        expect(resolved).toEqual({
            prompt: '小猫对着镜头打哈欠',
            model: 'custom-model',
            ratio: '9:16',
            resolution: '1080p',
            duration: 8,
            seed: 11,
            cameraFixed: true,
            watermark: true
        })
    })

    it('throws when duration is outside the supported range', () => {
        expect(() =>
            resolveDoubaoVideoGenerationArgs(
                {
                    prompt: '海边镜头',
                    duration: DOUBAO_VIDEO_MAX_DURATION + 1
                },
                {
                    model: 'doubao-seedance-1-5-pro'
                }
            )
        ).toThrow(`Duration must be between 2 and ${DOUBAO_VIDEO_MAX_DURATION} seconds for model ${DEFAULT_DOUBAO_VIDEO_MODEL}`)
    })
})

describe('DoubaoVideoModel', () => {
    beforeEach(() => {
        jest.resetAllMocks()
        jest.spyOn(Date, 'now').mockReturnValue(1700000000000)
    })

    afterEach(() => {
        jest.restoreAllMocks()
    })

    it('advertises text-to-video capability', () => {
        expect(createModel().capabilities).toEqual({
            textToVideo: true,
            imageToVideo: true,
            multiTurnPrompting: true
        })
    })

    it('creates a text-to-video task, polls it, and returns a remote video URL without storage context', async () => {
        mockedSecureAxiosRequest
            .mockResolvedValueOnce({
                data: {
                    id: 'cgt-2025-task-1'
                }
            } as any)
            .mockResolvedValueOnce({
                data: {
                    id: 'cgt-2025-task-1',
                    model: DEFAULT_DOUBAO_VIDEO_MODEL,
                    status: 'succeeded',
                    content: {
                        video_url: 'https://example.com/generated.mp4'
                    },
                    usage: {
                        completion_tokens: 108900,
                        total_tokens: 108900
                    },
                    ratio: '16:9',
                    resolution: '720p',
                    duration: 5
                }
            } as any)

        const result = await createModel({ chatflowid: undefined, orgId: undefined }).invoke({
            prompt: '写实风格的海边日出镜头'
        })

        expect(mockedSecureAxiosRequest).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                method: 'POST',
                data: {
                    model: DEFAULT_DOUBAO_VIDEO_MODEL,
                    content: [{ type: 'text', text: '写实风格的海边日出镜头' }],
                    resolution: '720p',
                    ratio: '16:9',
                    duration: 5,
                    camera_fixed: false,
                    watermark: false
                }
            })
        )
        expect(mockedSecureAxiosRequest).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                method: 'GET',
                url: expect.stringContaining('/contents/generations/tasks/cgt-2025-task-1')
            })
        )
        expect(result.artifacts).toEqual([{ type: 'mp4', data: 'https://example.com/generated.mp4' }])
        expect(result.metadata).toEqual(
            expect.objectContaining({
                mediaType: 'video',
                videoCount: 1,
                ratio: '16:9',
                resolution: '720p',
                duration: 5
            })
        )
        expect(result.mediaBilling).toEqual({
            provider: 'doubao-ark',
            credentialId: 'credential-1',
            model: DEFAULT_DOUBAO_VIDEO_MODEL,
            source: 'media_generation',
            billingMode: 'token',
            usage: {
                outputTokens: 108900,
                totalTokens: 108900
            }
        })
    })

    it('downloads and stores the generated video when chat storage context exists', async () => {
        mockedSecureAxiosRequest
            .mockResolvedValueOnce({
                data: {
                    id: 'cgt-2025-task-2'
                }
            } as any)
            .mockResolvedValueOnce({
                data: {
                    id: 'cgt-2025-task-2',
                    model: DEFAULT_DOUBAO_VIDEO_MODEL,
                    status: 'succeeded',
                    content: {
                        video_url: 'https://example.com/generated.mp4'
                    },
                    ratio: '16:9',
                    resolution: '720p',
                    duration: 5
                }
            } as any)
        mockedSecureFetch.mockResolvedValue(createDownloadResponse('video/mp4'))
        mockedAddSingleFileToStorage.mockResolvedValue({
            path: 'FILE-STORAGE::doubao_generated_video_1700000000000.mp4',
            totalSize: 1.5
        })

        const result = await createModel().invoke(
            {
                prompt: '小猫对着镜头打哈欠'
            },
            { chatId: 'chat-1' }
        )

        expect(mockedSecureFetch).toHaveBeenCalledWith('https://example.com/generated.mp4', { method: 'GET' })
        expect(mockedAddSingleFileToStorage).toHaveBeenCalledWith(
            'video/mp4',
            expect.any(Buffer),
            'doubao_generated_video_1700000000000.mp4',
            'org-1',
            'flow-1',
            'chat-1'
        )
        expect(result.artifacts).toEqual([{ type: 'mp4', data: 'FILE-STORAGE::doubao_generated_video_1700000000000.mp4' }])
    })

    it('normalizes a URL reference image before sending first-frame guidance for image-to-video', async () => {
        mockedSecureAxiosRequest
            .mockResolvedValueOnce({
                data: {
                    id: 'cgt-2025-task-2-url'
                }
            } as any)
            .mockResolvedValueOnce({
                data: {
                    id: 'cgt-2025-task-2-url',
                    model: DEFAULT_DOUBAO_VIDEO_MODEL,
                    status: 'succeeded',
                    content: {
                        video_url: 'https://example.com/generated.mp4'
                    },
                    ratio: '16:9',
                    resolution: '720p',
                    duration: 5
                }
            } as any)

        const result = await createModel({ chatflowid: undefined, orgId: undefined }).invoke({
            prompt: '镜头从女孩和狐狸缓慢拉远',
            referenceImages: [
                {
                    type: 'url',
                    name: 'first-frame.png',
                    mime: 'image/png',
                    data: 'https://example.com/first frame.png\n# clipboard metadata'
                }
            ]
        })

        expect(mockedSecureAxiosRequest).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                data: expect.objectContaining({
                    content: [
                        { type: 'text', text: '镜头从女孩和狐狸缓慢拉远' },
                        {
                            type: 'image_url',
                            image_url: {
                                url: 'https://example.com/first%20frame.png'
                            }
                        }
                    ]
                })
            })
        )
        expect(result.artifacts).toEqual([{ type: 'mp4', data: 'https://example.com/generated.mp4' }])
    })

    it('rejects non-http reference frame URLs before calling Doubao', async () => {
        await expect(
            createModel({ chatflowid: undefined, orgId: undefined }).invoke({
                prompt: '镜头从女孩和狐狸缓慢拉远',
                referenceImages: [
                    {
                        type: 'url',
                        name: 'first-frame.png',
                        mime: 'image/png',
                        data: 'blob:https://example.com/first-frame.png'
                    }
                ]
            })
        ).rejects.toThrow('Doubao image-to-video reference image URL must use http or https')

        expect(mockedSecureAxiosRequest).not.toHaveBeenCalled()
    })

    it('loads stored-file reference image and sends it as data URI for image-to-video', async () => {
        mockedGetFileFromStorage.mockResolvedValue(Buffer.from('first-frame-bytes'))
        mockedSecureFetch.mockResolvedValue(createDownloadResponse('video/mp4'))
        mockedAddSingleFileToStorage.mockResolvedValue({
            path: 'FILE-STORAGE::doubao_generated_video_1700000000000.mp4',
            totalSize: 1.5
        })
        mockedSecureAxiosRequest
            .mockResolvedValueOnce({
                data: {
                    id: 'cgt-2025-task-2-file'
                }
            } as any)
            .mockResolvedValueOnce({
                data: {
                    id: 'cgt-2025-task-2-file',
                    model: DEFAULT_DOUBAO_VIDEO_MODEL,
                    status: 'succeeded',
                    content: {
                        video_url: 'https://example.com/generated.mp4'
                    },
                    ratio: '16:9',
                    resolution: '720p',
                    duration: 5
                }
            } as any)

        const result = await createModel().invoke(
            {
                prompt: '镜头从女孩和狐狸缓慢拉远',
                referenceImages: [{ type: 'stored-file', name: 'first-frame.png', mime: 'image/png' }]
            },
            { chatId: 'chat-1' }
        )

        expect(mockedGetFileFromStorage).toHaveBeenCalledWith('first-frame.png', 'org-1', 'flow-1', 'chat-1')
        expect(mockedSecureAxiosRequest).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                data: expect.objectContaining({
                    content: [
                        { type: 'text', text: '镜头从女孩和狐狸缓慢拉远' },
                        {
                            type: 'image_url',
                            image_url: {
                                url: `data:image/png;base64,${Buffer.from('first-frame-bytes').toString('base64')}`
                            }
                        }
                    ]
                })
            })
        )
        expect(result.artifacts).toEqual([{ type: 'mp4', data: 'FILE-STORAGE::doubao_generated_video_1700000000000.mp4' }])
    })

    it('throws when more than one reference image is provided for image-to-video', async () => {
        await expect(
            createModel().invoke(
                {
                    prompt: '生成一段视频',
                    referenceImages: [
                        { type: 'stored-file', name: 'first-frame-1.png', mime: 'image/png' },
                        { type: 'stored-file', name: 'first-frame-2.png', mime: 'image/png' }
                    ]
                },
                { chatId: 'chat-1' }
            )
        ).rejects.toThrow('Doubao image-to-video supports exactly one reference image')

        expect(mockedSecureAxiosRequest).not.toHaveBeenCalled()
    })

    it('throws when prompt is empty', async () => {
        await expect(
            createModel({ chatflowid: undefined, orgId: undefined }).invoke({
                prompt: '   '
            })
        ).rejects.toThrow('Prompt is required')
    })

    it('throws when both duration and frames are missing', async () => {
        await expect(
            createModel({ duration: undefined, frames: undefined }).invoke({
                prompt: '小狗在草地上奔跑',
                duration: undefined,
                frames: undefined
            })
        ).rejects.toThrow('Either duration or frames is required')
    })

    it('surfaces failed task responses with readable messages', async () => {
        mockedSecureAxiosRequest
            .mockResolvedValueOnce({
                data: {
                    id: 'cgt-2025-task-3'
                }
            } as any)
            .mockResolvedValueOnce({
                data: {
                    id: 'cgt-2025-task-3',
                    status: 'failed',
                    error: {
                        message: 'quota exceeded'
                    }
                }
            } as any)

        await expect(
            createModel({ chatflowid: undefined, orgId: undefined }).invoke({
                prompt: '生成一段城市延时摄影'
            })
        ).rejects.toThrow('quota exceeded')
    })
})
