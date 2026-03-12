import { StatusCodes } from 'http-status-codes'
import { DataSource, In } from 'typeorm'
import { CredentialBillingMode, ICredentialBillingRule, ICredentialBillingUsage, ICredentialTokenBillingRule } from '../../Interface'
import { InternalFlowiseError } from '../../errors/internalFlowiseError'
import { getRunningExpressApp } from '../../utils/getRunningExpressApp'
import { WorkspaceCreditTransaction, WorkspaceCreditTransactionType } from '../database/entities/workspace-credit-transaction.entity'
import { WorkspaceUser } from '../database/entities/workspace-user.entity'
import { Credential } from '../../database/entities/Credential'
import { decryptCredentialData } from '../../utils'
import {
    calculateBaseCreditFromRmb,
    getNormalizedCredentialMultiplier,
    getNormalizedTokenUsage,
    getResolvedRuleForUsage
} from '../../utils/credentialBilling'
import logger from '../../utils/logger'

const getUsageMetricValue = (billingMode: CredentialBillingMode, usage: ICredentialBillingUsage['usage']): number => {
    switch (billingMode) {
        case 'token':
            return getNormalizedTokenUsage(usage).billableTotalTokens
        case 'image_count':
        case 'video_count': {
            const units = Number(usage.units)
            return Number.isFinite(units) && units > 0 ? units : 0
        }
        case 'seconds': {
            const seconds = Number(usage.seconds)
            return Number.isFinite(seconds) && seconds > 0 ? seconds : 0
        }
        case 'characters': {
            const characters = Number(usage.characters)
            return Number.isFinite(characters) && characters > 0 ? characters : 0
        }
        default:
            return 0
    }
}

const buildUsageDescription = (
    usage: ICredentialBillingUsage,
    rule: ICredentialBillingRule,
    ruleSource: string,
    credentialMultiplier: number
) => {
    switch (usage.billingMode) {
        case 'token': {
            const tokenRule = rule as ICredentialTokenBillingRule
            const normalizedTokenUsage = getNormalizedTokenUsage(usage.usage)
            const inputTokenCostRmb = (normalizedTokenUsage.billableInputTokens / 1_000_000) * tokenRule.inputRmbPerMTok
            const outputTokenCostRmb = (normalizedTokenUsage.billableOutputTokens / 1_000_000) * tokenRule.outputRmbPerMTok
            const tokenCostRmb = inputTokenCostRmb + outputTokenCostRmb
            const baseCredit = calculateBaseCreditFromRmb(tokenCostRmb)

            return `Token consumption: billingMode=token, source=${usage.source || 'unknown'}, model=${
                usage.model || 'unknown'
            }, inputTokens=${normalizedTokenUsage.billableInputTokens}, outputTokens=${
                normalizedTokenUsage.billableOutputTokens
            }, totalTokens=${normalizedTokenUsage.totalTokens}, inputRmbPerMTok=${tokenRule.inputRmbPerMTok}, outputRmbPerMTok=${
                tokenRule.outputRmbPerMTok
            }, tokenCostRmb=${tokenCostRmb.toFixed(6)}, baseCredit=${baseCredit}, ruleMultiplier=${
                rule.multiplier
            }, credentialMultiplier=${credentialMultiplier}, ruleSource=${ruleSource}`
        }
        case 'image_count':
        case 'video_count': {
            const units = getUsageMetricValue(usage.billingMode, usage.usage)
            const rmbPerUnit = 'rmbPerUnit' in rule ? rule.rmbPerUnit : 0
            const costRmb = units * rmbPerUnit
            const baseCredit = calculateBaseCreditFromRmb(costRmb)

            return `Media consumption: billingMode=${usage.billingMode}, source=${usage.source || 'unknown'}, model=${
                usage.model || 'unknown'
            }, units=${units}, rmbPerUnit=${rmbPerUnit}, costRmb=${costRmb.toFixed(6)}, baseCredit=${baseCredit}, ruleMultiplier=${
                rule.multiplier
            }, credentialMultiplier=${credentialMultiplier}, ruleSource=${ruleSource}`
        }
        case 'seconds': {
            const seconds = getUsageMetricValue(usage.billingMode, usage.usage)
            const costRmb = seconds * ('rmbPerSecond' in rule ? rule.rmbPerSecond : 0)
            const baseCredit = calculateBaseCreditFromRmb(costRmb)

            return `Speech duration consumption: billingMode=seconds, source=${usage.source || 'unknown'}, model=${
                usage.model || 'unknown'
            }, seconds=${seconds}, rmbPerSecond=${'rmbPerSecond' in rule ? rule.rmbPerSecond : 0}, costRmb=${costRmb.toFixed(
                6
            )}, baseCredit=${baseCredit}, ruleMultiplier=${
                rule.multiplier
            }, credentialMultiplier=${credentialMultiplier}, ruleSource=${ruleSource}`
        }
        case 'characters': {
            const characters = getUsageMetricValue(usage.billingMode, usage.usage)
            const rmbPer10kChars = 'rmbPer10kChars' in rule ? rule.rmbPer10kChars : 0
            const costRmb = (characters / 10_000) * rmbPer10kChars
            const baseCredit = calculateBaseCreditFromRmb(costRmb)

            return `Text-to-speech consumption: billingMode=characters, source=${usage.source || 'unknown'}, model=${
                usage.model || 'unknown'
            }, characters=${characters}, rmbPer10kChars=${rmbPer10kChars}, costRmb=${costRmb.toFixed(
                6
            )}, baseCredit=${baseCredit}, ruleMultiplier=${
                rule.multiplier
            }, credentialMultiplier=${credentialMultiplier}, ruleSource=${ruleSource}`
        }
        default:
            return `Billing consumption: billingMode=${usage.billingMode}, source=${usage.source || 'unknown'}, model=${
                usage.model || 'unknown'
            }`
    }
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

    public async consumeCreditByBillingUsages(workspaceId: string, userId: string, usages: ICredentialBillingUsage[]) {
        const normalizedUsages = (Array.isArray(usages) ? usages : []).filter((usage): usage is ICredentialBillingUsage => {
            if (!usage || typeof usage !== 'object') return false

            const usageMetric = getUsageMetricValue(usage.billingMode, usage.usage || {})
            if (usageMetric <= 0) {
                logger.info(
                    `[workspace-credit] skip usage with empty metric workspaceId=${workspaceId} userId=${userId} credentialId=${
                        usage.credentialId || '-'
                    } model=${usage.model || 'unknown'} billingMode=${usage.billingMode}`
                )
                return false
            }

            return true
        })

        if (!normalizedUsages.length) {
            logger.info(`[workspace-credit] skip consume: no valid billing usages workspaceId=${workspaceId} userId=${userId}`)
            return {
                workspaceId,
                userId,
                creditConsumed: 0,
                transactions: [] as WorkspaceCreditTransaction[],
                usageResults: [] as Array<{
                    usage: ICredentialBillingUsage
                    chargedCredit: number
                    transaction: WorkspaceCreditTransaction | null
                }>
            }
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

            const credentialIds = normalizedUsages.map((usage) => usage.credentialId).filter((id): id is string => !!id)
            const credentials = credentialIds.length ? await queryRunner.manager.findBy(Credential, { id: In(credentialIds) }) : []
            const credentialMap = new Map(credentials.map((credential) => [credential.id, credential]))
            const decryptedCredentialMap = new Map<string, Record<string, unknown>>()

            let totalCreditConsumed = 0
            const transactions: WorkspaceCreditTransaction[] = []
            const usageResults: Array<{
                usage: ICredentialBillingUsage
                chargedCredit: number
                transaction: WorkspaceCreditTransaction | null
            }> = []

            for (const usage of normalizedUsages) {
                const credential = usage.credentialId ? credentialMap.get(usage.credentialId) : undefined
                let decryptedCredentialData: Record<string, unknown> | undefined

                if (credential?.id) {
                    if (decryptedCredentialMap.has(credential.id)) {
                        decryptedCredentialData = decryptedCredentialMap.get(credential.id)
                    } else {
                        try {
                            decryptedCredentialData = await decryptCredentialData(credential.encryptedData)
                            decryptedCredentialMap.set(credential.id, decryptedCredentialData)
                        } catch (error) {
                            logger.warn(
                                `[workspace-credit] failed to decrypt credential for legacy billing fallback credentialId=${
                                    credential.id
                                }: ${error instanceof Error ? error.message : error}`
                            )
                            decryptedCredentialData = undefined
                        }
                    }
                }

                const resolvedRule = getResolvedRuleForUsage(credential, decryptedCredentialData, usage)
                if (!resolvedRule.rule) {
                    logger.warn(
                        `[workspace-credit] missing billing rule workspaceId=${workspaceId} userId=${userId} credentialId=${
                            usage.credentialId || '-'
                        } provider=${usage.provider || 'unknown'} model=${usage.model || 'unknown'} billingMode=${usage.billingMode}`
                    )
                    usageResults.push({
                        usage,
                        chargedCredit: 0,
                        transaction: null
                    })
                    continue
                }

                if (resolvedRule.modeMismatch) {
                    logger.warn(
                        `[workspace-credit] billing rule mode mismatch workspaceId=${workspaceId} userId=${userId} credentialId=${
                            usage.credentialId || '-'
                        } provider=${usage.provider || 'unknown'} model=${usage.model || 'unknown'} usageBillingMode=${
                            usage.billingMode
                        } ruleBillingMode=${resolvedRule.rule.billingMode}`
                    )
                    usageResults.push({
                        usage,
                        chargedCredit: 0,
                        transaction: null
                    })
                    continue
                }

                const credentialMultiplier = getNormalizedCredentialMultiplier(credential)
                const credentialName = usage.credentialName || credential?.name || credential?.credentialName || 'Unknown Credential'

                let costRmb = 0
                switch (usage.billingMode) {
                    case 'token': {
                        const tokenRule = resolvedRule.rule as ICredentialTokenBillingRule
                        const normalizedTokenUsage = getNormalizedTokenUsage(usage.usage)
                        const inputTokenCostRmb = (normalizedTokenUsage.billableInputTokens / 1_000_000) * tokenRule.inputRmbPerMTok
                        const outputTokenCostRmb = (normalizedTokenUsage.billableOutputTokens / 1_000_000) * tokenRule.outputRmbPerMTok
                        costRmb = inputTokenCostRmb + outputTokenCostRmb
                        break
                    }
                    case 'image_count':
                    case 'video_count':
                        costRmb =
                            getUsageMetricValue(usage.billingMode, usage.usage) *
                            ('rmbPerUnit' in resolvedRule.rule ? resolvedRule.rule.rmbPerUnit : 0)
                        break
                    case 'seconds':
                        costRmb =
                            getUsageMetricValue(usage.billingMode, usage.usage) *
                            ('rmbPerSecond' in resolvedRule.rule ? resolvedRule.rule.rmbPerSecond : 0)
                        break
                    case 'characters':
                        costRmb =
                            (getUsageMetricValue(usage.billingMode, usage.usage) / 10_000) *
                            ('rmbPer10kChars' in resolvedRule.rule ? resolvedRule.rule.rmbPer10kChars : 0)
                        break
                    default:
                        costRmb = 0
                }

                const baseCredit = calculateBaseCreditFromRmb(costRmb)
                const consumed = Math.ceil(baseCredit * resolvedRule.rule.multiplier * credentialMultiplier - Number.EPSILON)

                if (consumed <= 0) {
                    logger.info(
                        `[workspace-credit] skip usage charge workspaceId=${workspaceId} userId=${userId} credentialId=${
                            usage.credentialId || '-'
                        } provider=${usage.provider || 'unknown'} model=${usage.model || 'unknown'} billingMode=${
                            usage.billingMode
                        } costRmb=${costRmb.toFixed(6)} baseCredit=${baseCredit} ruleMultiplier=${
                            resolvedRule.rule.multiplier
                        } credentialMultiplier=${credentialMultiplier}`
                    )
                    usageResults.push({
                        usage,
                        chargedCredit: 0,
                        transaction: null
                    })
                    continue
                }

                workspaceUser.credit = (workspaceUser.credit ?? 0) - consumed
                totalCreditConsumed += consumed

                const transaction = queryRunner.manager.create(WorkspaceCreditTransaction, {
                    workspaceId,
                    userId,
                    type: WorkspaceCreditTransactionType.CONSUME,
                    amount: -consumed,
                    balance: workspaceUser.credit,
                    credentialName,
                    credentialId: usage.credentialId,
                    tokenUsageCredentialCallId: usage.tokenUsageCredentialCallId,
                    description: `${buildUsageDescription(
                        usage,
                        resolvedRule.rule,
                        resolvedRule.source,
                        credentialMultiplier
                    )}, chargedCredit=${consumed}`
                })

                const savedTransaction = await queryRunner.manager.save(WorkspaceCreditTransaction, transaction)
                transactions.push(savedTransaction)
                usageResults.push({
                    usage,
                    chargedCredit: consumed,
                    transaction: savedTransaction
                })
                logger.info(
                    `[workspace-credit] consumed=${consumed} workspaceId=${workspaceId} userId=${userId} credentialId=${
                        usage.credentialId || '-'
                    } provider=${usage.provider || 'unknown'} model=${usage.model || 'unknown'} billingMode=${usage.billingMode} balance=${
                        workspaceUser.credit
                    } ruleSource=${resolvedRule.source}`
                )
            }

            await queryRunner.manager.save(WorkspaceUser, workspaceUser)
            await queryRunner.commitTransaction()

            return {
                workspaceId,
                userId,
                creditConsumed: totalCreditConsumed,
                creditBalance: workspaceUser.credit,
                transactions,
                usageResults
            }
        } catch (error) {
            if (queryRunner.isTransactionActive) await queryRunner.rollbackTransaction()
            logger.error(`[workspace-credit] unified consume failed workspaceId=${workspaceId} userId=${userId}`, error)
            throw error
        } finally {
            if (!queryRunner.isReleased) await queryRunner.release()
        }
    }

    public async consumeCreditBySpeechSeconds(
        workspaceId: string,
        userId: string,
        usage: {
            credentialId?: string
            credentialName?: string
            provider?: string
            model?: string
            seconds: number
        }
    ) {
        const normalizedSeconds = Number(usage.seconds)
        if (!Number.isFinite(normalizedSeconds) || normalizedSeconds < 0) {
            throw new InternalFlowiseError(StatusCodes.BAD_REQUEST, 'Invalid speech duration in seconds')
        }

        const result = await this.consumeCreditByBillingUsages(workspaceId, userId, [
            {
                credentialId: usage.credentialId,
                credentialName: usage.credentialName,
                provider: usage.provider,
                model: usage.model,
                source: 'speech_to_text',
                billingMode: 'seconds',
                usage: {
                    seconds: normalizedSeconds
                }
            }
        ])

        return {
            ...result,
            transaction: result.transactions?.[0] || null
        }
    }

    public async consumeCreditByTextCharacters(
        workspaceId: string,
        userId: string,
        usage: {
            credentialId?: string
            credentialName?: string
            provider?: string
            model?: string
            characters: number
        }
    ) {
        const normalizedCharacters = Number(usage.characters)
        if (!Number.isFinite(normalizedCharacters) || normalizedCharacters < 0) {
            throw new InternalFlowiseError(StatusCodes.BAD_REQUEST, 'Invalid text-to-speech character count')
        }

        const result = await this.consumeCreditByBillingUsages(workspaceId, userId, [
            {
                credentialId: usage.credentialId,
                credentialName: usage.credentialName,
                provider: usage.provider,
                model: usage.model,
                source: 'text_to_speech',
                billingMode: 'characters',
                usage: {
                    characters: normalizedCharacters
                }
            }
        ])

        return {
            ...result,
            transaction: result.transactions?.[0] || null
        }
    }

    public async consumeCreditByCredentialUsages(
        workspaceId: string,
        userId: string,
        usages: Array<{
            credentialId?: string
            credentialName?: string
            model?: string
            totalTokens: number
            inputTokens?: number
            outputTokens?: number
            tokenUsageCredentialCallId?: string
            usageBreakdown?: Record<string, any>
        }>
    ) {
        const billingUsages = usages
            .filter((usage) => {
                const usageSource = typeof usage.usageBreakdown?.source === 'string' ? usage.usageBreakdown.source : undefined
                const generatedImages = Number(usage.usageBreakdown?.generated_images) || Number(usage.usageBreakdown?.generatedimages) || 0

                if (usageSource === 'media_generation') {
                    logger.info(
                        `[workspace-credit] skip token charge for separately billed media usage workspaceId=${workspaceId} userId=${userId} credentialId=${
                            usage.credentialId || '-'
                        } model=${usage.model || 'unknown'} source=${usageSource}`
                    )
                    return false
                }

                if (generatedImages > 0) {
                    logger.info(
                        `[workspace-credit] skip token charge for media usage workspaceId=${workspaceId} userId=${userId} credentialId=${
                            usage.credentialId || '-'
                        } model=${usage.model || 'unknown'} generatedImages=${generatedImages}`
                    )
                    return false
                }

                return true
            })
            .map((usage) => ({
                credentialId: usage.credentialId,
                credentialName: usage.credentialName,
                model: usage.model,
                source: typeof usage.usageBreakdown?.source === 'string' ? usage.usageBreakdown.source : undefined,
                tokenUsageCredentialCallId: usage.tokenUsageCredentialCallId,
                billingMode: 'token' as const,
                usage: {
                    inputTokens: usage.inputTokens,
                    outputTokens: usage.outputTokens,
                    totalTokens: usage.totalTokens
                }
            }))

        const requestedTokenTotal = billingUsages.reduce((sum, usage) => sum + getNormalizedTokenUsage(usage.usage).billableTotalTokens, 0)
        logger.info(
            `[workspace-credit] start consume workspaceId=${workspaceId} userId=${userId} usageCount=${billingUsages.length} requestedTokens=${requestedTokenTotal}`
        )

        return this.consumeCreditByBillingUsages(workspaceId, userId, billingUsages)
    }

    public async consumeCreditByGeneratedImages(
        workspaceId: string,
        userId: string,
        usage: {
            credentialId?: string
            credentialName?: string
            provider?: string
            model?: string
            generatedImages: number
        }
    ) {
        const normalizedGeneratedImages = Number(usage.generatedImages)
        if (!Number.isFinite(normalizedGeneratedImages) || normalizedGeneratedImages < 0) {
            throw new InternalFlowiseError(StatusCodes.BAD_REQUEST, 'Invalid generated image count')
        }

        const result = await this.consumeCreditByBillingUsages(workspaceId, userId, [
            {
                credentialId: usage.credentialId,
                credentialName: usage.credentialName,
                provider: usage.provider,
                model: usage.model,
                source: 'media_generation',
                billingMode: 'image_count',
                usage: {
                    units: normalizedGeneratedImages
                }
            }
        ])

        return {
            ...result,
            transaction: result.transactions?.[0] || null
        }
    }
}
