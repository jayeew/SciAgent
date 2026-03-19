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

    it('reuses an existing consume transaction by tokenUsageCredentialCallId without double charging', async () => {
        const workspaceUser = {
            workspaceId: 'workspace-1',
            userId: 'user-1',
            credit: 900
        }
        const existingTransaction = {
            id: 'tx-1',
            workspaceId: 'workspace-1',
            userId: 'user-1',
            type: 'consume',
            amount: -120,
            balance: 900,
            tokenUsageCredentialCallId: 'call-1',
            createdDate: new Date('2026-03-13T01:00:00.000Z')
        }

        const queryRunner = {
            connect: jest.fn(),
            startTransaction: jest.fn(),
            commitTransaction: jest.fn(),
            rollbackTransaction: jest.fn(),
            release: jest.fn(),
            isReleased: false,
            isTransactionActive: true,
            manager: {
                findOneBy: jest.fn(async (entity: any, where: Record<string, any>) => {
                    if (where.workspaceId && where.userId && !where.type) {
                        return workspaceUser
                    }
                    if (where.tokenUsageCredentialCallId === 'call-1') {
                        return existingTransaction
                    }
                    return null
                }),
                findBy: jest.fn(async () => []),
                create: jest.fn((_: any, value: Record<string, any>) => value),
                save: jest.fn(async (_: any, value: Record<string, any>) => value)
            }
        }

        mockGetRunningExpressApp.mockReturnValue({
            AppDataSource: {
                createQueryRunner: jest.fn(() => queryRunner)
            }
        })

        const { WorkspaceCreditService } = await import('../../../src/enterprise/services/workspace-credit.service')
        const service = new WorkspaceCreditService()

        const result = await service.consumeCreditByBillingUsages('workspace-1', 'user-1', [
            {
                credentialId: 'credential-1',
                credentialName: 'Reused Credential',
                provider: 'chatDeepseek',
                model: 'deepseek-chat',
                tokenUsageCredentialCallId: 'call-1',
                source: 'llm',
                billingMode: 'token',
                usage: {
                    inputTokens: 100,
                    outputTokens: 20,
                    totalTokens: 120
                }
            }
        ])

        expect(queryRunner.manager.create).not.toHaveBeenCalled()
        expect(queryRunner.manager.save).toHaveBeenCalledWith(expect.anything(), workspaceUser)
        expect(result.creditConsumed).toBe(0)
        expect(result.transactions).toEqual([existingTransaction])
        expect(result.usageResults[0]).toEqual(
            expect.objectContaining({
                chargedCredit: 120,
                transaction: existingTransaction
            })
        )
    })
})
