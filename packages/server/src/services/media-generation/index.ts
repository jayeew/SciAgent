import logger from '../../utils/logger'
import { WorkspaceCreditService } from '../../enterprise/services/workspace-credit.service'
import { ICommonObject } from 'flowise-components'
import { CredentialBillingMode, ICredentialBillingUsage } from '../../Interface'
import { v4 as uuidv4 } from 'uuid'

const BILLING_MODES = new Set<CredentialBillingMode>(['token', 'image_count', 'video_count', 'seconds', 'characters'])

interface IConsumeMediaGenerationCreditParams {
    workspaceId?: string
    userId?: string
    billingDetails?: ICredentialBillingUsage
}

interface IRecordMediaGenerationCredentialAccessParams {
    billingDetails?: ICredentialBillingUsage
    tokenAuditContext?: ICommonObject
    options: ICommonObject
}

const normalizeUsageMetric = (value: unknown): number | undefined => {
    const numericValue = Number(value)
    return Number.isFinite(numericValue) && numericValue >= 0 ? numericValue : undefined
}

const getUsageMetricValue = (billingMode: CredentialBillingMode, usage: ICredentialBillingUsage['usage']): number => {
    switch (billingMode) {
        case 'token':
            return (
                normalizeUsageMetric(usage.inputTokens) ||
                normalizeUsageMetric(usage.outputTokens) ||
                normalizeUsageMetric(usage.totalTokens) ||
                0
            )
        case 'image_count':
        case 'video_count':
            return normalizeUsageMetric(usage.units) || 0
        case 'seconds':
            return normalizeUsageMetric(usage.seconds) || 0
        case 'characters':
            return normalizeUsageMetric(usage.characters) || 0
        default:
            return 0
    }
}

const getMediaGenerationBillingDetails = (result?: ICommonObject): ICredentialBillingUsage | undefined => {
    const billingDetails = result?.mediaBilling as ICommonObject | undefined
    if (!billingDetails || typeof billingDetails !== 'object') return undefined

    const billingMode =
        typeof billingDetails.billingMode === 'string' && BILLING_MODES.has(billingDetails.billingMode as CredentialBillingMode)
            ? (billingDetails.billingMode as CredentialBillingMode)
            : undefined
    if (!billingMode) return undefined

    const usageRecord = billingDetails.usage && typeof billingDetails.usage === 'object' ? (billingDetails.usage as ICommonObject) : {}

    return {
        provider: typeof billingDetails.provider === 'string' ? billingDetails.provider : 'unknown',
        credentialId: typeof billingDetails.credentialId === 'string' ? billingDetails.credentialId : undefined,
        model: typeof billingDetails.model === 'string' ? billingDetails.model : undefined,
        source: typeof billingDetails.source === 'string' ? billingDetails.source : 'media_generation',
        tokenUsageCredentialCallId:
            typeof billingDetails.tokenUsageCredentialCallId === 'string' ? billingDetails.tokenUsageCredentialCallId : undefined,
        billingMode,
        usage: {
            ...(typeof normalizeUsageMetric(usageRecord.inputTokens) === 'number'
                ? { inputTokens: normalizeUsageMetric(usageRecord.inputTokens) }
                : {}),
            ...(typeof normalizeUsageMetric(usageRecord.outputTokens) === 'number'
                ? { outputTokens: normalizeUsageMetric(usageRecord.outputTokens) }
                : {}),
            ...(typeof normalizeUsageMetric(usageRecord.totalTokens) === 'number'
                ? { totalTokens: normalizeUsageMetric(usageRecord.totalTokens) }
                : {}),
            ...(typeof normalizeUsageMetric(usageRecord.units) === 'number' ? { units: normalizeUsageMetric(usageRecord.units) } : {}),
            ...(typeof normalizeUsageMetric(usageRecord.seconds) === 'number'
                ? { seconds: normalizeUsageMetric(usageRecord.seconds) }
                : {}),
            ...(typeof normalizeUsageMetric(usageRecord.characters) === 'number'
                ? { characters: normalizeUsageMetric(usageRecord.characters) }
                : {})
        }
    }
}

const ensureMediaGenerationCredentialCallId = (billingDetails?: ICommonObject): string | undefined => {
    if (!billingDetails || typeof billingDetails !== 'object') return undefined

    if (typeof billingDetails.tokenUsageCredentialCallId === 'string' && billingDetails.tokenUsageCredentialCallId.trim()) {
        return billingDetails.tokenUsageCredentialCallId.trim()
    }

    const tokenUsageCredentialCallId = uuidv4()
    billingDetails.tokenUsageCredentialCallId = tokenUsageCredentialCallId
    return tokenUsageCredentialCallId
}

const consumeMediaGenerationCredit = async (params: IConsumeMediaGenerationCreditParams) => {
    const { workspaceId, userId, billingDetails } = params
    if (!workspaceId || !userId || !billingDetails) return undefined
    if (getUsageMetricValue(billingDetails.billingMode, billingDetails.usage) <= 0) return undefined

    const workspaceCreditService = new WorkspaceCreditService()
    await workspaceCreditService.consumeCreditByBillingUsages(workspaceId, userId, [billingDetails])

    logger.info(
        `[media-generation] credit consumed credentialId=${billingDetails.credentialId || '-'} model=${
            billingDetails.model || '-'
        } billingMode=${billingDetails.billingMode} usage=${JSON.stringify(billingDetails.usage)}`
    )

    return billingDetails
}

const getCredentialAccessForUsage = async (
    credentialId: string | undefined,
    model: string | undefined,
    options: ICommonObject
): Promise<{ credentialId?: string; credentialName?: string; model?: string } | undefined> => {
    if (!credentialId) return undefined

    const appDataSource = options.appDataSource
    const credentialEntity = options.databaseEntities?.Credential
    if (!appDataSource || !credentialEntity) {
        return {
            credentialId,
            model
        }
    }

    try {
        const credential = await appDataSource.getRepository(credentialEntity).findOneBy({ id: credentialId })
        return {
            credentialId,
            credentialName: credential?.name || credential?.credentialName,
            model
        }
    } catch (error) {
        logger.warn(
            `[media-generation] failed to resolve credential name for usage credentialId=${credentialId}: ${
                error instanceof Error ? error.message : error
            }`
        )
        return {
            credentialId,
            model
        }
    }
}

const recordMediaGenerationCredentialAccess = async (params: IRecordMediaGenerationCredentialAccessParams) => {
    const { billingDetails, tokenAuditContext, options } = params
    if (!billingDetails || !tokenAuditContext) return undefined

    const credentialAccess = await getCredentialAccessForUsage(billingDetails.credentialId, billingDetails.model, options)
    if (!credentialAccess) return undefined

    if (!Array.isArray(tokenAuditContext.credentialAccesses)) {
        tokenAuditContext.credentialAccesses = []
    }

    tokenAuditContext.credentialAccesses.push(credentialAccess)
    return credentialAccess
}

export default {
    ensureMediaGenerationCredentialCallId,
    getMediaGenerationBillingDetails,
    consumeMediaGenerationCredit,
    getCredentialAccessForUsage,
    recordMediaGenerationCredentialAccess
}
