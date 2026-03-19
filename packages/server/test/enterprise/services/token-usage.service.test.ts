import { TokenUsageCredential } from '../../../src/enterprise/database/entities/token-usage-credential.entity'
import { TokenUsageCredentialCall } from '../../../src/enterprise/database/entities/token-usage-credential-call.entity'
import { TokenUsageExecution } from '../../../src/enterprise/database/entities/token-usage-execution.entity'
import { WorkspaceCreditTransaction } from '../../../src/enterprise/database/entities/workspace-credit-transaction.entity'
import { ChatFlow } from '../../../src/database/entities/ChatFlow'
import { Assistant } from '../../../src/database/entities/Assistant'
import { User } from '../../../src/enterprise/database/entities/user.entity'

const mockConsumeCreditByBillingUsages = jest.fn()
const mockGetRunningExpressApp = jest.fn()

jest.mock('../../../src/utils/getRunningExpressApp', () => ({
    getRunningExpressApp: () => mockGetRunningExpressApp()
}))

jest.mock('../../../src/enterprise/services/workspace-credit.service', () => ({
    WorkspaceCreditService: jest.fn().mockImplementation(() => ({
        consumeCreditByBillingUsages: mockConsumeCreditByBillingUsages
    }))
}))

describe('TokenUsageService', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    const createQueryBuilderMock = <T>(options: { count?: number; many?: T[]; rawOne?: Record<string, any> }) => {
        const queryBuilder = {
            where: jest.fn().mockReturnThis(),
            andWhere: jest.fn().mockReturnThis(),
            orderBy: jest.fn().mockReturnThis(),
            skip: jest.fn().mockReturnThis(),
            take: jest.fn().mockReturnThis(),
            select: jest.fn().mockReturnThis(),
            addSelect: jest.fn().mockReturnThis(),
            clone: jest.fn()
        }

        queryBuilder.clone.mockImplementation(() => queryBuilder)
        ;(queryBuilder as any).getCount = jest.fn().mockResolvedValue(options.count ?? 0)
        ;(queryBuilder as any).getMany = jest.fn().mockResolvedValue(options.many ?? [])
        ;(queryBuilder as any).getRawOne = jest.fn().mockResolvedValue(options.rawOne ?? {})

        return queryBuilder as typeof queryBuilder & {
            getCount: jest.Mock
            getMany: jest.Mock
            getRawOne: jest.Mock
        }
    }

    const setupUsageRepositories = () => {
        const savedExecutionsById = new Map<string, Record<string, any>>()
        const savedCredentialRowsById = new Map<string, Record<string, any>>()
        const savedCredentialCallRowsById = new Map<string, Record<string, any>>()

        const executionRepository = {
            create: jest.fn((value: Record<string, any>) => value),
            save: jest.fn(async (value: Record<string, any>) => {
                const savedValue = {
                    id: value.id || `execution-${savedExecutionsById.size + 1}`,
                    ...value
                }
                savedExecutionsById.set(savedValue.id, savedValue)
                return savedValue
            }),
            findOneBy: jest.fn(async (where: Record<string, any>) => {
                if (where.id) return savedExecutionsById.get(where.id) || null

                const idempotencyKey = where.idempotencyKey
                if (!idempotencyKey) return null

                return (
                    Array.from(savedExecutionsById.values()).find(
                        (item) =>
                            item.workspaceId === where.workspaceId &&
                            item.organizationId === where.organizationId &&
                            item.idempotencyKey === idempotencyKey
                    ) || null
                )
            }),
            createQueryBuilder: jest.fn()
        }

        const credentialRepository = {
            create: jest.fn((value: Record<string, any>) => value),
            save: jest.fn(async (value: Record<string, any> | Record<string, any>[]) => {
                const rows = Array.isArray(value) ? value : [value]
                const savedRows = rows.map((row: Record<string, any>, index: number) => ({
                    id: row.id || `credential-${savedCredentialRowsById.size + index + 1}`,
                    ...row
                }))
                savedRows.forEach((row) => savedCredentialRowsById.set(row.id, row))
                return Array.isArray(value) ? savedRows : savedRows[0]
            }),
            findBy: jest.fn(async (where: Record<string, any>) => {
                if (where.usageExecutionId) {
                    return Array.from(savedCredentialRowsById.values()).filter((row) => row.usageExecutionId === where.usageExecutionId)
                }
                return []
            }),
            createQueryBuilder: jest.fn()
        }

        const credentialCallRepository = {
            create: jest.fn((value: Record<string, any>) => value),
            save: jest.fn(async (value: Record<string, any> | Record<string, any>[]) => {
                const rows = Array.isArray(value) ? value : [value]
                const savedRows = rows.map((row: Record<string, any>, index: number) => ({
                    id: row.id || `call-${savedCredentialCallRowsById.size + index + 1}`,
                    ...row
                }))
                savedRows.forEach((row) => savedCredentialCallRowsById.set(row.id, row))
                return Array.isArray(value) ? savedRows : savedRows[0]
            }),
            findBy: jest.fn(async (where: Record<string, any>) => {
                const credentialIds = Array.isArray(where.tokenUsageCredentialId?._value)
                    ? where.tokenUsageCredentialId._value
                    : where.tokenUsageCredentialId
                if (Array.isArray(credentialIds)) {
                    return Array.from(savedCredentialCallRowsById.values()).filter((row) =>
                        credentialIds.includes(row.tokenUsageCredentialId)
                    )
                }
                return []
            }),
            createQueryBuilder: jest.fn()
        }

        const workspaceCreditTransactionRepository = {
            findBy: jest.fn(async (where: Record<string, any>) => {
                const callIds = Array.isArray(where.tokenUsageCredentialCallId?._value)
                    ? where.tokenUsageCredentialCallId._value
                    : where.tokenUsageCredentialCallId
                const callIdList = Array.isArray(callIds) ? callIds : []

                return callIdList
                    .map((callId: string) => savedCredentialCallRowsById.get(callId))
                    .filter(Boolean)
                    .map((row: any) => ({
                        id: `transaction-${row.id}`,
                        workspaceId: 'workspace-1',
                        userId: 'user-1',
                        type: 'consume',
                        amount: row.billingMode === 'image_count' ? -220 : -100,
                        balance: 9000,
                        credentialId: savedCredentialRowsById.get(row.tokenUsageCredentialId)?.credentialId,
                        credentialName: savedCredentialRowsById.get(row.tokenUsageCredentialId)?.credentialName,
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

        return {
            executionRepository,
            credentialRepository,
            credentialCallRepository,
            savedExecutionsById,
            savedCredentialRowsById,
            savedCredentialCallRowsById
        }
    }

    it('records mixed token and image usages with ordered call-level settlement', async () => {
        const { savedExecutionsById, savedCredentialRowsById, savedCredentialCallRowsById } = setupUsageRepositories()
        mockConsumeCreditByBillingUsages.mockResolvedValue({
            creditConsumed: 420,
            creditBalance: 9580,
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
            idempotencyKey: 'usage-1',
            usagePayloads: [
                {
                    auditSource: 'llm_callback',
                    credentialId: 'credential-llm',
                    credentialName: 'DeepSeek Credential',
                    provider: 'chatDeepseek',
                    model: 'deepseek-chat',
                    tokenUsageCredentialCallId: 'call-llm-1',
                    output: {
                        usage_metadata: { input_tokens: 100, output_tokens: 50, total_tokens: 150 }
                    }
                },
                {
                    auditSource: 'llm_callback',
                    credentialId: 'credential-llm',
                    credentialName: 'DeepSeek Credential',
                    provider: 'chatDeepseek',
                    model: 'deepseek-chat',
                    tokenUsageCredentialCallId: 'call-llm-2',
                    output: {
                        usage_metadata: { input_tokens: 120, output_tokens: 30, total_tokens: 150 }
                    }
                },
                {
                    credentialId: 'credential-image',
                    credentialName: 'Doubao Credential',
                    provider: 'doubao',
                    model: 'doubao-seedream-5-0-260128',
                    source: 'media_generation',
                    billingMode: 'image_count',
                    tokenUsageCredentialCallId: 'call-img-1',
                    usage: { units: 1 }
                }
            ],
            credentialAccesses: [
                {
                    credentialId: 'credential-llm',
                    credentialName: 'DeepSeek Credential',
                    provider: 'chatDeepseek',
                    model: 'deepseek-chat',
                    tokenUsageCredentialCallId: 'call-llm-1'
                },
                {
                    credentialId: 'credential-llm',
                    credentialName: 'DeepSeek Credential',
                    provider: 'chatDeepseek',
                    model: 'deepseek-chat',
                    tokenUsageCredentialCallId: 'call-llm-2'
                },
                {
                    credentialId: 'credential-image',
                    credentialName: 'Doubao Credential',
                    provider: 'doubao',
                    model: 'doubao-seedream-5-0-260128',
                    tokenUsageCredentialCallId: 'call-img-1'
                }
            ]
        })

        const savedExecution = Array.from(savedExecutionsById.values())[0]
        const savedCredentialRows = Array.from(savedCredentialRowsById.values())
        const savedCallRows = Array.from(savedCredentialCallRowsById.values())

        expect(savedExecution).toEqual(
            expect.objectContaining({
                totalTokens: 300,
                inputTokens: 220,
                outputTokens: 80,
                imageCount: 1
            })
        )

        expect(savedCredentialRows).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    credentialId: 'credential-llm',
                    credentialName: 'DeepSeek Credential',
                    model: 'deepseek-chat',
                    totalTokens: 300,
                    imageCount: 0,
                    chargedCredit: 200
                }),
                expect.objectContaining({
                    credentialId: 'credential-image',
                    credentialName: 'Doubao Credential',
                    model: 'doubao-seedream-5-0-260128',
                    totalTokens: 0,
                    imageCount: 1,
                    chargedCredit: 220
                })
            ])
        )

        expect(savedCallRows).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: 'call-llm-1',
                    billingMode: 'token',
                    totalTokens: 150,
                    chargedCredit: 100
                }),
                expect.objectContaining({
                    id: 'call-llm-2',
                    billingMode: 'token',
                    totalTokens: 150,
                    chargedCredit: 100
                }),
                expect.objectContaining({
                    id: 'call-img-1',
                    billingMode: 'image_count',
                    imageCount: 1,
                    chargedCredit: 220
                })
            ])
        )

        expect(mockConsumeCreditByBillingUsages).toHaveBeenCalledTimes(1)
        expect(mockConsumeCreditByBillingUsages).toHaveBeenCalledWith('workspace-1', 'user-1', [
            expect.objectContaining({
                credentialId: 'credential-llm',
                tokenUsageCredentialCallId: 'call-llm-1',
                billingMode: 'token',
                usage: {
                    inputTokens: 100,
                    outputTokens: 50,
                    totalTokens: 150
                }
            }),
            expect.objectContaining({
                credentialId: 'credential-llm',
                tokenUsageCredentialCallId: 'call-llm-2',
                billingMode: 'token',
                usage: {
                    inputTokens: 120,
                    outputTokens: 30,
                    totalTokens: 150
                }
            }),
            expect.objectContaining({
                credentialId: 'credential-image',
                tokenUsageCredentialCallId: 'call-img-1',
                billingMode: 'image_count',
                usage: {
                    units: 1
                }
            })
        ])
    })

    it('normalizes token totals to input plus output and preserves raw provider total in breakdown', async () => {
        const { savedCredentialRowsById } = setupUsageRepositories()
        mockConsumeCreditByBillingUsages.mockResolvedValue({
            creditConsumed: 100,
            creditBalance: 9900,
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
            executionId: 'runtime-execution-2',
            chatId: 'chat-2',
            usagePayloads: [
                {
                    nodeId: 'llmAgentflow_0',
                    data: {
                        input: {
                            llmModelConfig: {
                                credential: 'credential-llm',
                                modelName: 'deepseek-chat',
                                llmModel: 'chatDeepseek'
                            }
                        },
                        output: {
                            usageMetadata: {
                                input_tokens: 100,
                                output_tokens: 50,
                                total_tokens: 300
                            }
                        }
                    }
                }
            ],
            credentialAccesses: [{ credentialId: 'credential-llm', credentialName: 'DeepSeek Credential' }]
        })

        const savedRow = Array.from(savedCredentialRowsById.values())[0]
        expect(savedRow).toEqual(
            expect.objectContaining({
                credentialId: 'credential-llm',
                credentialName: 'DeepSeek Credential',
                model: 'deepseek-chat',
                inputTokens: 100,
                outputTokens: 50,
                totalTokens: 150
            })
        )
        expect(JSON.parse(savedRow.usageBreakdown)).toEqual(
            expect.objectContaining({
                raw_total_tokens: 300
            })
        )

        expect(mockConsumeCreditByBillingUsages).toHaveBeenCalledWith('workspace-1', 'user-1', [
            expect.objectContaining({
                billingMode: 'token',
                usage: {
                    inputTokens: 100,
                    outputTokens: 50,
                    totalTokens: 150
                }
            })
        ])
    })

    it('does not persist or bill estimated-only token usage from legacy compatibility payloads', async () => {
        const { savedExecutionsById, savedCredentialRowsById, savedCredentialCallRowsById } = setupUsageRepositories()
        mockConsumeCreditByBillingUsages.mockResolvedValue({
            creditConsumed: 100,
            creditBalance: 9900,
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
            executionId: 'runtime-execution-estimated-1',
            chatId: 'chat-estimated-1',
            usagePayloads: [
                {
                    nodeId: 'llmAgentflow_6',
                    data: {
                        input: {
                            llmModelConfig: {
                                credential: 'credential-llm',
                                modelName: 'deepseek-chat',
                                llmModel: 'chatDeepseek'
                            }
                        },
                        output: {
                            estimatedTokenUsage: {
                                input_tokens: 60,
                                output_tokens: 40,
                                total_tokens: 100
                            }
                        }
                    }
                }
            ],
            credentialAccesses: []
        })

        expect(savedExecutionsById.size).toBe(0)
        expect(savedCredentialRowsById.size).toBe(0)
        expect(savedCredentialCallRowsById.size).toBe(0)
        expect(mockConsumeCreditByBillingUsages).not.toHaveBeenCalled()
    })

    it('reuses existing execution by idempotency key without duplicate billing', async () => {
        const { savedExecutionsById } = setupUsageRepositories()
        mockConsumeCreditByBillingUsages.mockResolvedValue({
            creditConsumed: 100,
            creditBalance: 9900,
            transactions: [],
            usageResults: []
        })

        const { TokenUsageService } = await import('../../../src/enterprise/services/token-usage.service')
        const service = new TokenUsageService()

        const input = {
            workspaceId: 'workspace-1',
            organizationId: 'org-1',
            userId: 'user-1',
            flowType: 'AGENTFLOW' as const,
            flowId: 'flow-1',
            executionId: 'runtime-execution-3',
            chatId: 'chat-3',
            idempotencyKey: 'idempotent-execution-1',
            usagePayloads: [
                {
                    auditSource: 'llm_callback',
                    credentialId: 'credential-llm',
                    credentialName: 'DeepSeek Credential',
                    provider: 'chatDeepseek',
                    model: 'deepseek-chat',
                    tokenUsageCredentialCallId: 'call-llm-idempotent',
                    output: {
                        usage_metadata: { input_tokens: 90, output_tokens: 10, total_tokens: 100 }
                    }
                }
            ],
            credentialAccesses: [
                {
                    credentialId: 'credential-llm',
                    credentialName: 'DeepSeek Credential',
                    provider: 'chatDeepseek',
                    model: 'deepseek-chat',
                    tokenUsageCredentialCallId: 'call-llm-idempotent'
                }
            ]
        }

        await service.recordTokenUsage(input)
        await service.recordTokenUsage(input)

        expect(mockConsumeCreditByBillingUsages).toHaveBeenCalledTimes(1)
        expect(savedExecutionsById.size).toBe(1)
        expect(Array.from(savedExecutionsById.values())[0]).toEqual(
            expect.objectContaining({
                inputTokens: 90,
                outputTokens: 10,
                totalTokens: 100
            })
        )
    })

    it('appends additional resume payloads to the same execution and charges only the new call ids', async () => {
        const { savedExecutionsById, savedCredentialRowsById, savedCredentialCallRowsById } = setupUsageRepositories()
        mockConsumeCreditByBillingUsages
            .mockResolvedValueOnce({
                creditConsumed: 30,
                creditBalance: 1970,
                transactions: [],
                usageResults: []
            })
            .mockResolvedValueOnce({
                creditConsumed: 120,
                creditBalance: 1850,
                transactions: [],
                usageResults: []
            })

        const { TokenUsageService } = await import('../../../src/enterprise/services/token-usage.service')
        const service = new TokenUsageService()

        const sharedExecutionIdentity = {
            workspaceId: 'workspace-1',
            organizationId: 'org-1',
            userId: 'user-1',
            flowType: 'AGENTFLOW' as const,
            flowId: 'flow-1',
            executionId: 'runtime-execution-resume-1',
            chatId: 'chat-resume-1',
            sessionId: 'session-resume-1'
        }

        await service.recordTokenUsage({
            ...sharedExecutionIdentity,
            idempotencyKey: 'AGENTFLOW:flow-1:runtime-execution-resume-1:chat-resume-1:session-resume-1',
            usagePayloads: [
                {
                    auditSource: 'llm_callback',
                    credentialId: 'credential-alibaba',
                    credentialName: 'Alibaba Credential',
                    provider: 'chatAlibabaTongyi',
                    model: 'qwen3.5-plus',
                    tokenUsageCredentialCallId: 'call-alibaba-1',
                    output: {
                        usage_metadata: { input_tokens: 266, output_tokens: 2075, total_tokens: 2341 }
                    }
                }
            ],
            credentialAccesses: [
                {
                    credentialId: 'credential-alibaba',
                    credentialName: 'Alibaba Credential',
                    provider: 'chatAlibabaTongyi',
                    model: 'qwen3.5-plus',
                    tokenUsageCredentialCallId: 'call-alibaba-1'
                }
            ]
        })

        await service.recordTokenUsage({
            ...sharedExecutionIdentity,
            idempotencyKey: 'AGENTFLOW:flow-1:runtime-execution-resume-1:chat-resume-1:session-resume-1',
            usagePayloads: [
                {
                    auditSource: 'llm_callback',
                    credentialId: 'credential-deepseek',
                    credentialName: 'DeepSeek Credential',
                    provider: 'chatDeepseek',
                    model: 'deepseek-chat',
                    tokenUsageCredentialCallId: 'call-deepseek-1',
                    output: {
                        usage_metadata: { input_tokens: 1803, output_tokens: 492, total_tokens: 2295 }
                    }
                },
                {
                    auditSource: 'llm_callback',
                    credentialId: 'credential-deepseek',
                    credentialName: 'DeepSeek Credential',
                    provider: 'chatDeepseek',
                    model: 'deepseek-chat',
                    tokenUsageCredentialCallId: 'call-deepseek-2',
                    output: {
                        usage_metadata: { input_tokens: 564, output_tokens: 1029, total_tokens: 1593 }
                    }
                }
            ],
            credentialAccesses: [
                {
                    credentialId: 'credential-deepseek',
                    credentialName: 'DeepSeek Credential',
                    provider: 'chatDeepseek',
                    model: 'deepseek-chat',
                    tokenUsageCredentialCallId: 'call-deepseek-1'
                },
                {
                    credentialId: 'credential-deepseek',
                    credentialName: 'DeepSeek Credential',
                    provider: 'chatDeepseek',
                    model: 'deepseek-chat',
                    tokenUsageCredentialCallId: 'call-deepseek-2'
                }
            ]
        })

        expect(mockConsumeCreditByBillingUsages).toHaveBeenCalledTimes(2)
        expect(savedExecutionsById.size).toBe(1)
        expect(Array.from(savedExecutionsById.values())[0]).toEqual(
            expect.objectContaining({
                inputTokens: 2633,
                outputTokens: 3596,
                totalTokens: 6229
            })
        )
        expect(Array.from(savedCredentialRowsById.values())).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    credentialId: 'credential-alibaba',
                    totalTokens: 2341
                }),
                expect.objectContaining({
                    credentialId: 'credential-deepseek',
                    totalTokens: 3888
                })
            ])
        )
        expect(Array.from(savedCredentialCallRowsById.values())).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: 'call-alibaba-1',
                    billingMode: 'token',
                    totalTokens: 2341
                }),
                expect.objectContaining({
                    id: 'call-deepseek-1',
                    billingMode: 'token',
                    totalTokens: 2295
                }),
                expect.objectContaining({
                    id: 'call-deepseek-2',
                    billingMode: 'token',
                    totalTokens: 1593
                })
            ])
        )
    })

    it('returns image and charged credit fields in usage details', async () => {
        const executionQueryBuilder = createQueryBuilderMock({
            count: 1,
            many: [
                {
                    id: 'execution-1',
                    workspaceId: 'workspace-1',
                    flowType: 'CHATFLOW',
                    flowId: 'flow-1',
                    executionId: 'run-1',
                    chatId: 'chat-1',
                    chatMessageId: 'message-1',
                    sessionId: 'session-1',
                    inputTokens: 120,
                    outputTokens: 45,
                    totalTokens: 165,
                    cacheReadTokens: 0,
                    cacheWriteTokens: 0,
                    reasoningTokens: 0,
                    acceptedPredictionTokens: 0,
                    rejectedPredictionTokens: 0,
                    audioInputTokens: 0,
                    audioOutputTokens: 0,
                    imageCount: 2,
                    videoCount: 0,
                    seconds: 0,
                    characters: 0,
                    usageBreakdown: JSON.stringify({ units: 2, generated_images: 2 }),
                    modelBreakdown: JSON.stringify({ 'doubao-seedream-5-0-250821': 165 }),
                    createdDate: new Date('2026-03-13T02:00:00.000Z')
                }
            ],
            rawOne: {
                inputTokens: 120,
                outputTokens: 45,
                totalTokens: 165,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
                reasoningTokens: 0,
                acceptedPredictionTokens: 0,
                rejectedPredictionTokens: 0,
                audioInputTokens: 0,
                audioOutputTokens: 0,
                imageCount: 2,
                videoCount: 0,
                seconds: 0,
                characters: 0
            }
        })

        const credentialQueryBuilder = createQueryBuilderMock({
            many: [
                {
                    id: 'credential-image',
                    usageExecutionId: 'execution-1',
                    credentialId: 'credential-image',
                    credentialName: 'Image Credential',
                    model: 'doubao-seedream-5-0-250821',
                    usageCount: 1,
                    attributionMode: 'ordered',
                    inputTokens: 120,
                    outputTokens: 45,
                    totalTokens: 165,
                    cacheReadTokens: 0,
                    cacheWriteTokens: 0,
                    reasoningTokens: 0,
                    acceptedPredictionTokens: 0,
                    rejectedPredictionTokens: 0,
                    audioInputTokens: 0,
                    audioOutputTokens: 0,
                    imageCount: 2,
                    videoCount: 0,
                    seconds: 0,
                    characters: 0,
                    usageBreakdown: JSON.stringify({ units: 2, generated_images: 2, source: 'media_generation' }),
                    chargedCredit: 220,
                    createdDate: new Date('2026-03-13T02:00:00.000Z')
                }
            ]
        })

        const credentialCallQueryBuilder = createQueryBuilderMock({ many: [] })

        mockGetRunningExpressApp.mockReturnValue({
            AppDataSource: {
                getRepository: jest.fn((entity: any) => {
                    if (entity === TokenUsageExecution) {
                        return {
                            createQueryBuilder: jest.fn(() => executionQueryBuilder)
                        }
                    }

                    if (entity === TokenUsageCredential) {
                        return {
                            createQueryBuilder: jest.fn(() => credentialQueryBuilder)
                        }
                    }

                    if (entity === TokenUsageCredentialCall) {
                        return {
                            createQueryBuilder: jest.fn(() => credentialCallQueryBuilder)
                        }
                    }

                    if (entity === ChatFlow) {
                        return {
                            findBy: jest.fn().mockResolvedValue([{ id: 'flow-1', name: 'Flow 1' }])
                        }
                    }

                    if (entity === Assistant) {
                        return {
                            findBy: jest.fn().mockResolvedValue([])
                        }
                    }

                    if (entity === User) {
                        return {
                            findOneBy: jest.fn().mockResolvedValue({
                                id: 'user-1',
                                name: 'User One',
                                email: 'user@example.com'
                            })
                        }
                    }

                    throw new Error(`Unexpected repository request: ${entity?.name || entity}`)
                })
            }
        })

        const { TokenUsageService } = await import('../../../src/enterprise/services/token-usage.service')
        const service = new TokenUsageService()
        const result = await service.getUsageDetailsByUser('org-1', 'user-1')

        expect(result.total).toEqual(
            expect.objectContaining({
                imageCount: 2,
                chargedCredit: 220
            })
        )
        expect(result.records[0]).toEqual(
            expect.objectContaining({
                flowName: 'Flow 1',
                imageCount: 2,
                chargedCredit: 220,
                usageBreakdown: expect.objectContaining({
                    units: 2,
                    generated_images: 2
                })
            })
        )
    })
})
