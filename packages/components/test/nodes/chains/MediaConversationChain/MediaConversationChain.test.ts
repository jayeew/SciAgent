import { AIMessage, HumanMessage } from '@langchain/core/messages'
import { IMediaGenerationInput, IMediaGenerationResult, BaseMediaModel } from '../../../../src/mediaModels'

const { nodeClass: MediaConversationChain } = require('../../../../nodes/chains/MediaConversationChain/MediaConversationChain')

class FakeMediaModel extends BaseMediaModel {
    readonly provider = 'fake-provider'
    readonly modelName = 'fake-model'
    readonly capabilities: {
        textToImage: boolean
        imageToImage?: boolean
        imageToVideo?: boolean
        multiTurnPrompting: boolean
    }

    invoke = jest.fn(async (input: IMediaGenerationInput): Promise<IMediaGenerationResult> => {
        return {
            text: 'Generated 1 image with fake-provider.',
            artifacts: [{ type: 'png', data: 'FILE-STORAGE::generated.png' }],
            input,
            metadata: {
                provider: this.provider,
                model: this.modelName,
                prompt: input.prompt,
                imageCount: 1
            }
        }
    })

    constructor(imageToImage = false, imageToVideo = false) {
        super()
        this.capabilities = {
            textToImage: true,
            ...(imageToImage ? { imageToImage: true } : {}),
            ...(imageToVideo ? { imageToVideo: true } : {}),
            multiTurnPrompting: true
        }
    }
}

describe('MediaConversationChain', () => {
    const createMemory = () => ({
        memoryKey: 'chat_history',
        getChatMessages: jest
            .fn()
            .mockResolvedValue([
                new HumanMessage('Draw a cyberpunk cat'),
                new AIMessage('Generated 1 image. Prompt: Draw a cyberpunk cat')
            ]),
        addChatMessages: jest.fn().mockResolvedValue(undefined)
    })

    it('builds follow-up prompts from media history and returns artifacts', async () => {
        const mediaModel = new FakeMediaModel()
        const memory = createMemory()

        const chain = new MediaConversationChain()
        const result = await chain.run(
            {
                inputs: {
                    mediaModel,
                    memory
                }
            },
            'Make it watercolor',
            {
                shouldStreamResponse: false
            }
        )

        expect(mediaModel.invoke).toHaveBeenCalledWith(
            expect.objectContaining({
                prompt: 'Draw a cyberpunk cat\n\nFollow-up instructions: Make it watercolor',
                conversationContext: expect.any(Array)
            }),
            expect.objectContaining({
                shouldStreamResponse: false
            })
        )
        expect(memory.addChatMessages).toHaveBeenCalledWith(
            [
                {
                    text: 'Make it watercolor',
                    type: 'userMessage'
                },
                {
                    text: 'Generated 1 image. Prompt: Draw a cyberpunk cat\n\nFollow-up instructions: Make it watercolor',
                    type: 'apiMessage'
                }
            ],
            undefined
        )
        expect(result).toEqual(
            expect.objectContaining({
                text: 'Generated 1 image with fake-provider.',
                artifacts: [{ type: 'png', data: 'FILE-STORAGE::generated.png' }],
                metadata: {
                    provider: 'fake-provider',
                    model: 'fake-model',
                    prompt: 'Draw a cyberpunk cat\n\nFollow-up instructions: Make it watercolor',
                    imageCount: 1
                }
            })
        )
    })

    it('passes reference images to media models that support image-to-image', async () => {
        const mediaModel = new FakeMediaModel(true)
        const memory = {
            ...createMemory(),
            getChatMessages: jest.fn().mockResolvedValue([])
        }

        const chain = new MediaConversationChain()
        await chain.run(
            {
                inputs: {
                    mediaModel,
                    memory
                }
            },
            'Make it watercolor',
            {
                shouldStreamResponse: false,
                uploads: [
                    { type: 'stored-file', name: 'base.png', mime: 'image/png' },
                    { type: 'file:rag', name: 'notes.txt', mime: 'text/plain' }
                ]
            }
        )

        expect(mediaModel.invoke).toHaveBeenCalledWith(
            expect.objectContaining({
                prompt: 'Make it watercolor',
                referenceImages: [{ type: 'stored-file', name: 'base.png', mime: 'image/png' }],
                conversationContext: []
            }),
            expect.objectContaining({
                shouldStreamResponse: false
            })
        )
    })

    it('passes reference images to media models that support image-to-video', async () => {
        const mediaModel = new FakeMediaModel(false, true)
        const memory = {
            ...createMemory(),
            getChatMessages: jest.fn().mockResolvedValue([])
        }

        const chain = new MediaConversationChain()
        await chain.run(
            {
                inputs: {
                    mediaModel,
                    memory
                }
            },
            'Make it cinematic',
            {
                shouldStreamResponse: false,
                uploads: [
                    { type: 'stored-file', name: 'first-frame.png', mime: 'image/png' },
                    { type: 'file:rag', name: 'notes.txt', mime: 'text/plain' }
                ]
            }
        )

        expect(mediaModel.invoke).toHaveBeenCalledWith(
            expect.objectContaining({
                prompt: 'Make it cinematic',
                referenceImages: [{ type: 'stored-file', name: 'first-frame.png', mime: 'image/png' }],
                conversationContext: []
            }),
            expect.objectContaining({
                shouldStreamResponse: false
            })
        )
    })

    it('passes multiple reference images to media models that support image-to-video', async () => {
        const mediaModel = new FakeMediaModel(false, true)
        const memory = {
            ...createMemory(),
            getChatMessages: jest.fn().mockResolvedValue([])
        }

        const chain = new MediaConversationChain()
        await chain.run(
            {
                inputs: {
                    mediaModel,
                    memory
                }
            },
            'Make it cinematic',
            {
                shouldStreamResponse: false,
                uploads: [
                    { type: 'stored-file', name: 'first-frame.png', mime: 'image/png' },
                    { type: 'stored-file', name: 'last-frame.png', mime: 'image/png' },
                    { type: 'file:rag', name: 'notes.txt', mime: 'text/plain' }
                ]
            }
        )

        expect(mediaModel.invoke).toHaveBeenCalledWith(
            expect.objectContaining({
                prompt: 'Make it cinematic',
                referenceImages: [
                    { type: 'stored-file', name: 'first-frame.png', mime: 'image/png' },
                    { type: 'stored-file', name: 'last-frame.png', mime: 'image/png' }
                ],
                conversationContext: []
            }),
            expect.objectContaining({
                shouldStreamResponse: false
            })
        )
    })

    it('does not pass reference images to media models without image-to-image support', async () => {
        const mediaModel = new FakeMediaModel(false)
        const memory = {
            ...createMemory(),
            getChatMessages: jest.fn().mockResolvedValue([])
        }

        const chain = new MediaConversationChain()
        await chain.run(
            {
                inputs: {
                    mediaModel,
                    memory
                }
            },
            'Make it watercolor',
            {
                shouldStreamResponse: false,
                uploads: [{ type: 'stored-file', name: 'base.png', mime: 'image/png' }]
            }
        )

        expect(mediaModel.invoke).toHaveBeenCalledWith(
            expect.objectContaining({
                prompt: 'Make it watercolor',
                conversationContext: []
            }),
            expect.objectContaining({
                shouldStreamResponse: false
            })
        )
        expect((mediaModel.invoke.mock.calls[0]?.[0] as IMediaGenerationInput).referenceImages).toBeUndefined()
    })

    it('passes sequential image generation options parsed by prompt refiner', async () => {
        const mediaModel = new FakeMediaModel()
        const memory = {
            ...createMemory(),
            getChatMessages: jest.fn().mockResolvedValue([])
        }
        const promptRefinerModel = {
            invoke: jest
                .fn()
                .mockResolvedValue(
                    new AIMessage(
                        '{"prompt":"生成3张女孩和奶牛玩偶在游乐园开心地坐过山车的图片","sequential_image_generation":"auto","sequential_image_generation_options":{"max_images":3}}'
                    )
                )
        }

        const chain = new MediaConversationChain()
        await chain.run(
            {
                inputs: {
                    mediaModel,
                    memory,
                    promptRefinerModel
                }
            },
            '生成3张图',
            {
                shouldStreamResponse: false
            }
        )

        expect(mediaModel.invoke).toHaveBeenCalledWith(
            expect.objectContaining({
                prompt: '生成3张女孩和奶牛玩偶在游乐园开心地坐过山车的图片',
                sequentialImageGeneration: 'auto',
                sequentialImageGenerationMaxImages: 3,
                conversationContext: []
            }),
            expect.objectContaining({
                shouldStreamResponse: false
            })
        )
    })
})
