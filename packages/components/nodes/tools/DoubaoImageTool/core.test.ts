import { parseToolOutput } from '../../../src/agents'
import { createDoubaoImageTools } from './core'

describe('DoubaoImageTool core', () => {
    it('should inject generated image file names back into presentationSpec', async () => {
        const mediaModel = {
            invoke: jest.fn().mockResolvedValue({
                text: 'Generated 1 image with doubao-ark.',
                artifacts: [
                    {
                        type: 'png',
                        data: 'FILE-STORAGE::doubao_generated_image_1.png'
                    }
                ],
                metadata: {
                    images: [
                        {
                            fileName: 'doubao_generated_image_1.png'
                        }
                    ]
                },
                mediaBilling: {
                    provider: 'doubao-ark',
                    credentialId: 'cred-1',
                    model: 'doubao-seedream-5-0-260128',
                    source: 'media_generation',
                    billingMode: 'image_count',
                    usage: {
                        units: 1
                    }
                }
            })
        }

        const [tool] = createDoubaoImageTools({
            mediaModel: mediaModel as any,
            defaultParams: {}
        })

        const result = await (tool as any).call(
            {
                presentationSpec: JSON.stringify({
                    title: '季度汇报',
                    slides: [
                        {
                            layout: 'image-right',
                            title: '市场机会',
                            bullets: ['市场规模持续增长']
                        }
                    ]
                }),
                imageRequests: JSON.stringify({
                    requests: [
                        {
                            slideIndex: 0,
                            prompt: '蓝色商务风市场增长插图'
                        }
                    ]
                })
            },
            undefined,
            undefined,
            {
                orgId: 'org-1',
                chatflowId: 'flow-1',
                chatId: 'chat-1'
            }
        )

        expect(mediaModel.invoke).toHaveBeenCalled()

        const parsed = parseToolOutput(result)
        const updatedSpec = JSON.parse(parsed.output)

        expect(updatedSpec.slides[0].imageFileNames).toEqual(['doubao_generated_image_1.png'])
        expect(parsed.fileAnnotations).toEqual([
            {
                fileName: 'doubao_generated_image_1.png',
                filePath: 'FILE-STORAGE::doubao_generated_image_1.png'
            }
        ])
        expect(parsed.mediaBilling).toEqual([
            {
                provider: 'doubao-ark',
                credentialId: 'cred-1',
                model: 'doubao-seedream-5-0-260128',
                source: 'media_generation',
                billingMode: 'image_count',
                usage: {
                    units: 1
                }
            }
        ])
    })
})
