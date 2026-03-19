import { parseToolOutput } from '../../../src/agents'
import { IFileUpload } from '../../../src/Interface'
import { createAlibabaImageTools } from './core'

const createMediaModelMock = (generatedFileName: string = 'alibaba_generated_image_1.png') => ({
    invoke: jest.fn().mockResolvedValue({
        text: 'Generated 1 image with alibaba-dashscope.',
        artifacts: [
            {
                type: 'png',
                data: `FILE-STORAGE::${generatedFileName}`
            }
        ],
        metadata: {
            images: [
                {
                    fileName: generatedFileName
                }
            ]
        },
        mediaBilling: {
            provider: 'alibaba-dashscope',
            credentialId: 'cred-1',
            model: 'qwen-image-2.0-pro',
            source: 'media_generation',
            billingMode: 'image_count',
            usage: {
                units: 1
            }
        }
    })
})

const createTool = (mediaModel: ReturnType<typeof createMediaModelMock>, defaultParams: Record<string, unknown> = {}) => {
    const [tool] = createAlibabaImageTools({
        mediaModel: mediaModel as any,
        defaultParams
    })

    return tool as any
}

const callTool = async ({
    toolArgs,
    flowConfig,
    defaultParams
}: {
    toolArgs: Record<string, unknown>
    flowConfig?: Record<string, unknown>
    defaultParams?: Record<string, unknown>
}) => {
    const mediaModel = createMediaModelMock()
    const tool = createTool(mediaModel, defaultParams)

    const result = await tool.call(toolArgs, undefined, undefined, {
        orgId: 'org-1',
        chatflowId: 'flow-1',
        chatId: 'chat-1',
        ...(flowConfig || {})
    })

    return {
        mediaModel,
        result,
        parsed: parseToolOutput(result)
    }
}

const storedFileReference = (fileName: string): IFileUpload[] => [
    {
        type: 'stored-file',
        name: `FILE-STORAGE::${fileName}`,
        mime: 'image/png',
        data: ''
    }
]

describe('AlibabaImageTool core', () => {
    it('should repair unescaped quotes inside prompt values when imageRequests is a malformed JSON string', async () => {
        const mediaModel = createMediaModelMock()
        const tool = createTool(mediaModel)
        const malformedImageRequests = `{
            "requests": [
                {
                    "slideIndex": 0,
                    "prompt": "Poster with the title "Scientific Workflow" and a caption "Image Editing".",
                    "size": "1536*1024",
                    "imageCount": 2,
                    "promptExtend": false
                }
            ]
        }`

        const result = await tool.call(
            {
                presentationSpec: JSON.stringify({
                    title: '科研汇报',
                    slides: [
                        {
                            layout: 'image-right',
                            title: '系统概览'
                        }
                    ]
                }),
                imageRequests: malformedImageRequests
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
                prompt: 'Poster with the title "Scientific Workflow" and a caption "Image Editing".',
                size: '1536*1024',
                imageCount: 2,
                promptExtend: false
            }),
            expect.any(Object)
        )

        const parsed = parseToolOutput(result)
        const updatedSpec = JSON.parse(parsed.output)

        expect(updatedSpec.slides[0].imageFileNames).toEqual(['alibaba_generated_image_1.png'])
    })

    it('should inject generated image file names back into presentationSpec and include media billing payloads', async () => {
        const mediaModel = createMediaModelMock()
        const tool = createTool(mediaModel)

        const result = await tool.call(
            {
                presentationSpec: JSON.stringify({
                    title: '季度汇报',
                    slides: [
                        {
                            layout: 'image-right',
                            title: '市场机会'
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

        const parsed = parseToolOutput(result)
        const updatedSpec = JSON.parse(parsed.output)

        expect(updatedSpec.slides[0].imageFileNames).toEqual(['alibaba_generated_image_1.png'])
        expect(parsed.artifacts).toEqual([
            {
                type: 'png',
                data: 'FILE-STORAGE::alibaba_generated_image_1.png'
            }
        ])
        expect(parsed.fileAnnotations).toEqual([
            {
                fileName: 'alibaba_generated_image_1.png',
                filePath: 'FILE-STORAGE::alibaba_generated_image_1.png'
            }
        ])
        expect(parsed.mediaBilling).toEqual([
            {
                provider: 'alibaba-dashscope',
                credentialId: 'cred-1',
                model: 'qwen-image-2.0-pro',
                source: 'media_generation',
                billingMode: 'image_count',
                usage: {
                    units: 1
                }
            }
        ])
    })

    it('should keep manual referenceImageFileNames higher priority than automatic sources and preserve multiple references', async () => {
        const { mediaModel, parsed } = await callTool({
            toolArgs: {
                imageRequests: {
                    requests: [
                        {
                            prompt: 'Academic method overview',
                            referenceImageFileNames: ['scene.png', 'character.png']
                        }
                    ]
                },
                referenceImageSource: 'flowState',
                referenceImageStateKey: 'draftGenerationResult',
                referenceImageSelection: 'first'
            },
            flowConfig: {
                state: {
                    draftGenerationResult: JSON.stringify({
                        generatedImages: [
                            {
                                fileNames: ['state-reference.png']
                            }
                        ]
                    })
                }
            }
        })

        expect(mediaModel.invoke).toHaveBeenCalledWith(
            expect.objectContaining({
                referenceImages: [...storedFileReference('scene.png'), ...storedFileReference('character.png')]
            }),
            expect.any(Object)
        )
        expect(parsed.toolArgs).toEqual(
            expect.objectContaining({
                resolvedReferenceSource: 'manual'
            })
        )
    })

    it('should fall back from flowStateThenUploads to current uploads when state is missing', async () => {
        const { mediaModel, parsed } = await callTool({
            toolArgs: {
                prompt: 'Transform the uploaded sketch into a polished poster',
                referenceImageSource: 'flowStateThenUploads',
                referenceImageStateKey: 'missingState',
                referenceImageSelection: 'last'
            },
            flowConfig: {
                uploads: [
                    {
                        type: 'stored-file',
                        name: 'FILE-STORAGE::upload-1.png',
                        mime: 'image/png',
                        data: ''
                    },
                    {
                        type: 'stored-file',
                        name: 'FILE-STORAGE::upload-2.png',
                        mime: 'image/png',
                        data: ''
                    }
                ]
            }
        })

        expect(mediaModel.invoke).toHaveBeenCalledWith(
            expect.objectContaining({
                referenceImages: storedFileReference('upload-2.png')
            }),
            expect.any(Object)
        )
        expect(parsed.toolArgs).toEqual(
            expect.objectContaining({
                resolvedReferenceSource: 'currentUploads'
            })
        )
    })

    it('should gracefully degrade to text-to-image when automatic reference resolution finds nothing', async () => {
        const { mediaModel, parsed } = await callTool({
            toolArgs: {
                prompt: 'Create a new lab poster',
                referenceImageSource: 'flowState',
                referenceImageStateKey: 'missingState'
            }
        })

        expect(mediaModel.invoke).toHaveBeenCalledWith(
            expect.not.objectContaining({
                referenceImages: expect.anything()
            }),
            expect.any(Object)
        )
        expect(parsed.toolArgs).toEqual(
            expect.objectContaining({
                resolvedReferenceSource: 'none',
                referenceResolutionWarnings: ['No flow state value was found for referenceImageStateKey "missingState".']
            })
        )
    })
})
