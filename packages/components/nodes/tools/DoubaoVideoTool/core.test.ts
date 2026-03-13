import { parseToolOutput } from '../../../src/agents'
import { createDoubaoVideoTools } from './core'

const createMediaGenerationResult = () => ({
    text: 'Generated 1 video with doubao-ark.',
    artifacts: [
        {
            type: 'mp4',
            data: 'FILE-STORAGE::doubao_generated_video_1.mp4'
        }
    ],
    metadata: {
        videos: [
            {
                fileName: 'doubao_generated_video_1.mp4',
                ratio: '16:9',
                resolution: '720p',
                duration: 5
            }
        ]
    },
    mediaBilling: {
        provider: 'doubao-ark',
        credentialId: 'cred-2',
        model: 'doubao-seedance-1-5-pro-251215',
        source: 'media_generation',
        billingMode: 'token',
        usage: {
            outputTokens: 108900,
            totalTokens: 108900
        }
    }
})

const createTool = () => {
    const mediaModel = {
        invoke: jest.fn().mockResolvedValue(createMediaGenerationResult())
    }

    const [tool] = createDoubaoVideoTools({
        mediaModel: mediaModel as any,
        defaultParams: {}
    })

    return { tool, mediaModel }
}

describe('DoubaoVideoTool core', () => {
    it('should generate video summaries and pass reference image files to the media model', async () => {
        const { tool, mediaModel } = createTool()

        const result = await (tool as any).call(
            {
                prompt: '生成一段蓝色科技风数据流动画视频',
                referenceImageFileNames: ['cover.png', 'ending.png']
            },
            undefined,
            undefined,
            {
                orgId: 'org-1',
                chatflowId: 'flow-1',
                chatId: 'chat-1'
            }
        )

        expect(mediaModel.invoke).toHaveBeenCalledWith(
            expect.objectContaining({
                prompt: '生成一段蓝色科技风数据流动画视频',
                referenceImages: [
                    {
                        type: 'stored-file',
                        name: 'FILE-STORAGE::cover.png',
                        mime: 'image/png',
                        data: ''
                    },
                    {
                        type: 'stored-file',
                        name: 'FILE-STORAGE::ending.png',
                        mime: 'image/png',
                        data: ''
                    }
                ]
            }),
            {
                chatflowid: 'flow-1',
                chatId: 'chat-1',
                orgId: 'org-1'
            }
        )

        const parsed = parseToolOutput(result)
        const output = JSON.parse(parsed.output)

        expect(output.generatedVideos).toEqual([
            {
                prompt: '生成一段蓝色科技风数据流动画视频',
                fileNames: ['doubao_generated_video_1.mp4'],
                urls: [],
                ratio: '16:9',
                resolution: '720p',
                duration: 5,
                referenceImageFileNames: ['cover.png', 'ending.png']
            }
        ])
        expect(parsed.fileAnnotations).toEqual([
            {
                fileName: 'doubao_generated_video_1.mp4',
                filePath: 'FILE-STORAGE::doubao_generated_video_1.mp4'
            }
        ])
        expect(parsed.artifacts).toEqual([
            {
                type: 'mp4',
                data: 'FILE-STORAGE::doubao_generated_video_1.mp4'
            }
        ])
        expect(parsed.mediaBilling).toEqual([
            {
                provider: 'doubao-ark',
                credentialId: 'cred-2',
                model: 'doubao-seedance-1-5-pro-251215',
                source: 'media_generation',
                billingMode: 'token',
                usage: {
                    outputTokens: 108900,
                    totalTokens: 108900
                }
            }
        ])
    })

    it('should auto-resolve the latest uploaded image as a reference when file names are not provided', async () => {
        const { tool, mediaModel } = createTool()

        const result = await (tool as any).call(
            {
                prompt: '生成一个竖屏的虚拟人物自我介绍视频'
            },
            undefined,
            undefined,
            {
                orgId: 'org-1',
                chatflowId: 'flow-1',
                chatId: 'chat-1',
                recentImageUploads: [
                    {
                        type: 'stored-file',
                        name: 'avatar.png',
                        mime: 'image/png'
                    }
                ]
            }
        )

        expect(mediaModel.invoke).toHaveBeenCalledWith(
            expect.objectContaining({
                prompt: '生成一个竖屏的虚拟人物自我介绍视频',
                referenceImages: [
                    {
                        type: 'stored-file',
                        name: 'FILE-STORAGE::avatar.png',
                        mime: 'image/png',
                        data: ''
                    }
                ]
            }),
            expect.any(Object)
        )

        const parsed = parseToolOutput(result)
        const output = JSON.parse(parsed.output)

        expect(output.generatedVideos[0].referenceImageFileNames).toEqual(['avatar.png'])
        expect(parsed.artifacts).toEqual([
            {
                type: 'mp4',
                data: 'FILE-STORAGE::doubao_generated_video_1.mp4'
            }
        ])
    })

    it('should prefer explicit referenceImageFileNames over auto-resolved uploads', async () => {
        const { tool, mediaModel } = createTool()

        await (tool as any).call(
            {
                prompt: '生成一个高端商务女主播视频',
                referenceImageFileNames: ['approved-avatar.png']
            },
            undefined,
            undefined,
            {
                orgId: 'org-1',
                chatflowId: 'flow-1',
                chatId: 'chat-1',
                recentImageUploads: [
                    {
                        type: 'stored-file',
                        name: 'latest-upload.png',
                        mime: 'image/png'
                    }
                ]
            }
        )

        expect(mediaModel.invoke).toHaveBeenCalledWith(
            expect.objectContaining({
                referenceImages: [
                    {
                        type: 'stored-file',
                        name: 'FILE-STORAGE::approved-avatar.png',
                        mime: 'image/png',
                        data: ''
                    }
                ]
            }),
            expect.any(Object)
        )
    })

    it('should auto-resolve history image uploads and ignore non-image files', async () => {
        const { tool, mediaModel } = createTool()

        const result = await (tool as any).call(
            {
                prompt: '让虚拟人物在咖啡厅内自然地说一句欢迎词'
            },
            undefined,
            undefined,
            {
                orgId: 'org-1',
                chatflowId: 'flow-1',
                chatId: 'chat-1',
                recentImageUploads: [
                    {
                        type: 'stored-file',
                        name: 'notes.txt',
                        mime: 'text/plain'
                    },
                    {
                        type: 'url',
                        name: 'history-avatar.png',
                        mime: 'image/png',
                        data: 'https://example.com/history-avatar.png'
                    }
                ]
            }
        )

        expect(mediaModel.invoke).toHaveBeenCalledWith(
            expect.objectContaining({
                referenceImages: [
                    {
                        type: 'url',
                        name: 'history-avatar.png',
                        mime: 'image/png',
                        data: 'https://example.com/history-avatar.png'
                    }
                ]
            }),
            expect.any(Object)
        )

        const parsed = parseToolOutput(result)
        const output = JSON.parse(parsed.output)

        expect(output.generatedVideos[0].referenceImageFileNames).toEqual(['history-avatar.png'])
    })

    it('should return a clear error when more than two candidate uploads are provided', async () => {
        const { tool, mediaModel } = createTool()

        const result = await (tool as any).call(
            {
                prompt: '生成虚拟人物短视频'
            },
            undefined,
            undefined,
            {
                recentImageUploads: [
                    {
                        type: 'stored-file',
                        name: 'avatar-1.png',
                        mime: 'image/png'
                    },
                    {
                        type: 'stored-file',
                        name: 'avatar-2.png',
                        mime: 'image/png'
                    },
                    {
                        type: 'stored-file',
                        name: 'avatar-3.png',
                        mime: 'image/png'
                    }
                ]
            }
        )

        expect(mediaModel.invoke).not.toHaveBeenCalled()
        expect(result).toContain('最多只能自动使用 2 张人物参考图')
    })
})
