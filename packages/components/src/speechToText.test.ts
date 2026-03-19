const mockGetCredentialData = jest.fn()
const mockGetFileFromStorage = jest.fn()
const mockAlibabaCreate = jest.fn()

jest.mock('./utils', () => ({
    getCredentialData: (...args: any[]) => mockGetCredentialData(...args)
}))

jest.mock('./storageUtils', () => ({
    getFileFromStorage: (...args: any[]) => mockGetFileFromStorage(...args)
}))

jest.mock('openai', () => {
    return jest.fn().mockImplementation(() => ({
        chat: {
            completions: {
                create: (...args: any[]) => mockAlibabaCreate(...args)
            }
        }
    }))
})

describe('convertSpeechToText', () => {
    let consoleInfoSpy: jest.SpyInstance

    beforeEach(() => {
        jest.clearAllMocks()
        consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined)
    })

    afterEach(() => {
        consoleInfoSpy.mockRestore()
    })

    it('records Alibaba STT usage as seconds-based audit events', async () => {
        mockGetCredentialData.mockResolvedValue({
            alibabaApiKey: 'test-key'
        })
        mockGetFileFromStorage.mockResolvedValue(Buffer.from('audio-bytes'))
        mockAlibabaCreate.mockResolvedValue({
            choices: [
                {
                    message: {
                        content: 'hello world'
                    }
                }
            ],
            usage: {
                seconds: 3,
                prompt_tokens: 10,
                completion_tokens: 2,
                total_tokens: 12
            }
        })

        const { convertSpeechToText } = await import('./speechToText')
        const tokenAuditContext: Record<string, any> = {}

        const result = await convertSpeechToText(
            {
                name: 'speech.mp3',
                mime: 'audio/mpeg'
            } as any,
            {
                name: 'alibabaSTT',
                credentialId: 'credential-1',
                model: 'qwen3-asr-flash'
            },
            {
                orgId: 'org-1',
                chatflowid: 'flow-1',
                chatId: 'chat-1',
                tokenAuditContext
            }
        )

        expect(result).toEqual(
            expect.objectContaining({
                text: 'hello world',
                provider: 'alibabaSTT',
                credentialId: 'credential-1',
                model: 'qwen3-asr-flash',
                tokenUsageCredentialCallId: expect.any(String),
                usage: {
                    seconds: 3
                }
            })
        )

        expect(tokenAuditContext.tokenUsagePayloads).toEqual([
            expect.objectContaining({
                credentialId: 'credential-1',
                model: 'qwen3-asr-flash',
                provider: 'alibabaSTT',
                source: 'speech_to_text',
                billingMode: 'seconds',
                tokenUsageCredentialCallId: result?.tokenUsageCredentialCallId,
                usage: expect.objectContaining({
                    seconds: 3,
                    prompt_tokens: 10,
                    completion_tokens: 2,
                    total_tokens: 12
                })
            })
        ])
        expect(tokenAuditContext.credentialAccesses).toEqual([
            expect.objectContaining({
                credentialId: 'credential-1',
                model: 'qwen3-asr-flash',
                provider: 'alibabaSTT',
                tokenUsageCredentialCallId: result?.tokenUsageCredentialCallId
            })
        ])
    })
})
