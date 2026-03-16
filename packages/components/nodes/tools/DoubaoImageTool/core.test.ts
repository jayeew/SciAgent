import { parseToolOutput } from '../../../src/agents'
import { IFileUpload } from '../../../src/Interface'
import { createDoubaoImageTools } from './core'

const createMediaModelMock = (generatedFileName: string = 'doubao_generated_image_1.png') => ({
    invoke: jest.fn().mockResolvedValue({
        text: 'Generated 1 image with doubao-ark.',
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
})

const createTool = (mediaModel: ReturnType<typeof createMediaModelMock>, defaultParams: Record<string, unknown> = {}) => {
    const [tool] = createDoubaoImageTools({
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

describe('DoubaoImageTool core', () => {
    it('should inject generated image file names back into presentationSpec', async () => {
        const mediaModel = createMediaModelMock()
        const tool = createTool(mediaModel)

        const result = await tool.call(
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
        expect(parsed.artifacts).toEqual([
            {
                type: 'png',
                data: 'FILE-STORAGE::doubao_generated_image_1.png'
            }
        ])
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

    it('should keep manual referenceImageFileNames higher priority than automatic sources', async () => {
        const { mediaModel, parsed } = await callTool({
            toolArgs: {
                imageRequests: {
                    requests: [
                        {
                            prompt: 'Academic method overview',
                            referenceImageFileNames: ['manual-reference.png']
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
                referenceImages: storedFileReference('manual-reference.png')
            }),
            expect.any(Object)
        )
        expect(parsed.toolArgs).toMatchObject({
            resolvedReferenceSource: 'manual',
            resolvedReferenceImages: [
                {
                    type: 'stored-file',
                    name: 'FILE-STORAGE::manual-reference.png',
                    mime: 'image/png'
                }
            ],
            referenceResolutionWarnings: []
        })
    })

    it.each([
        {
            label: 'generatedImages fileNames',
            selection: 'first',
            stateValue: JSON.stringify({
                generatedImages: [
                    {
                        fileNames: ['generated-a.png', 'generated-b.png']
                    }
                ]
            }),
            expectedFileName: 'generated-a.png'
        },
        {
            label: 'fileAnnotations',
            selection: 'last',
            stateValue: {
                fileAnnotations: [{ fileName: 'annotation-a.png' }, { fileName: 'annotation-b.png' }]
            },
            expectedFileName: 'annotation-b.png'
        },
        {
            label: 'top-level fileNames',
            selection: 'last',
            stateValue: {
                fileNames: ['file-list-a.png', 'file-list-b.png']
            },
            expectedFileName: 'file-list-b.png'
        },
        {
            label: 'string array',
            selection: 'first',
            stateValue: ['array-a.png', 'array-b.png'],
            expectedFileName: 'array-a.png'
        },
        {
            label: 'single string',
            selection: 'first',
            stateValue: 'single-reference.png',
            expectedFileName: 'single-reference.png'
        }
    ])('should resolve flowState references from $label', async ({ selection, stateValue, expectedFileName }) => {
        const { mediaModel, parsed } = await callTool({
            toolArgs: {
                imageRequests: {
                    requests: [
                        {
                            prompt: 'Refine academic figure'
                        }
                    ]
                },
                referenceImageSource: 'flowState',
                referenceImageStateKey: 'draftGenerationResult',
                referenceImageSelection: selection
            },
            flowConfig: {
                state: {
                    draftGenerationResult: stateValue
                }
            }
        })

        expect(mediaModel.invoke).toHaveBeenCalledWith(
            expect.objectContaining({
                referenceImages: storedFileReference(expectedFileName)
            }),
            expect.any(Object)
        )
        expect(parsed.toolArgs).toMatchObject({
            resolvedReferenceSource: 'flowState',
            resolvedReferenceImages: [
                {
                    type: 'stored-file',
                    name: `FILE-STORAGE::${expectedFileName}`,
                    mime: 'image/png'
                }
            ]
        })
    })

    it('should resolve currentUploads from recentImageUploads before uploads', async () => {
        const { mediaModel, parsed } = await callTool({
            toolArgs: {
                prompt: 'Improve figure typography',
                referenceImageSource: 'currentUploads',
                referenceImageSelection: 'first'
            },
            flowConfig: {
                uploads: [
                    {
                        type: 'stored-file',
                        name: 'FILE-STORAGE::older-upload.png',
                        mime: 'image/png',
                        data: ''
                    }
                ],
                recentImageUploads: [
                    {
                        type: 'stored-file',
                        name: 'FILE-STORAGE::recent-upload.png',
                        mime: 'image/png',
                        data: ''
                    }
                ]
            }
        })

        expect(mediaModel.invoke).toHaveBeenCalledWith(
            expect.objectContaining({
                referenceImages: storedFileReference('recent-upload.png')
            }),
            expect.any(Object)
        )
        expect(parsed.toolArgs.resolvedReferenceSource).toBe('currentUploads')
    })

    it('should resolve currentUploads from image url uploads', async () => {
        const { mediaModel, parsed } = await callTool({
            toolArgs: {
                prompt: 'Refine panel alignment',
                referenceImageSource: 'currentUploads',
                referenceImageSelection: 'first'
            },
            flowConfig: {
                uploads: [
                    {
                        type: 'url',
                        name: 'reference-url',
                        mime: 'image/png',
                        data: 'https://example.com/reference.png'
                    },
                    {
                        type: 'stored-file',
                        name: 'FILE-STORAGE::backup-reference.png',
                        mime: 'image/png',
                        data: ''
                    }
                ]
            }
        })

        expect(mediaModel.invoke).toHaveBeenCalledWith(
            expect.objectContaining({
                referenceImages: [
                    {
                        type: 'url',
                        name: 'reference-url',
                        mime: 'image/png',
                        data: 'https://example.com/reference.png'
                    }
                ]
            }),
            expect.any(Object)
        )
        expect(parsed.toolArgs.resolvedReferenceImages).toEqual([
            {
                type: 'url',
                name: 'reference-url',
                mime: 'image/png'
            }
        ])
    })

    it('should fall back from flowStateThenUploads to current uploads when state is missing', async () => {
        const { mediaModel, parsed } = await callTool({
            toolArgs: {
                prompt: 'Refine connector arrows',
                referenceImageSource: 'flowStateThenUploads',
                referenceImageStateKey: 'draftGenerationResult',
                referenceImageSelection: 'last'
            },
            flowConfig: {
                state: {},
                uploads: [
                    {
                        type: 'stored-file',
                        name: 'FILE-STORAGE::fallback-reference.png',
                        mime: 'image/png',
                        data: ''
                    }
                ]
            }
        })

        expect(mediaModel.invoke).toHaveBeenCalledWith(
            expect.objectContaining({
                referenceImages: storedFileReference('fallback-reference.png')
            }),
            expect.any(Object)
        )
        expect(parsed.toolArgs).toMatchObject({
            resolvedReferenceSource: 'currentUploads'
        })
        expect(parsed.toolArgs.referenceResolutionWarnings).toEqual(
            expect.arrayContaining(['No flow state value was found for referenceImageStateKey "draftGenerationResult".'])
        )
    })

    it('should gracefully degrade to text-to-image when automatic reference resolution finds nothing', async () => {
        const { mediaModel, parsed } = await callTool({
            toolArgs: {
                prompt: 'Generate a clean academic schematic',
                referenceImageSource: 'flowState',
                referenceImageStateKey: 'draftGenerationResult',
                referenceImageSelection: 'first'
            },
            flowConfig: {
                state: {}
            }
        })

        expect(mediaModel.invoke).toHaveBeenCalledWith(
            expect.not.objectContaining({
                referenceImages: expect.anything()
            }),
            expect.any(Object)
        )
        expect(parsed.toolArgs).toMatchObject({
            resolvedReferenceSource: 'none'
        })
        expect(parsed.toolArgs.referenceResolutionWarnings).toEqual(
            expect.arrayContaining(['No flow state value was found for referenceImageStateKey "draftGenerationResult".'])
        )
    })
})
