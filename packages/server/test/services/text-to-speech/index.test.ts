const mockRecordTokenUsage = jest.fn()

jest.mock('../../../src/enterprise/services/token-usage.service', () => ({
    TokenUsageService: jest.fn().mockImplementation(() => ({
        recordTokenUsage: mockRecordTokenUsage
    }))
}))

jest.mock('../../../src/utils/logger', () => ({
    __esModule: true,
    default: {
        info: jest.fn(),
        warn: jest.fn()
    }
}))

describe('textToSpeechService', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    it('records Alibaba TTS usage with characters billing mode and stable idempotency key', async () => {
        const textToSpeechService = (await import('../../../src/services/text-to-speech')).default

        await textToSpeechService.recordTextToSpeechTokenUsage({
            workspaceId: 'workspace-1',
            organizationId: 'org-1',
            userId: 'user-1',
            flowType: 'CHATFLOW',
            flowId: 'flow-1',
            executionId: 'runtime-tts-1',
            chatId: 'chat-1',
            chatMessageId: 'message-1',
            billingDetails: {
                provider: 'alibaba',
                credentialId: 'credential-1',
                model: 'qwen3-tts-flash',
                tokenUsageCredentialCallId: 'call-tts-1',
                usage: {
                    characters: 42
                }
            } as any,
            options: {}
        })

        expect(mockRecordTokenUsage).toHaveBeenCalledWith({
            workspaceId: 'workspace-1',
            organizationId: 'org-1',
            userId: 'user-1',
            flowType: 'CHATFLOW',
            flowId: 'flow-1',
            executionId: 'runtime-tts-1',
            chatId: 'chat-1',
            chatMessageId: 'message-1',
            idempotencyKey: 'tts:CHATFLOW:flow-1:runtime-tts-1:chat-1:message-1:call-tts-1',
            usagePayloads: [
                {
                    credentialId: 'credential-1',
                    tokenUsageCredentialCallId: 'call-tts-1',
                    model: 'qwen3-tts-flash',
                    provider: 'alibaba',
                    source: 'text_to_speech',
                    billingMode: 'characters',
                    usage: {
                        characters: 42
                    }
                }
            ],
            credentialAccesses: [
                {
                    credentialId: 'credential-1',
                    model: 'qwen3-tts-flash',
                    provider: 'alibaba',
                    tokenUsageCredentialCallId: 'call-tts-1'
                }
            ]
        })
    })

    it('fails metering for unsupported TTS providers when workspace credit is enabled', async () => {
        const textToSpeechService = (await import('../../../src/services/text-to-speech')).default

        await expect(
            textToSpeechService.consumeTextToSpeechCredit({
                provider: 'openai',
                credentialId: 'credential-1',
                model: 'gpt-4o-mini-tts',
                workspaceId: 'workspace-1',
                userId: 'user-1',
                options: {}
            } as any)
        ).rejects.toThrow('Metering unsupported for text-to-speech provider "openai" without real provider usage')
    })
})
