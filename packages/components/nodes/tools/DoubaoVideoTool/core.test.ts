import { parseToolOutput } from '../../../src/agents'
import { createDoubaoVideoTools } from './core'

describe('DoubaoVideoTool core', () => {
    it('should generate video summaries and pass reference image files to the media model', async () => {
        const mediaModel = {
            invoke: jest.fn().mockResolvedValue({
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
                    billingMode: 'video_count',
                    usage: {
                        units: 1
                    }
                }
            })
        }

        const [tool] = createDoubaoVideoTools({
            mediaModel: mediaModel as any,
            defaultParams: {}
        })

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
        expect(parsed.mediaBilling).toEqual([
            {
                provider: 'doubao-ark',
                credentialId: 'cred-2',
                model: 'doubao-seedance-1-5-pro-251215',
                source: 'media_generation',
                billingMode: 'video_count',
                usage: {
                    units: 1
                }
            }
        ])
    })
})
