import { addImagesToMessages as addAgentImagesToMessages, processMessagesWithImages } from '../../../nodes/agentflow/utils'
import { addImagesToMessages as addNodeImagesToMessages, llmSupportsVision } from '../../../src/multiModalUtils'
import { getFileFromStorage } from '../../../src/storageUtils'
import { getCredentialData } from '../../../src/utils'

jest.mock('../../../src/storageUtils', () => ({
    getFileFromStorage: jest.fn()
}))

jest.mock('../../../src/utils', () => {
    const actual = jest.requireActual('../../../src/utils')
    return {
        ...actual,
        getCredentialData: jest.fn(async (selectedCredentialId: string) => {
            if (selectedCredentialId === 'credential-1') {
                return {
                    moonshotApiKey: 'credential-api-key'
                }
            }

            return {}
        })
    }
})

const { nodeClass: ChatKimi_ChatModels } = require('../../../nodes/chatmodels/ChatKimi/ChatKimi')

const mockedGetFileFromStorage = getFileFromStorage as jest.MockedFunction<typeof getFileFromStorage>
const mockedGetCredentialData = getCredentialData as jest.MockedFunction<typeof getCredentialData>
const mockCredentialData = () =>
    mockedGetCredentialData.mockImplementation(async (selectedCredentialId: string) => {
        if (selectedCredentialId === 'credential-1') {
            return {
                moonshotApiKey: 'credential-api-key'
            }
        }

        return {}
    })

describe('ChatKimi', () => {
    const MOONSHOT_BASE_URL = 'https://api.moonshot.cn/v1'

    beforeEach(() => {
        jest.clearAllMocks()
        mockCredentialData()
    })

    it('uses the Moonshot baseURL and maps maxTokens to max_completion_tokens', async () => {
        const node = new ChatKimi_ChatModels()
        const model = await node.init(
            {
                id: 'chatKimi_0',
                inputs: {
                    modelName: 'moonshot-v1-32k',
                    moonshotApiKey: 'test-api-key',
                    maxTokens: '1024'
                }
            },
            '',
            {}
        )

        expect(model.clientConfig?.baseURL).toBe(MOONSHOT_BASE_URL)
        expect(model.streaming).toBe(true)
        expect(model.configuredMaxToken).toBe(1024)
        expect(model.invocationParams()).toEqual(
            expect.objectContaining({
                model: 'moonshot-v1-32k',
                stream: true,
                max_completion_tokens: 1024
            })
        )
        expect(model.invocationParams()).not.toHaveProperty('max_tokens')
    })

    it('backfills credentialId and resolves the Moonshot API key from credentials', async () => {
        const nodeData: any = {
            id: 'chatKimi_0',
            inputs: {
                credentialId: 'credential-1',
                modelName: 'moonshot-v1-8k'
            }
        }
        const node = new ChatKimi_ChatModels()
        const model = await node.init(nodeData, '', {})

        expect(nodeData.credential).toBe('credential-1')
        expect(mockedGetCredentialData).toHaveBeenCalledWith('credential-1', {})
        expect(model.apiKey).toBe('credential-api-key')
        expect(model.clientConfig?.apiKey).toBe('credential-api-key')
    })

    it('suppresses incompatible kimi-k2.5 sampling parameters', async () => {
        const node = new ChatKimi_ChatModels()
        const model = await node.init(
            {
                id: 'chatKimi_0',
                inputs: {
                    modelName: 'kimi-k2.5',
                    moonshotApiKey: 'test-api-key',
                    temperature: '0.2',
                    topP: '0.3',
                    frequencyPenalty: '0.4',
                    presencePenalty: '0.5',
                    maxTokens: '2048'
                }
            },
            '',
            {}
        )

        expect(model.temperature).toBeUndefined()
        expect(model.topP).toBeUndefined()
        expect(model.frequencyPenalty).toBeUndefined()
        expect(model.presencePenalty).toBeUndefined()
        expect(model.n).toBeUndefined()
        expect(model.invocationParams()).toEqual(
            expect.objectContaining({
                model: 'kimi-k2.5',
                max_completion_tokens: 2048
            })
        )
        expect(model.invocationParams()).not.toHaveProperty('temperature')
        expect(model.invocationParams()).not.toHaveProperty('top_p')
        expect(model.invocationParams()).not.toHaveProperty('frequency_penalty')
        expect(model.invocationParams()).not.toHaveProperty('presence_penalty')
        expect(model.invocationParams()).not.toHaveProperty('n')
    })

    it('only enables image uploads for vision models', async () => {
        const node = new ChatKimi_ChatModels()

        const textModel = await node.init(
            {
                id: 'chatKimi_text',
                inputs: {
                    modelName: 'moonshot-v1-32k',
                    moonshotApiKey: 'test-api-key',
                    allowImageUploads: true
                }
            },
            '',
            {}
        )

        const visionModel = await node.init(
            {
                id: 'chatKimi_vision',
                inputs: {
                    modelName: 'moonshot-v1-32k-vision-preview',
                    moonshotApiKey: 'test-api-key',
                    allowImageUploads: true
                }
            },
            '',
            {}
        )

        expect(llmSupportsVision(textModel)).toBe(true)
        expect(textModel.multiModalOption?.image?.allowImageUploads).toBe(false)
        expect(visionModel.multiModalOption?.image?.allowImageUploads).toBe(true)
    })
})

describe('ChatKimi image handling', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockCredentialData()
        mockedGetFileFromStorage.mockReset()
    })

    it('creates Kimi image messages without detail and converts stored files to data URLs', async () => {
        mockedGetFileFromStorage.mockResolvedValue(Buffer.from('image-bytes'))

        const imageMessages = await addNodeImagesToMessages(
            {
                id: 'chatKimi_vision',
                inputs: {
                    model: {
                        multiModalOption: {
                            image: {
                                allowImageUploads: true,
                                provider: 'chatKimi',
                                modelName: 'kimi-k2.5'
                            }
                        }
                    }
                }
            } as any,
            {
                orgId: 'org-1',
                chatflowid: 'flow-1',
                chatId: 'chat-1',
                uploads: [
                    {
                        type: 'stored-file',
                        name: 'uploaded.png',
                        mime: 'image/png'
                    }
                ]
            },
            {
                image: {
                    allowImageUploads: true,
                    provider: 'chatKimi',
                    modelName: 'kimi-k2.5'
                }
            }
        )

        expect(imageMessages).toEqual([
            {
                type: 'image_url',
                image_url: {
                    url: `data:image/png;base64,${Buffer.from('image-bytes').toString('base64')}`
                }
            }
        ])
    })

    it('rejects remote URL image uploads for Kimi vision models in standard chat flows', async () => {
        await expect(
            addNodeImagesToMessages(
                {
                    id: 'chatKimi_vision',
                    inputs: {
                        model: {
                            multiModalOption: {
                                image: {
                                    allowImageUploads: true,
                                    provider: 'chatKimi',
                                    modelName: 'moonshot-v1-8k-vision-preview'
                                }
                            }
                        }
                    }
                } as any,
                {
                    uploads: [
                        {
                            type: 'url',
                            name: 'remote.png',
                            mime: 'image/png',
                            data: 'https://example.com/remote.png'
                        }
                    ]
                },
                {
                    image: {
                        allowImageUploads: true,
                        provider: 'chatKimi',
                        modelName: 'moonshot-v1-8k-vision-preview'
                    }
                }
            )
        ).rejects.toThrow('ChatKimi vision models do not support remote image URLs. Please upload a local image file instead.')
    })

    it('rejects remote URL image uploads for Kimi vision models in agentflow', async () => {
        await expect(
            addAgentImagesToMessages(
                {
                    uploads: [
                        {
                            type: 'url',
                            name: 'remote.png',
                            mime: 'image/png',
                            data: 'https://example.com/remote.png'
                        }
                    ]
                },
                true,
                undefined,
                'chatKimi',
                'kimi-k2.5'
            )
        ).rejects.toThrow('ChatKimi vision models do not support remote image URLs. Please upload a local image file instead.')
    })

    it('keeps Kimi agentflow stored-file image messages as base64 data URLs without detail', async () => {
        mockedGetFileFromStorage.mockResolvedValue(Buffer.from('agentflow-image'))

        const { updatedMessages } = await processMessagesWithImages(
            [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'stored-file',
                            name: 'FILE-STORAGE::vision.png',
                            mime: 'image/png',
                            provider: 'chatKimi',
                            modelName: 'kimi-k2.5'
                        }
                    ]
                }
            ],
            {
                orgId: 'org-1',
                chatflowid: 'flow-1',
                chatId: 'chat-1'
            }
        )

        expect(updatedMessages).toEqual([
            {
                role: 'user',
                content: [
                    {
                        type: 'image_url',
                        image_url: {
                            url: `data:image/png;base64,${Buffer.from('agentflow-image').toString('base64')}`
                        }
                    }
                ]
            }
        ])
    })
})
