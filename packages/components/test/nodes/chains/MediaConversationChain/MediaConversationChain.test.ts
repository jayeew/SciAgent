import { AIMessage, HumanMessage } from '@langchain/core/messages'
import { IMediaGenerationInput, IMediaGenerationResult, BaseMediaModel } from '../../../../src/mediaModels'

const { nodeClass: MediaConversationChain } = require('../../../../nodes/chains/MediaConversationChain/MediaConversationChain')

class FakeMediaModel extends BaseMediaModel {
    readonly provider = 'fake-provider'
    readonly modelName = 'fake-model'
    readonly capabilities = {
        textToImage: true,
        multiTurnPrompting: true
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
}

describe('MediaConversationChain', () => {
    it('builds follow-up prompts from media history and returns artifacts', async () => {
        const mediaModel = new FakeMediaModel()
        const memory = {
            memoryKey: 'chat_history',
            getChatMessages: jest
                .fn()
                .mockResolvedValue([
                    new HumanMessage('Draw a cyberpunk cat'),
                    new AIMessage('Generated 1 image. Prompt: Draw a cyberpunk cat')
                ]),
            addChatMessages: jest.fn().mockResolvedValue(undefined)
        }

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
})
