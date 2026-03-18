const mockGetRunningExpressApp = jest.fn()

jest.mock('../../../src/utils/getRunningExpressApp', () => ({
    getRunningExpressApp: () => mockGetRunningExpressApp()
}))

describe('WorkspaceCreditService', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockGetRunningExpressApp.mockReturnValue({
            AppDataSource: {}
        })
    })

    it('passes provider metadata through and bills fallback token usages by total tokens', async () => {
        const { WorkspaceCreditService } = await import('../../../src/enterprise/services/workspace-credit.service')
        const service = new WorkspaceCreditService()
        const consumeCreditByBillingUsagesSpy = jest.spyOn(service, 'consumeCreditByBillingUsages').mockResolvedValue({
            workspaceId: 'workspace-1',
            userId: 'user-1',
            creditConsumed: 350,
            creditBalance: 9650,
            transactions: [],
            usageResults: []
        })

        await service.consumeCreditByCredentialUsages('workspace-1', 'user-1', [
            {
                credentialId: 'credential-llm',
                credentialName: 'DeepSeek Credential',
                provider: 'chatDeepseek',
                model: 'deepseek-chat',
                totalTokens: 300,
                inputTokens: 100,
                outputTokens: 50,
                billUsingTotalTokens: true,
                usageBreakdown: {
                    unclassified_tokens: 150
                }
            }
        ])

        expect(consumeCreditByBillingUsagesSpy).toHaveBeenCalledWith('workspace-1', 'user-1', [
            expect.objectContaining({
                credentialId: 'credential-llm',
                credentialName: 'DeepSeek Credential',
                provider: 'chatDeepseek',
                model: 'deepseek-chat',
                billingMode: 'token',
                usage: {
                    inputTokens: undefined,
                    outputTokens: undefined,
                    totalTokens: 300
                }
            })
        ])
    })
})
