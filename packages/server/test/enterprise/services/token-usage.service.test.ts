import { TokenUsageCredential } from '../../../src/enterprise/database/entities/token-usage-credential.entity'
import { TokenUsageCredentialCall } from '../../../src/enterprise/database/entities/token-usage-credential-call.entity'
import { TokenUsageExecution } from '../../../src/enterprise/database/entities/token-usage-execution.entity'
import { WorkspaceCreditTransaction } from '../../../src/enterprise/database/entities/workspace-credit-transaction.entity'

const mockConsumeCreditByCredentialUsages = jest.fn()
const mockGetRunningExpressApp = jest.fn()

jest.mock('../../../src/utils/getRunningExpressApp', () => ({
    getRunningExpressApp: () => mockGetRunningExpressApp()
}))

jest.mock('../../../src/enterprise/services/workspace-credit.service', () => ({
    WorkspaceCreditService: jest.fn().mockImplementation(() => ({
        consumeCreditByCredentialUsages: mockConsumeCreditByCredentialUsages
    }))
}))

describe('TokenUsageService', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    it('groups ordered credential rows but bills each attributed usage separately', async () => {
        const savedExecutions: Record<string, any>[] = []
        const savedCredentialRowsById = new Map<string, Record<string, any>>()
        const savedCredentialCallRowsById = new Map<string, Record<string, any>>()

        const executionRepository = {
            create: jest.fn((value: Record<string, any>) => value),
            save: jest.fn(async (value: Record<string, any>) => {
                const savedValue = {
                    id: `execution-${savedExecutions.length + 1}`,
                    ...value
                }
                savedExecutions.push(savedValue)
                return savedValue
            })
        }

        const credentialRepository = {
            create: jest.fn((value: Record<string, any>) => value),
            save: jest.fn(async (value: Record<string, any> | Record<string, any>[]) => {
                const rows = Array.isArray(value) ? value : [value]
                const savedRows = rows.map((row: Record<string, any>, index: number) => ({
                    id: row.id || `credential-${savedCredentialRowsById.size + index + 1}`,
                    ...row
                }))
                savedRows.forEach((row) => {
                    savedCredentialRowsById.set(row.id, row)
                })
                return Array.isArray(value) ? savedRows : savedRows[0]
            })
        }

        const credentialCallRepository = {
            create: jest.fn((value: Record<string, any>) => value),
            save: jest.fn(async (value: Record<string, any> | Record<string, any>[]) => {
                const rows = Array.isArray(value) ? value : [value]
                const savedRows = rows.map((row: Record<string, any>, index: number) => ({
                    id: row.id || `call-${savedCredentialCallRowsById.size + index + 1}`,
                    ...row
                }))
                savedRows.forEach((row) => {
                    savedCredentialCallRowsById.set(row.id, row)
                })
                return Array.isArray(value) ? savedRows : savedRows[0]
            }),
            createQueryBuilder: jest.fn()
        }

        const workspaceCreditTransactionRepository = {
            findBy: jest.fn(async () => {
                const savedCredentialCallRows = Array.from(savedCredentialCallRowsById.values())
                return savedCredentialCallRows.map((row) => ({
                    id: `transaction-${row.id}`,
                    workspaceId: 'workspace-1',
                    userId: 'user-1',
                    type: 'consume',
                    amount: row.billingMode === 'image_count' ? -220 : -100,
                    balance: 9000,
                    credentialId: row.credentialId,
                    credentialName: row.credentialName,
                    tokenUsageCredentialCallId: row.id,
                    createdDate: new Date('2026-03-13T01:00:00.000Z')
                }))
            })
        }

        mockGetRunningExpressApp.mockReturnValue({
            AppDataSource: {
                getRepository: jest.fn((entity: any) => {
                    if (entity === TokenUsageExecution) return executionRepository
                    if (entity === TokenUsageCredential) return credentialRepository
                    if (entity === TokenUsageCredentialCall) return credentialCallRepository
                    if (entity === WorkspaceCreditTransaction) return workspaceCreditTransactionRepository

                    throw new Error(`Unexpected repository request: ${entity?.name || entity}`)
                })
            }
        })

        mockConsumeCreditByCredentialUsages.mockResolvedValue({
            creditConsumed: 600,
            creditBalance: 9400,
            transactions: [],
            usageResults: []
        })

        const { TokenUsageService } = await import('../../../src/enterprise/services/token-usage.service')
        const service = new TokenUsageService()

        await service.recordTokenUsage({
            workspaceId: 'workspace-1',
            organizationId: 'org-1',
            userId: 'user-1',
            flowType: 'AGENTFLOW',
            flowId: 'flow-1',
            executionId: 'runtime-execution-1',
            chatId: 'chat-1',
            usagePayloads: [
                {
                    model: 'deepseek-chat',
                    usage_metadata: { input_tokens: 100, output_tokens: 50, total_tokens: 150 }
                },
                {
                    model: 'deepseek-chat',
                    usage_metadata: { input_tokens: 110, output_tokens: 55, total_tokens: 165 }
                },
                {
                    model: 'deepseek-chat',
                    usage_metadata: { input_tokens: 120, output_tokens: 60, total_tokens: 180 }
                },
                {
                    model: 'deepseek-reasoner',
                    usage_metadata: { input_tokens: 200, output_tokens: 80, total_tokens: 280 }
                },
                {
                    model: 'deepseek-reasoner',
                    usage_metadata: { input_tokens: 210, output_tokens: 90, total_tokens: 300 }
                },
                {
                    model: 'doubao-seedream-5-0-260128',
                    source: 'media_generation',
                    tokenUsageCredentialCallId: 'call-doubao-1',
                    billingMode: 'image_count',
                    usage: { units: 1 }
                }
            ],
            credentialAccesses: [
                { credentialId: 'credential-llm', credentialName: 'DeepSeek Credential' },
                { credentialId: 'credential-llm', credentialName: 'DeepSeek Credential' },
                { credentialId: 'credential-llm', credentialName: 'DeepSeek Credential' },
                { credentialId: 'credential-llm', credentialName: 'DeepSeek Credential' },
                { credentialId: 'credential-llm', credentialName: 'DeepSeek Credential' },
                { credentialId: 'credential-doubao', credentialName: 'Doubao Credential' }
            ]
        })

        expect(savedExecutions).toHaveLength(1)
        const savedCredentialRows = Array.from(savedCredentialRowsById.values())
        const savedCredentialCallRows = Array.from(savedCredentialCallRowsById.values())

        expect(savedCredentialRows).toHaveLength(3)
        expect(savedCredentialCallRows).toHaveLength(6)

        expect(savedCredentialRows).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    credentialId: 'credential-llm',
                    credentialName: 'DeepSeek Credential',
                    model: 'deepseek-chat',
                    attributionMode: 'ordered',
                    usageCount: 3,
                    totalTokens: 495,
                    chargedCredit: 300
                }),
                expect.objectContaining({
                    credentialId: 'credential-llm',
                    credentialName: 'DeepSeek Credential',
                    model: 'deepseek-reasoner',
                    attributionMode: 'ordered',
                    usageCount: 2,
                    totalTokens: 580,
                    chargedCredit: 200
                }),
                expect.objectContaining({
                    credentialId: 'credential-doubao',
                    credentialName: 'Doubao Credential',
                    model: 'doubao-seedream-5-0-260128',
                    attributionMode: 'ordered',
                    usageCount: 1,
                    totalTokens: 0,
                    chargedCredit: 220
                })
            ])
        )

        const savedImageUsage = savedCredentialRows.find((row) => row.model === 'doubao-seedream-5-0-260128')
        expect(savedImageUsage).toBeDefined()
        if (!savedImageUsage) {
            throw new Error('Expected Doubao image usage row to be present')
        }
        expect(JSON.parse(savedImageUsage.usageBreakdown)).toEqual({
            units: 1,
            generated_images: 1,
            source: 'media_generation'
        })

        expect(savedCredentialCallRows).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: 'call-doubao-1',
                    billingMode: 'image_count',
                    sequenceIndex: 1,
                    chargedCredit: 220,
                    creditTransactionId: 'transaction-call-doubao-1'
                })
            ])
        )

        expect(mockConsumeCreditByCredentialUsages).toHaveBeenCalledTimes(1)

        const billedUsages = mockConsumeCreditByCredentialUsages.mock.calls[0][2]
        expect(billedUsages).toHaveLength(6)
        expect(billedUsages.filter((usage: Record<string, any>) => usage.model === 'deepseek-chat')).toHaveLength(3)
        expect(billedUsages.filter((usage: Record<string, any>) => usage.model === 'deepseek-reasoner')).toHaveLength(2)
        expect(billedUsages.filter((usage: Record<string, any>) => usage.model === 'doubao-seedream-5-0-260128')).toHaveLength(1)

        const billedImageUsage = billedUsages.find((usage: Record<string, any>) => usage.model === 'doubao-seedream-5-0-260128')
        expect(billedImageUsage.usageBreakdown).toEqual({
            units: 1,
            generated_images: 1,
            source: 'media_generation'
        })
        expect(billedImageUsage.tokenUsageCredentialCallId).toBe('call-doubao-1')
    })
})
