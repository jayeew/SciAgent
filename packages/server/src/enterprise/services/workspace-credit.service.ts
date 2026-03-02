import { StatusCodes } from 'http-status-codes'
import { DataSource, In } from 'typeorm'
import { InternalFlowiseError } from '../../errors/internalFlowiseError'
import { getRunningExpressApp } from '../../utils/getRunningExpressApp'
import { WorkspaceCreditTransaction, WorkspaceCreditTransactionType } from '../database/entities/workspace-credit-transaction.entity'
import { WorkspaceUser } from '../database/entities/workspace-user.entity'
import { Credential } from '../../database/entities/Credential'

interface IModelBillingConfig {
    multiplier: number
    rmbPerMTok: number
}

type ModelMultiplierSource = 'model_config' | 'default'
type RmbPriceSource = 'model_config' | 'missing'

const LEGACY_DEFAULT_RMB_PER_MTOK = 0
const ONE_MILLION_TOKENS = 1_000_000

const parseModelBillingConfigMap = (value?: string | null): Record<string, IModelBillingConfig> => {
    if (!value) return {}

    try {
        const parsed = JSON.parse(value)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

        const result: Record<string, IModelBillingConfig> = {}
        for (const [modelName, rawValue] of Object.entries(parsed)) {
            const normalizedModelName = modelName.trim()
            if (!normalizedModelName) continue

            if (typeof rawValue === 'number' || typeof rawValue === 'string') {
                const legacyMultiplier = Number(rawValue)
                if (!Number.isFinite(legacyMultiplier) || legacyMultiplier <= 0) continue
                result[normalizedModelName] = {
                    multiplier: legacyMultiplier,
                    rmbPerMTok: LEGACY_DEFAULT_RMB_PER_MTOK
                }
                continue
            }

            if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) continue

            const config = rawValue as Record<string, unknown>
            const multiplier = Number(config.multiplier)
            const rmbPerMTok = Number(config.rmbPerMTok)

            if (!Number.isFinite(multiplier) || multiplier <= 0) continue
            if (!Number.isFinite(rmbPerMTok) || rmbPerMTok < 0) continue

            result[normalizedModelName] = {
                multiplier,
                rmbPerMTok
            }
        }
        return result
    } catch {
        return {}
    }
}

const resolveBillingConfig = (
    credential: Credential | undefined,
    model: string | undefined
): {
    credentialMultiplier: number
    modelMultiplier: number
    modelMultiplierSource: ModelMultiplierSource
    rmbPerMTok: number
    rmbPriceSource: RmbPriceSource
} => {
    const defaultCredentialMultiplier = Number(credential?.creditConsumptionMultiplier)
    const credentialMultiplier =
        Number.isFinite(defaultCredentialMultiplier) && defaultCredentialMultiplier > 0 ? defaultCredentialMultiplier : 1
    const normalizedModel = typeof model === 'string' ? model.trim() : ''

    if (credential && normalizedModel) {
        const modelBillingConfigMap = parseModelBillingConfigMap(credential.creditConsumptionMultiplierByModel)
        const modelBillingConfig = modelBillingConfigMap[normalizedModel]

        if (modelBillingConfig) {
            return {
                credentialMultiplier,
                modelMultiplier: modelBillingConfig.multiplier,
                modelMultiplierSource: 'model_config',
                rmbPerMTok: modelBillingConfig.rmbPerMTok,
                rmbPriceSource: 'model_config'
            }
        }
    }

    return {
        credentialMultiplier,
        modelMultiplier: 1,
        modelMultiplierSource: 'default',
        rmbPerMTok: 0,
        rmbPriceSource: 'missing'
    }
}

const calculateBaseCreditFromRmb = (tokenCostRmb: number): number => {
    if (!Number.isFinite(tokenCostRmb) || tokenCostRmb <= 0) return 0
    // Round up to 2 decimals (1.121 => 1.13), then convert RMB to credits.
    return Math.ceil(tokenCostRmb * 100 - Number.EPSILON)
}

export const enum WorkspaceCreditErrorMessage {
    INVALID_AMOUNT = 'Invalid credit amount',
    WORKSPACE_USER_NOT_FOUND = 'Workspace User Not Found',
    INSUFFICIENT_CREDIT_FOR_MODEL_INTERACTION = 'Insufficient credit for model interaction. Please top up your credit and try again.',
    CHECKIN_REQUIRES_MIN_CREDIT = 'Current credit is lower than required minimum credit for check-in.',
    CHECKIN_ALREADY_CLAIMED = 'Daily check-in already claimed. Please try again after 24 hours.'
}

export class WorkspaceCreditService {
    private static readonly DEFAULT_MIN_CREDIT_TO_INTERACT = 1
    private static readonly CHECKIN_MIN_REWARD = 1
    private static readonly CHECKIN_MAX_REWARD = 100
    private static readonly CHECKIN_COOLDOWN_MS = 24 * 60 * 60 * 1000
    private dataSource: DataSource

    constructor() {
        const appServer = getRunningExpressApp()
        this.dataSource = appServer.AppDataSource
    }

    public getMinCreditToInteract(): number {
        const rawValue = process.env.WORKSPACE_MIN_CREDIT_TO_INTERACT
        if (rawValue === undefined || rawValue === null || rawValue === '') {
            return WorkspaceCreditService.DEFAULT_MIN_CREDIT_TO_INTERACT
        }

        const parsed = Number(rawValue)
        if (!Number.isFinite(parsed) || parsed < 0) {
            return WorkspaceCreditService.DEFAULT_MIN_CREDIT_TO_INTERACT
        }

        return parsed
    }

    public async assertSufficientCreditForModelInteraction(workspaceId: string, userId: string) {
        const minCreditToInteract = this.getMinCreditToInteract()
        if (minCreditToInteract <= 0) return

        const { credit } = await this.getCreditSummary(workspaceId, userId)
        if (credit < minCreditToInteract) {
            throw new InternalFlowiseError(
                StatusCodes.PAYMENT_REQUIRED,
                `${WorkspaceCreditErrorMessage.INSUFFICIENT_CREDIT_FOR_MODEL_INTERACTION} (current=${credit}, required=${minCreditToInteract})`
            )
        }
    }

    public async getCreditSummary(workspaceId: string, userId: string) {
        const queryRunner = this.dataSource.createQueryRunner()
        await queryRunner.connect()

        try {
            const workspaceUser = await queryRunner.manager.findOneBy(WorkspaceUser, {
                workspaceId,
                userId
            })

            if (!workspaceUser) {
                throw new InternalFlowiseError(StatusCodes.NOT_FOUND, WorkspaceCreditErrorMessage.WORKSPACE_USER_NOT_FOUND)
            }

            return {
                workspaceId,
                userId,
                credit: workspaceUser.credit ?? 0
            }
        } finally {
            if (!queryRunner.isReleased) await queryRunner.release()
        }
    }

    public async getTransactions(
        workspaceId: string,
        userId: string,
        options: {
            page?: number
            pageSize?: number
            startDate?: string
            endDate?: string
        } = {}
    ) {
        const queryRunner = this.dataSource.createQueryRunner()
        await queryRunner.connect()

        try {
            const workspaceUser = await queryRunner.manager.findOneBy(WorkspaceUser, {
                workspaceId,
                userId
            })

            if (!workspaceUser) {
                throw new InternalFlowiseError(StatusCodes.NOT_FOUND, WorkspaceCreditErrorMessage.WORKSPACE_USER_NOT_FOUND)
            }

            const normalizedPage = Number.isInteger(options.page) ? Math.max(1, Number(options.page)) : 1
            const normalizedPageSize = Number.isInteger(options.pageSize) ? Math.max(1, Math.min(Number(options.pageSize), 500)) : 100

            let normalizedStartDate: Date | undefined
            let normalizedEndDate: Date | undefined

            if (options.startDate) {
                const startRaw = /^\d{4}-\d{2}-\d{2}$/.test(options.startDate) ? `${options.startDate}T00:00:00.000Z` : options.startDate
                normalizedStartDate = new Date(startRaw)
                if (Number.isNaN(normalizedStartDate.getTime())) {
                    throw new InternalFlowiseError(StatusCodes.BAD_REQUEST, 'Invalid startDate')
                }
            }

            if (options.endDate) {
                const endRaw = /^\d{4}-\d{2}-\d{2}$/.test(options.endDate) ? `${options.endDate}T23:59:59.999Z` : options.endDate
                normalizedEndDate = new Date(endRaw)
                if (Number.isNaN(normalizedEndDate.getTime())) {
                    throw new InternalFlowiseError(StatusCodes.BAD_REQUEST, 'Invalid endDate')
                }
            }

            if (normalizedStartDate && normalizedEndDate && normalizedStartDate > normalizedEndDate) {
                throw new InternalFlowiseError(StatusCodes.BAD_REQUEST, 'startDate cannot be greater than endDate')
            }

            const qb = queryRunner.manager
                .createQueryBuilder(WorkspaceCreditTransaction, 'transaction')
                .where('transaction.workspaceId = :workspaceId', { workspaceId })
                .andWhere('transaction.userId = :userId', { userId })

            if (normalizedStartDate) {
                qb.andWhere('transaction.createdDate >= :startDate', { startDate: normalizedStartDate.toISOString() })
            }

            if (normalizedEndDate) {
                qb.andWhere('transaction.createdDate <= :endDate', { endDate: normalizedEndDate.toISOString() })
            }

            const [transactions, total] = await qb
                .orderBy('transaction.createdDate', 'DESC')
                .skip((normalizedPage - 1) * normalizedPageSize)
                .take(normalizedPageSize)
                .getManyAndCount()

            const totalPages = total > 0 ? Math.ceil(total / normalizedPageSize) : 0

            return {
                workspaceId,
                userId,
                credit: workspaceUser.credit ?? 0,
                transactions,
                pagination: {
                    page: normalizedPage,
                    pageSize: normalizedPageSize,
                    total,
                    totalPages
                }
            }
        } finally {
            if (!queryRunner.isReleased) await queryRunner.release()
        }
    }

    public async topupCredit(workspaceId: string, userId: string, amount: number, description?: string) {
        if (!Number.isInteger(amount) || amount <= 0) {
            throw new InternalFlowiseError(StatusCodes.BAD_REQUEST, WorkspaceCreditErrorMessage.INVALID_AMOUNT)
        }

        const queryRunner = this.dataSource.createQueryRunner()
        await queryRunner.connect()

        try {
            await queryRunner.startTransaction()

            const workspaceUser = await queryRunner.manager.findOneBy(WorkspaceUser, {
                workspaceId,
                userId
            })

            if (!workspaceUser) {
                throw new InternalFlowiseError(StatusCodes.NOT_FOUND, WorkspaceCreditErrorMessage.WORKSPACE_USER_NOT_FOUND)
            }

            workspaceUser.credit = (workspaceUser.credit ?? 0) + amount
            await queryRunner.manager.save(WorkspaceUser, workspaceUser)

            const transaction = queryRunner.manager.create(WorkspaceCreditTransaction, {
                workspaceId,
                userId,
                type: WorkspaceCreditTransactionType.TOPUP,
                amount,
                balance: workspaceUser.credit,
                description: description || 'Manual top-up'
            })
            const savedTransaction = await queryRunner.manager.save(WorkspaceCreditTransaction, transaction)

            await queryRunner.commitTransaction()

            return {
                workspaceId,
                userId,
                credit: workspaceUser.credit,
                transaction: savedTransaction
            }
        } catch (error) {
            if (queryRunner.isTransactionActive) await queryRunner.rollbackTransaction()
            throw error
        } finally {
            if (!queryRunner.isReleased) await queryRunner.release()
        }
    }

    public async dailyCheckIn(workspaceId: string, userId: string) {
        const queryRunner = this.dataSource.createQueryRunner()
        await queryRunner.connect()

        try {
            await queryRunner.startTransaction()

            const workspaceUser = await queryRunner.manager.findOneBy(WorkspaceUser, {
                workspaceId,
                userId
            })

            if (!workspaceUser) {
                throw new InternalFlowiseError(StatusCodes.NOT_FOUND, WorkspaceCreditErrorMessage.WORKSPACE_USER_NOT_FOUND)
            }

            const minCreditToInteract = this.getMinCreditToInteract()
            const currentCredit = workspaceUser.credit ?? 0
            if (currentCredit < minCreditToInteract) {
                throw new InternalFlowiseError(
                    StatusCodes.BAD_REQUEST,
                    `${WorkspaceCreditErrorMessage.CHECKIN_REQUIRES_MIN_CREDIT} (current=${currentCredit}, required=${minCreditToInteract})`
                )
            }

            const latestCheckInTransaction = await queryRunner.manager.findOne(WorkspaceCreditTransaction, {
                where: {
                    workspaceId,
                    userId,
                    type: WorkspaceCreditTransactionType.CHECKIN
                },
                order: {
                    createdDate: 'DESC'
                }
            })

            const now = new Date()
            if (latestCheckInTransaction?.createdDate) {
                const lastCheckInAt = new Date(latestCheckInTransaction.createdDate)
                const nextAvailableAt = new Date(lastCheckInAt.getTime() + WorkspaceCreditService.CHECKIN_COOLDOWN_MS)
                if (now.getTime() < nextAvailableAt.getTime()) {
                    throw new InternalFlowiseError(
                        StatusCodes.BAD_REQUEST,
                        `${WorkspaceCreditErrorMessage.CHECKIN_ALREADY_CLAIMED} (nextAvailableAt=${nextAvailableAt.toISOString()})`
                    )
                }
            }

            const reward =
                Math.floor(Math.random() * (WorkspaceCreditService.CHECKIN_MAX_REWARD - WorkspaceCreditService.CHECKIN_MIN_REWARD + 1)) +
                WorkspaceCreditService.CHECKIN_MIN_REWARD

            workspaceUser.credit = currentCredit + reward
            await queryRunner.manager.save(WorkspaceUser, workspaceUser)

            const transaction = queryRunner.manager.create(WorkspaceCreditTransaction, {
                workspaceId,
                userId,
                type: WorkspaceCreditTransactionType.CHECKIN,
                amount: reward,
                balance: workspaceUser.credit,
                description: 'Daily check-in reward'
            })
            const savedTransaction = await queryRunner.manager.save(WorkspaceCreditTransaction, transaction)

            await queryRunner.commitTransaction()

            return {
                workspaceId,
                userId,
                reward,
                credit: workspaceUser.credit,
                nextAvailableAt: new Date(now.getTime() + WorkspaceCreditService.CHECKIN_COOLDOWN_MS).toISOString(),
                transaction: savedTransaction
            }
        } catch (error) {
            if (queryRunner.isTransactionActive) await queryRunner.rollbackTransaction()
            throw error
        } finally {
            if (!queryRunner.isReleased) await queryRunner.release()
        }
    }

    public async consumeCreditByCredentialUsages(
        workspaceId: string,
        userId: string,
        usages: Array<{ credentialId?: string; credentialName?: string; model?: string; totalTokens: number }>
    ) {
        const validUsages = usages.filter((usage) => usage.totalTokens > 0)
        if (!validUsages.length) {
            return { workspaceId, userId, creditConsumed: 0, transactions: [] as WorkspaceCreditTransaction[] }
        }

        const queryRunner = this.dataSource.createQueryRunner()
        await queryRunner.connect()

        try {
            await queryRunner.startTransaction()

            const workspaceUser = await queryRunner.manager.findOneBy(WorkspaceUser, {
                workspaceId,
                userId
            })

            if (!workspaceUser) {
                throw new InternalFlowiseError(StatusCodes.NOT_FOUND, WorkspaceCreditErrorMessage.WORKSPACE_USER_NOT_FOUND)
            }

            const credentialIds = validUsages.map((usage) => usage.credentialId).filter((id): id is string => !!id)
            const credentials = credentialIds.length ? await queryRunner.manager.findBy(Credential, { id: In(credentialIds) }) : []
            const credentialMap = new Map(credentials.map((credential) => [credential.id, credential]))

            let totalCreditConsumed = 0
            const transactions: WorkspaceCreditTransaction[] = []

            for (const usage of validUsages) {
                const credential = usage.credentialId ? credentialMap.get(usage.credentialId) : undefined
                const { credentialMultiplier, modelMultiplier, modelMultiplierSource, rmbPerMTok, rmbPriceSource } = resolveBillingConfig(
                    credential,
                    usage.model
                )
                const tokenCostRmb = (usage.totalTokens / ONE_MILLION_TOKENS) * rmbPerMTok
                const baseCredit = calculateBaseCreditFromRmb(tokenCostRmb)
                const consumed = Math.ceil(baseCredit * modelMultiplier * credentialMultiplier - Number.EPSILON)
                if (consumed <= 0) continue

                workspaceUser.credit = (workspaceUser.credit ?? 0) - consumed
                totalCreditConsumed += consumed

                const transaction = queryRunner.manager.create(WorkspaceCreditTransaction, {
                    workspaceId,
                    userId,
                    type: WorkspaceCreditTransactionType.CONSUME,
                    amount: -consumed,
                    balance: workspaceUser.credit,
                    credentialName: usage.credentialName || credential?.name || 'Unknown Credential',
                    credentialId: usage.credentialId,
                    description: `Token consumption: totalTokens=${usage.totalTokens}, model=${
                        usage.model || 'unknown'
                    }, rmbPerMTok=${rmbPerMTok}, tokenCostRmb=${tokenCostRmb.toFixed(
                        6
                    )}, baseCredit=${baseCredit}, modelMultiplier=${modelMultiplier}, modelMultiplierSource=${modelMultiplierSource}, credentialMultiplier=${credentialMultiplier}, rmbPriceSource=${rmbPriceSource}`
                })

                const saved = await queryRunner.manager.save(WorkspaceCreditTransaction, transaction)
                transactions.push(saved)
            }

            await queryRunner.manager.save(WorkspaceUser, workspaceUser)
            await queryRunner.commitTransaction()

            return {
                workspaceId,
                userId,
                creditConsumed: totalCreditConsumed,
                creditBalance: workspaceUser.credit,
                transactions
            }
        } catch (error) {
            if (queryRunner.isTransactionActive) await queryRunner.rollbackTransaction()
            throw error
        } finally {
            if (!queryRunner.isReleased) await queryRunner.release()
        }
    }
}
