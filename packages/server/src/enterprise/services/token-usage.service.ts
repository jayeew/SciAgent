import { createHash } from 'crypto'
import { DataSource, In } from 'typeorm'
import { v4 as uuidv4 } from 'uuid'
import { CredentialBillingMode, ICredentialBillingUsage } from '../../Interface'
import { ChatFlow } from '../../database/entities/ChatFlow'
import { Assistant } from '../../database/entities/Assistant'
import logger from '../../utils/logger'
import { getRunningExpressApp } from '../../utils/getRunningExpressApp'
import { TokenUsageCredential } from '../database/entities/token-usage-credential.entity'
import { TokenUsageCredentialCall } from '../database/entities/token-usage-credential-call.entity'
import { TokenUsageExecution } from '../database/entities/token-usage-execution.entity'
import { User } from '../database/entities/user.entity'
import { WorkspaceCreditTransaction } from '../database/entities/workspace-credit-transaction.entity'
import { WorkspaceCreditService } from './workspace-credit.service'

type NormalizedBillingMode = CredentialBillingMode | 'degraded'

type TokenUsageMetricKeys =
    | 'inputTokens'
    | 'outputTokens'
    | 'cacheReadTokens'
    | 'cacheWriteTokens'
    | 'reasoningTokens'
    | 'acceptedPredictionTokens'
    | 'rejectedPredictionTokens'
    | 'audioInputTokens'
    | 'audioOutputTokens'

const VALID_BILLING_MODES: CredentialBillingMode[] = ['token', 'image_count', 'video_count', 'seconds', 'characters']
const BILLING_MODE_SET = new Set<CredentialBillingMode>(VALID_BILLING_MODES)

export interface ITokenUsageMetrics {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
    reasoningTokens: number
    acceptedPredictionTokens: number
    rejectedPredictionTokens: number
    audioInputTokens: number
    audioOutputTokens: number
    imageCount: number
    videoCount: number
    seconds: number
    characters: number
    additionalBreakdown: Record<string, number>
}

interface IUsageEntry {
    usage: Record<string, any>
    model?: string
    provider?: string
    credentialId?: string
    credentialName?: string
    source?: string
    billingSource?: string
    billingMode?: string
    tokenUsageCredentialCallId?: string
    auditSource?: string
}

interface ICredentialAccess {
    credentialId?: string
    credentialName?: string
    model?: string
    provider?: string
    tokenUsageCredentialCallId?: string
}

interface IRecordTokenUsageInput {
    workspaceId: string
    organizationId: string
    userId?: string
    flowType: 'CHATFLOW' | 'AGENTFLOW' | 'ASSISTANT' | 'MULTIAGENT'
    flowId?: string
    executionId?: string
    chatId?: string
    chatMessageId?: string
    sessionId?: string
    idempotencyKey?: string
    usagePayloads: any[]
    credentialAccesses?: ICredentialAccess[]
}

type TokenUsageAttributionMode = 'ordered' | 'estimated'

export interface IUsageEntryMetrics {
    metrics: ITokenUsageMetrics
    model?: string
    provider?: string
    credentialId?: string
    credentialName?: string
    source?: string
    billingSource?: string
    billingMode?: NormalizedBillingMode
    tokenUsageCredentialCallId?: string
    auditSource?: string
}

export interface IExtractedUsageEntryMetricsResult {
    extractedEntries: number
    selectedEntries: number
    hasActualUsageEntry: boolean
    hasAnyUsage: boolean
    sourceCounts: Record<string, number>
    usageEntryMetrics: IUsageEntryMetrics[]
    aggregatedMetrics: ITokenUsageMetrics
    modelTotals: Record<string, number>
}

interface IAttributedUsageCall {
    id: string
    credentialId?: string
    credentialName: string
    provider?: string
    model?: string
    billingMode: NormalizedBillingMode
    metrics: ITokenUsageMetrics
    usageBreakdown: Record<string, number | string>
}

interface ICredentialGroup {
    key: string
    credentialId?: string
    credentialName: string
    model?: string
    billingMode: NormalizedBillingMode
    attributionMode: TokenUsageAttributionMode
    usageCount: number
    metrics: ITokenUsageMetrics
    usageBreakdown: Record<string, number | string>
    calls: IAttributedUsageCall[]
}

interface IUsageSummaryRow {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
    reasoningTokens?: number
    acceptedPredictionTokens?: number
    rejectedPredictionTokens?: number
    audioInputTokens?: number
    audioOutputTokens?: number
    imageCount?: number
    videoCount?: number
    seconds?: number
    characters?: number
    chargedCredit?: number
    usageBreakdown?: Record<string, any>
}

interface IUsageAuditContext {
    model?: string
    provider?: string
    credentialId?: string
    credentialName?: string
    tokenUsageCredentialCallId?: string
    auditSource?: string
    billingSource?: string
    billingMode?: string
}

interface IPersistedUsageRows {
    execution: TokenUsageExecution
    credentialRows: TokenUsageCredential[]
    callRows: TokenUsageCredentialCall[]
}

const createEmptyMetrics = (): ITokenUsageMetrics => ({
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    acceptedPredictionTokens: 0,
    rejectedPredictionTokens: 0,
    audioInputTokens: 0,
    audioOutputTokens: 0,
    imageCount: 0,
    videoCount: 0,
    seconds: 0,
    characters: 0,
    additionalBreakdown: {}
})

const safeToNumber = (value: any): number => {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) return Number(value)
    return 0
}

const isPositiveNumber = (value: any): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0

const addAdditionalBreakdown = (target: Record<string, number>, source: Record<string, number>, multiplier = 1) => {
    for (const [key, value] of Object.entries(source)) {
        if (!Number.isFinite(value)) continue
        target[key] = (target[key] || 0) + value * multiplier
    }
}

const addMetrics = (target: ITokenUsageMetrics, source: ITokenUsageMetrics, multiplier = 1) => {
    target.inputTokens += source.inputTokens * multiplier
    target.outputTokens += source.outputTokens * multiplier
    target.totalTokens += source.totalTokens * multiplier
    target.cacheReadTokens += source.cacheReadTokens * multiplier
    target.cacheWriteTokens += source.cacheWriteTokens * multiplier
    target.reasoningTokens += source.reasoningTokens * multiplier
    target.acceptedPredictionTokens += source.acceptedPredictionTokens * multiplier
    target.rejectedPredictionTokens += source.rejectedPredictionTokens * multiplier
    target.audioInputTokens += source.audioInputTokens * multiplier
    target.audioOutputTokens += source.audioOutputTokens * multiplier
    target.imageCount += source.imageCount * multiplier
    target.videoCount += source.videoCount * multiplier
    target.seconds += source.seconds * multiplier
    target.characters += source.characters * multiplier
    addAdditionalBreakdown(target.additionalBreakdown, source.additionalBreakdown, multiplier)
}

const flattenNumericFields = (value: any, path: string[] = [], output: Record<string, number> = {}) => {
    if (value === null || value === undefined) return output
    if (typeof value === 'number' && Number.isFinite(value)) {
        if (path.length) {
            const key = path.join('.')
            output[key] = (output[key] || 0) + value
        }
        return output
    }

    if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i += 1) {
            flattenNumericFields(value[i], [...path, String(i)], output)
        }
        return output
    }

    if (typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) {
            flattenNumericFields(child, [...path, key], output)
        }
    }

    return output
}

const tokenAliasMap: Record<string, TokenUsageMetricKeys> = {
    input_tokens: 'inputTokens',
    prompt_tokens: 'inputTokens',
    inputtokencount: 'inputTokens',
    output_tokens: 'outputTokens',
    completion_tokens: 'outputTokens',
    outputtokencount: 'outputTokens',
    cache_read_tokens: 'cacheReadTokens',
    'prompt_tokens_details.cached_tokens': 'cacheReadTokens',
    'input_token_details.cache_read': 'cacheReadTokens',
    'input_token_details.cache_read_input_tokens': 'cacheReadTokens',
    cache_write_tokens: 'cacheWriteTokens',
    cache_creation_input_tokens: 'cacheWriteTokens',
    'prompt_tokens_details.cache_creation_tokens': 'cacheWriteTokens',
    'input_token_details.cache_creation': 'cacheWriteTokens',
    reasoning_tokens: 'reasoningTokens',
    'completion_tokens_details.reasoning_tokens': 'reasoningTokens',
    'output_token_details.reasoning': 'reasoningTokens',
    accepted_prediction_tokens: 'acceptedPredictionTokens',
    'completion_tokens_details.accepted_prediction_tokens': 'acceptedPredictionTokens',
    rejected_prediction_tokens: 'rejectedPredictionTokens',
    'completion_tokens_details.rejected_prediction_tokens': 'rejectedPredictionTokens',
    audio_tokens: 'audioInputTokens',
    'prompt_tokens_details.audio_tokens': 'audioInputTokens',
    audio_output_tokens: 'audioOutputTokens',
    'completion_tokens_details.audio_tokens': 'audioOutputTokens'
}

const normalizeBreakdownKey = (key: string): string => {
    return key
        .replace(/\.(\d+)/g, '')
        .replace(/([A-Z])/g, '_$1')
        .toLowerCase()
        .replace(/__+/g, '_')
        .replace(/^_/, '')
}

const normalizeBillingMode = (value?: string): NormalizedBillingMode | undefined => {
    if (typeof value !== 'string' || !value.trim()) return undefined
    const normalized = value.trim().toLowerCase() as CredentialBillingMode
    return BILLING_MODE_SET.has(normalized) ? normalized : 'degraded'
}

const getNonTokenUsageUnits = (usage: Record<string, any>, billingMode?: CredentialBillingMode) => {
    switch (billingMode) {
        case 'image_count':
            return safeToNumber(usage.units) || safeToNumber(usage.generated_images) || safeToNumber(usage.generatedImages)
        case 'video_count':
            return safeToNumber(usage.units) || safeToNumber(usage.generated_videos) || safeToNumber(usage.generatedVideos)
        case 'seconds':
            return safeToNumber(usage.seconds)
        case 'characters':
            return safeToNumber(usage.characters) || safeToNumber(usage.inputCharacters) || safeToNumber(usage.input_characters)
        default:
            return 0
    }
}

const inferBillingModeFromUsage = (usage: Record<string, any>, explicitBillingMode?: string): NormalizedBillingMode | undefined => {
    const normalizedExplicitBillingMode = normalizeBillingMode(explicitBillingMode)
    if (normalizedExplicitBillingMode) return normalizedExplicitBillingMode

    if (
        'input_tokens' in usage ||
        'inputTokens' in usage ||
        'output_tokens' in usage ||
        'outputTokens' in usage ||
        'prompt_tokens' in usage ||
        'completion_tokens' in usage ||
        'total_tokens' in usage ||
        'totalTokens' in usage ||
        'inputTokenCount' in usage ||
        'outputTokenCount' in usage
    ) {
        return 'token'
    }

    return undefined
}

const deriveMetricsFromUsage = (usage: Record<string, any>, billingMode?: NormalizedBillingMode): ITokenUsageMetrics => {
    const metrics = createEmptyMetrics()
    const normalizedBillingMode = inferBillingModeFromUsage(usage, billingMode)
    const flat = flattenNumericFields(usage)

    if (normalizedBillingMode === 'image_count') {
        metrics.imageCount = getNonTokenUsageUnits(usage, 'image_count')
    } else if (normalizedBillingMode === 'video_count') {
        metrics.videoCount = getNonTokenUsageUnits(usage, 'video_count')
    } else if (normalizedBillingMode === 'seconds') {
        metrics.seconds = getNonTokenUsageUnits(usage, 'seconds')
    } else if (normalizedBillingMode === 'characters') {
        metrics.characters = getNonTokenUsageUnits(usage, 'characters')
    }

    for (const [rawKey, value] of Object.entries(flat)) {
        const key = normalizeBreakdownKey(rawKey)
        const metricKey = tokenAliasMap[key] || tokenAliasMap[key.split('.').pop() || '']
        const isTokenMetric = Boolean(metricKey || key === 'total_tokens' || key === 'totaltokens')

        if (normalizedBillingMode === 'token' && metricKey) {
            metrics[metricKey] += value
            continue
        }

        if (normalizedBillingMode && normalizedBillingMode !== 'token' && isTokenMetric) {
            metrics.additionalBreakdown[`raw_${key}`] = (metrics.additionalBreakdown[`raw_${key}`] || 0) + value
            continue
        }

        if (normalizedBillingMode === 'image_count' && (key === 'units' || key === 'generated_images' || key === 'generatedimages')) {
            continue
        }
        if (normalizedBillingMode === 'video_count' && (key === 'units' || key === 'generated_videos' || key === 'generatedvideos')) {
            continue
        }
        if (normalizedBillingMode === 'seconds' && key === 'seconds') continue
        if (normalizedBillingMode === 'characters' && (key === 'characters' || key === 'input_characters' || key === 'inputcharacters')) {
            continue
        }

        if (!Number.isFinite(value)) continue
        metrics.additionalBreakdown[key] = (metrics.additionalBreakdown[key] || 0) + value
    }

    if (normalizedBillingMode !== 'token') {
        return metrics
    }

    const directInput =
        safeToNumber(usage.input_tokens) +
        safeToNumber(usage.prompt_tokens) +
        safeToNumber(usage.promptTokens) +
        safeToNumber(usage.inputTokenCount) +
        safeToNumber(usage.inputTokens)
    const directOutput =
        safeToNumber(usage.output_tokens) +
        safeToNumber(usage.completion_tokens) +
        safeToNumber(usage.outputTokenCount) +
        safeToNumber(usage.completionTokens) +
        safeToNumber(usage.outputTokens)
    const providerRawTotal = safeToNumber(usage.total_tokens) + safeToNumber(usage.totalTokens)

    if (directInput > 0) metrics.inputTokens = Math.max(metrics.inputTokens, directInput)
    if (directOutput > 0) metrics.outputTokens = Math.max(metrics.outputTokens, directOutput)

    if (!metrics.inputTokens && !metrics.outputTokens && providerRawTotal > 0) {
        metrics.inputTokens = providerRawTotal
    }

    metrics.totalTokens = metrics.inputTokens + metrics.outputTokens

    if (providerRawTotal > 0 && providerRawTotal !== metrics.totalTokens) {
        metrics.additionalBreakdown.raw_total_tokens = (metrics.additionalBreakdown.raw_total_tokens || 0) + providerRawTotal
    }

    return metrics
}

const usageContainerKeys = new Set([
    'usage',
    'usagemetadata',
    'usage_metadata',
    'estimatedtokenusage',
    'estimated_token_usage',
    'tokenusage',
    'token_usage',
    'amazon-bedrock-invocationmetrics'
])

const actualUsageContainerKeys = new Set([
    'usage',
    'usagemetadata',
    'usage_metadata',
    'amazon-bedrock-invocationmetrics',
    'direct_usage_object'
])
const estimatedUsageContainerKeys = new Set(['estimatedtokenusage', 'estimated_token_usage', 'tokenusage', 'token_usage'])

const modelKeys = ['model', 'modelName', 'model_name']
const providerKeys = ['provider', 'providerName', 'provider_name', 'llmModel', 'agentModel']
const credentialIdKeys = ['credentialId', 'credential_id', 'FLOWISE_CREDENTIAL_ID', 'flowise_credential_id', 'credential']
const credentialNameKeys = ['credentialName', 'credential_name']

const getStringValueFromKeys = (obj: Record<string, any>, keys: string[]): string | undefined => {
    for (const key of keys) {
        if (typeof obj[key] === 'string' && obj[key].trim()) return obj[key].trim()
    }
    return undefined
}

const getModelFromObject = (obj: Record<string, any>, inheritedModel?: string): string | undefined => {
    const directModel = getStringValueFromKeys(obj, modelKeys)
    if (directModel) return directModel

    const responseMetadata = obj.response_metadata || obj.responseMetadata
    if (responseMetadata && typeof responseMetadata === 'object') {
        const responseMetadataModel = getStringValueFromKeys(responseMetadata as Record<string, any>, modelKeys)
        if (responseMetadataModel) return responseMetadataModel
    }

    const modelConfigCandidates = [obj.llmModelConfig, obj.agentModelConfig, obj.input?.llmModelConfig, obj.input?.agentModelConfig]
    for (const candidate of modelConfigCandidates) {
        if (!candidate || typeof candidate !== 'object') continue
        const configuredModel = getStringValueFromKeys(candidate as Record<string, any>, modelKeys)
        if (configuredModel) return configuredModel
    }

    return inheritedModel
}

const getProviderFromObject = (obj: Record<string, any>, inheritedProvider?: string): string | undefined => {
    const directProvider = getStringValueFromKeys(obj, providerKeys)
    if (directProvider) return directProvider

    const responseMetadata = obj.response_metadata || obj.responseMetadata
    if (responseMetadata && typeof responseMetadata === 'object') {
        const responseMetadataProvider = getStringValueFromKeys(responseMetadata as Record<string, any>, providerKeys)
        if (responseMetadataProvider) return responseMetadataProvider
    }

    const modelConfigCandidates = [obj.llmModelConfig, obj.agentModelConfig, obj.input?.llmModelConfig, obj.input?.agentModelConfig]
    for (const candidate of modelConfigCandidates) {
        if (!candidate || typeof candidate !== 'object') continue
        const configuredProvider = getStringValueFromKeys(candidate as Record<string, any>, providerKeys)
        if (configuredProvider) return configuredProvider
    }

    return inheritedProvider
}

const getCredentialIdFromObject = (obj: Record<string, any>, inheritedCredentialId?: string): string | undefined => {
    const directCredentialId = getStringValueFromKeys(obj, credentialIdKeys)
    if (directCredentialId) return directCredentialId

    const modelConfigCandidates = [obj.llmModelConfig, obj.agentModelConfig, obj.input?.llmModelConfig, obj.input?.agentModelConfig]
    for (const candidate of modelConfigCandidates) {
        if (!candidate || typeof candidate !== 'object') continue
        const credentialId = getStringValueFromKeys(candidate as Record<string, any>, credentialIdKeys)
        if (credentialId) return credentialId
    }

    return inheritedCredentialId
}

const getCredentialNameFromObject = (obj: Record<string, any>, inheritedCredentialName?: string): string | undefined => {
    const directCredentialName = getStringValueFromKeys(obj, credentialNameKeys)
    if (directCredentialName) return directCredentialName
    return inheritedCredentialName
}

const getAuditSourceFromObject = (obj: Record<string, any>, inheritedAuditSource?: string): string | undefined => {
    if (typeof obj.auditSource === 'string' && obj.auditSource.trim()) return obj.auditSource.trim()
    return inheritedAuditSource
}

const getBillingSourceFromObject = (obj: Record<string, any>, inheritedBillingSource?: string): string | undefined => {
    if (typeof obj.source === 'string' && obj.source.trim()) return obj.source.trim()
    return inheritedBillingSource
}

const getBillingModeFromObject = (obj: Record<string, any>, inheritedBillingMode?: string): string | undefined => {
    if (typeof obj.billingMode === 'string' && obj.billingMode.trim()) return obj.billingMode.trim()
    return inheritedBillingMode
}

const getTokenUsageCredentialCallIdFromObject = (obj: Record<string, any>): string | undefined => {
    if (typeof obj.tokenUsageCredentialCallId !== 'string') return undefined
    const normalizedCallId = obj.tokenUsageCredentialCallId.trim()
    return normalizedCallId || undefined
}

const resolveUsageAuditContext = (obj: Record<string, any>, currentContext: IUsageAuditContext = {}): IUsageAuditContext => ({
    model: getModelFromObject(obj, currentContext.model),
    provider: getProviderFromObject(obj, currentContext.provider),
    credentialId: getCredentialIdFromObject(obj, currentContext.credentialId),
    credentialName: getCredentialNameFromObject(obj, currentContext.credentialName),
    tokenUsageCredentialCallId: getTokenUsageCredentialCallIdFromObject(obj) || currentContext.tokenUsageCredentialCallId,
    auditSource: getAuditSourceFromObject(obj, currentContext.auditSource),
    billingSource: getBillingSourceFromObject(obj, currentContext.billingSource),
    billingMode: getBillingModeFromObject(obj, currentContext.billingMode)
})

const hasUsageSignals = (obj: Record<string, any>): boolean => {
    return (
        'input_tokens' in obj ||
        'inputTokens' in obj ||
        'output_tokens' in obj ||
        'outputTokens' in obj ||
        'total_tokens' in obj ||
        'prompt_tokens' in obj ||
        'promptTokens' in obj ||
        'completion_tokens' in obj ||
        'completionTokens' in obj ||
        'inputTokenCount' in obj ||
        'outputTokenCount' in obj ||
        'totalTokens' in obj ||
        'units' in obj ||
        'seconds' in obj ||
        'characters' in obj
    )
}

const normalizeContainerKey = (key: string): string => key.replace(/([A-Z])/g, '_$1').toLowerCase()

const getCandidatePriority = (normalizedKey: string): number => {
    if (actualUsageContainerKeys.has(normalizedKey)) return 1
    if (estimatedUsageContainerKeys.has(normalizedKey)) return 2
    return 3
}

const isActualUsageSource = (source?: string): boolean => {
    if (!source) return false
    return actualUsageContainerKeys.has(source)
}

const isEstimatedUsageSource = (source?: string): boolean => {
    if (!source) return false
    return estimatedUsageContainerKeys.has(source)
}

const pickPreferredUsageEntry = (obj: Record<string, any>, context: IUsageAuditContext = {}): IUsageEntry | undefined => {
    type UsageCandidate = {
        usage: Record<string, any>
        source: string
        priority: number
        volume: number
    }

    const candidates: UsageCandidate[] = []

    for (const [key, child] of Object.entries(obj)) {
        if (!child || typeof child !== 'object') continue

        const normalizedKey = normalizeContainerKey(key)
        if (!usageContainerKeys.has(normalizedKey)) continue

        const usage = child as Record<string, any>
        const metrics = deriveMetricsFromUsage(usage, normalizeBillingMode(context.billingMode))

        candidates.push({
            usage,
            source: normalizedKey,
            priority: getCandidatePriority(normalizedKey),
            volume:
                metrics.totalTokens +
                metrics.imageCount +
                metrics.videoCount +
                metrics.seconds +
                metrics.characters +
                metrics.audioInputTokens +
                metrics.audioOutputTokens
        })
    }

    if (!candidates.length) {
        if (hasUsageSignals(obj)) {
            return {
                usage: obj,
                model: context.model,
                provider: context.provider,
                credentialId: context.credentialId,
                credentialName: context.credentialName,
                source: 'direct_usage_object',
                billingSource: context.billingSource,
                billingMode: context.billingMode,
                tokenUsageCredentialCallId: context.tokenUsageCredentialCallId,
                auditSource: context.auditSource
            }
        }
        return undefined
    }

    candidates.sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority
        return b.volume - a.volume
    })

    return {
        usage: candidates[0].usage,
        model: context.model,
        provider: context.provider,
        credentialId: context.credentialId,
        credentialName: context.credentialName,
        source: candidates[0].source,
        billingSource: context.billingSource,
        billingMode: context.billingMode,
        tokenUsageCredentialCallId: context.tokenUsageCredentialCallId,
        auditSource: context.auditSource
    }
}

const getSharedBillingSource = (sources: Array<string | undefined>): string | undefined => {
    const normalizedSources = sources.map((source) => (typeof source === 'string' && source.trim() ? source.trim() : undefined))
    if (!normalizedSources.length || normalizedSources.some((source) => !source)) return undefined

    const uniqueSources = Array.from(new Set(normalizedSources as string[]))
    return uniqueSources.length === 1 ? uniqueSources[0] : undefined
}

const getSharedBillingMode = (billingModes: Array<NormalizedBillingMode | undefined>): NormalizedBillingMode | undefined => {
    const normalizedBillingModes = billingModes.filter((billingMode): billingMode is NormalizedBillingMode => Boolean(billingMode))
    if (!normalizedBillingModes.length || normalizedBillingModes.length !== billingModes.length) return undefined

    const uniqueBillingModes = Array.from(new Set(normalizedBillingModes))
    return uniqueBillingModes.length === 1 ? uniqueBillingModes[0] : undefined
}

const buildUsageBreakdown = (
    additionalBreakdown: Record<string, number>,
    billingSource?: string,
    billingMode?: NormalizedBillingMode
): Record<string, number | string> => {
    const usageBreakdown: Record<string, number | string> = {
        ...additionalBreakdown
    }

    if (
        billingMode === 'image_count' &&
        typeof usageBreakdown.units === 'number' &&
        usageBreakdown.generated_images === undefined &&
        usageBreakdown.generatedimages === undefined
    ) {
        usageBreakdown.generated_images = usageBreakdown.units
    }

    if (
        billingMode === 'video_count' &&
        typeof usageBreakdown.units === 'number' &&
        usageBreakdown.generated_videos === undefined &&
        usageBreakdown.generatedvideos === undefined
    ) {
        usageBreakdown.generated_videos = usageBreakdown.units
    }

    if (billingSource) {
        usageBreakdown.source = billingSource
    }

    return usageBreakdown
}

export const getUnclassifiedTokens = (metrics: ITokenUsageMetrics): number => {
    const normalizedUnclassifiedTokens = metrics.totalTokens - metrics.inputTokens - metrics.outputTokens
    return normalizedUnclassifiedTokens > 0 ? normalizedUnclassifiedTokens : 0
}

const withUsageDiagnostics = (
    usageBreakdown: Record<string, number | string>,
    metrics: ITokenUsageMetrics
): Record<string, number | string> => {
    const nextUsageBreakdown = {
        ...usageBreakdown
    }
    const unclassifiedTokens = getUnclassifiedTokens(metrics)

    if (unclassifiedTokens > 0) {
        nextUsageBreakdown.unclassified_tokens = safeToNumber(nextUsageBreakdown.unclassified_tokens) + unclassifiedTokens
    }

    return nextUsageBreakdown
}

const buildCredentialGroupKey = (
    credentialId: string | undefined,
    credentialName: string,
    model: string | undefined,
    billingMode: NormalizedBillingMode
): string => `${credentialId || ''}:${credentialName}:${model || '__unknown_model__'}:${billingMode}`

const extractUsageEntriesFromPayload = (payload: any): IUsageEntry[] => {
    const entries: IUsageEntry[] = []

    const walk = (value: any, currentContext: IUsageAuditContext = {}) => {
        if (!value || typeof value !== 'object') return

        if (Array.isArray(value)) {
            for (const item of value) {
                walk(item, currentContext)
            }
            return
        }

        const nextContext = resolveUsageAuditContext(value as Record<string, any>, currentContext)
        const preferredEntry = pickPreferredUsageEntry(value as Record<string, any>, nextContext)

        if (preferredEntry) {
            entries.push(preferredEntry)
            return
        }

        for (const child of Object.values(value)) {
            if (!child || typeof child !== 'object') continue
            walk(child, nextContext)
        }
    }

    walk(payload)
    return entries
}

const getEntryVolume = (metrics: ITokenUsageMetrics): number => {
    return (
        metrics.totalTokens +
        metrics.imageCount +
        metrics.videoCount +
        metrics.seconds +
        metrics.characters +
        metrics.cacheReadTokens +
        metrics.cacheWriteTokens +
        metrics.reasoningTokens +
        metrics.audioInputTokens +
        metrics.audioOutputTokens
    )
}

const getModelTotalWeight = (entry: IUsageEntryMetrics): number => {
    return (
        entry.metrics.totalTokens ||
        entry.metrics.imageCount ||
        entry.metrics.videoCount ||
        entry.metrics.seconds ||
        entry.metrics.characters ||
        entry.metrics.audioInputTokens ||
        entry.metrics.audioOutputTokens
    )
}

const getTopModel = (modelTotals: Record<string, number>): string | undefined => {
    const entries = Object.entries(modelTotals)
    if (!entries.length) return undefined
    entries.sort((a, b) => b[1] - a[1])
    return entries[0][0]
}

const dedupeUsageEntryMetrics = (entries: IUsageEntryMetrics[]): IUsageEntryMetrics[] => {
    const byCallId = new Map<string, IUsageEntryMetrics>()
    const withoutCallId: IUsageEntryMetrics[] = []

    const isPreferredEntry = (next: IUsageEntryMetrics, current: IUsageEntryMetrics): boolean => {
        const nextIsActual = isActualUsageSource(next.source)
        const currentIsActual = isActualUsageSource(current.source)
        if (nextIsActual !== currentIsActual) return nextIsActual

        const nextHasCredentialMetadata = Boolean(next.credentialId || next.credentialName)
        const currentHasCredentialMetadata = Boolean(current.credentialId || current.credentialName)
        if (nextHasCredentialMetadata !== currentHasCredentialMetadata) return nextHasCredentialMetadata

        return getEntryVolume(next.metrics) > getEntryVolume(current.metrics)
    }

    for (const entry of entries) {
        if (entry.tokenUsageCredentialCallId) {
            const existing = byCallId.get(entry.tokenUsageCredentialCallId)
            if (!existing || isPreferredEntry(entry, existing)) {
                byCallId.set(entry.tokenUsageCredentialCallId, entry)
            }
            continue
        }

        withoutCallId.push(entry)
    }

    const dedupedByFingerprint = new Map<string, IUsageEntryMetrics>()
    for (const entry of withoutCallId) {
        const fingerprint = JSON.stringify({
            credentialId: entry.credentialId,
            credentialName: entry.credentialName,
            model: entry.model,
            provider: entry.provider,
            billingSource: entry.billingSource,
            billingMode: entry.billingMode,
            metrics: {
                inputTokens: entry.metrics.inputTokens,
                outputTokens: entry.metrics.outputTokens,
                totalTokens: entry.metrics.totalTokens,
                imageCount: entry.metrics.imageCount,
                videoCount: entry.metrics.videoCount,
                seconds: entry.metrics.seconds,
                characters: entry.metrics.characters,
                audioInputTokens: entry.metrics.audioInputTokens,
                audioOutputTokens: entry.metrics.audioOutputTokens,
                additionalBreakdown: entry.metrics.additionalBreakdown
            }
        })

        const existing = dedupedByFingerprint.get(fingerprint)
        if (!existing || isPreferredEntry(entry, existing)) {
            dedupedByFingerprint.set(fingerprint, entry)
        }
    }

    const dedupedCallFingerprints = new Set(
        Array.from(byCallId.values()).map((entry) =>
            JSON.stringify({
                credentialId: entry.credentialId,
                credentialName: entry.credentialName,
                model: entry.model,
                provider: entry.provider,
                billingSource: entry.billingSource,
                billingMode: entry.billingMode,
                metrics: {
                    inputTokens: entry.metrics.inputTokens,
                    outputTokens: entry.metrics.outputTokens,
                    totalTokens: entry.metrics.totalTokens,
                    imageCount: entry.metrics.imageCount,
                    videoCount: entry.metrics.videoCount,
                    seconds: entry.metrics.seconds,
                    characters: entry.metrics.characters,
                    audioInputTokens: entry.metrics.audioInputTokens,
                    audioOutputTokens: entry.metrics.audioOutputTokens,
                    additionalBreakdown: entry.metrics.additionalBreakdown
                }
            })
        )
    )

    return [
        ...Array.from(byCallId.values()),
        ...Array.from(dedupedByFingerprint.values()).filter((entry) => {
            const fingerprint = JSON.stringify({
                credentialId: entry.credentialId,
                credentialName: entry.credentialName,
                model: entry.model,
                provider: entry.provider,
                billingSource: entry.billingSource,
                billingMode: entry.billingMode,
                metrics: {
                    inputTokens: entry.metrics.inputTokens,
                    outputTokens: entry.metrics.outputTokens,
                    totalTokens: entry.metrics.totalTokens,
                    imageCount: entry.metrics.imageCount,
                    videoCount: entry.metrics.videoCount,
                    seconds: entry.metrics.seconds,
                    characters: entry.metrics.characters,
                    audioInputTokens: entry.metrics.audioInputTokens,
                    audioOutputTokens: entry.metrics.audioOutputTokens,
                    additionalBreakdown: entry.metrics.additionalBreakdown
                }
            })

            return !dedupedCallFingerprints.has(fingerprint)
        })
    ]
}

const distributeIntegerByWeights = (total: number, weights: number[]): number[] => {
    if (total <= 0 || !weights.length) return weights.map(() => 0)

    const sum = weights.reduce((acc, value) => acc + value, 0)
    if (!sum) return weights.map((_, index) => (index === 0 ? total : 0))

    const allocations = weights.map((weight) => Math.floor((total * weight) / sum))
    let remainder = total - allocations.reduce((acc, value) => acc + value, 0)

    if (remainder > 0) {
        const order = weights
            .map((weight, index) => ({ index, fractional: (total * weight) / sum - Math.floor((total * weight) / sum) }))
            .sort((a, b) => b.fractional - a.fractional)

        let idx = 0
        while (remainder > 0) {
            allocations[order[idx % order.length].index] += 1
            remainder -= 1
            idx += 1
        }
    }

    return allocations
}

const parseDateRange = (startDate?: string, endDate?: string) => {
    const end = endDate ? new Date(endDate) : new Date()
    const start = startDate ? new Date(startDate) : new Date(end.getTime() - 24 * 60 * 60 * 1000)

    const startTime = Number.isNaN(start.getTime()) ? new Date(Date.now() - 24 * 60 * 60 * 1000) : start
    const endTime = Number.isNaN(end.getTime()) ? new Date() : end

    return {
        startDate: startTime,
        endDate: endTime
    }
}

const hasAnyUsage = (metrics: ITokenUsageMetrics): boolean => {
    const additionalBreakdownTotal = Object.values(metrics.additionalBreakdown || {}).reduce(
        (sum, value) => sum + (Number.isFinite(value) ? value : 0),
        0
    )

    return (
        metrics.inputTokens > 0 ||
        metrics.outputTokens > 0 ||
        metrics.totalTokens > 0 ||
        metrics.cacheReadTokens > 0 ||
        metrics.cacheWriteTokens > 0 ||
        metrics.reasoningTokens > 0 ||
        metrics.acceptedPredictionTokens > 0 ||
        metrics.rejectedPredictionTokens > 0 ||
        metrics.audioInputTokens > 0 ||
        metrics.audioOutputTokens > 0 ||
        metrics.imageCount > 0 ||
        metrics.videoCount > 0 ||
        metrics.seconds > 0 ||
        metrics.characters > 0 ||
        additionalBreakdownTotal > 0
    )
}

export const extractUsageEntryMetricsFromPayloads = (usagePayloads: any[]): IExtractedUsageEntryMetricsResult => {
    const usageEntries = usagePayloads.flatMap((payload) => extractUsageEntriesFromPayload(payload))
    const hasActualUsageEntry = usageEntries.some((entry) => isActualUsageSource(entry.source))
    const selectedUsageEntries = hasActualUsageEntry ? usageEntries.filter((entry) => !isEstimatedUsageSource(entry.source)) : usageEntries
    const sourceCounts = selectedUsageEntries.reduce((acc, entry) => {
        const key = entry.source || 'unknown_source'
        acc[key] = (acc[key] || 0) + 1
        return acc
    }, {} as Record<string, number>)

    const usageEntryMetrics = dedupeUsageEntryMetrics(
        selectedUsageEntries.map((entry) => {
            const normalizedBillingMode = inferBillingModeFromUsage(entry.usage, entry.billingMode)
            return {
                metrics: deriveMetricsFromUsage(entry.usage, normalizedBillingMode),
                model: typeof entry.model === 'string' && entry.model.trim() ? entry.model.trim() : undefined,
                provider: typeof entry.provider === 'string' && entry.provider.trim() ? entry.provider.trim() : undefined,
                credentialId: typeof entry.credentialId === 'string' && entry.credentialId.trim() ? entry.credentialId.trim() : undefined,
                credentialName:
                    typeof entry.credentialName === 'string' && entry.credentialName.trim() ? entry.credentialName.trim() : undefined,
                source: typeof entry.source === 'string' && entry.source.trim() ? entry.source.trim() : undefined,
                billingSource:
                    typeof entry.billingSource === 'string' && entry.billingSource.trim() ? entry.billingSource.trim() : undefined,
                billingMode: normalizedBillingMode,
                tokenUsageCredentialCallId:
                    typeof entry.tokenUsageCredentialCallId === 'string' && entry.tokenUsageCredentialCallId.trim()
                        ? entry.tokenUsageCredentialCallId.trim()
                        : undefined,
                auditSource: typeof entry.auditSource === 'string' && entry.auditSource.trim() ? entry.auditSource.trim() : undefined
            } as IUsageEntryMetrics
        })
    )

    const aggregatedMetrics = createEmptyMetrics()
    const modelTotals: Record<string, number> = {}

    for (const entry of usageEntryMetrics) {
        addMetrics(aggregatedMetrics, entry.metrics)
        const modelKey = entry.model || 'unknown'
        modelTotals[modelKey] = (modelTotals[modelKey] || 0) + getModelTotalWeight(entry)
    }

    return {
        extractedEntries: usageEntries.length,
        selectedEntries: usageEntryMetrics.length,
        hasActualUsageEntry,
        hasAnyUsage: hasAnyUsage(aggregatedMetrics),
        sourceCounts,
        usageEntryMetrics,
        aggregatedMetrics,
        modelTotals
    }
}

const parseJsonRecord = (value?: string): Record<string, any> => {
    if (!value) return {}
    try {
        const parsed = JSON.parse(value)
        if (parsed && typeof parsed === 'object') return parsed
        return {}
    } catch {
        return {}
    }
}

const summarizeUsageRows = (rows: IUsageSummaryRow[]): IUsageSummaryRow => {
    const summary: IUsageSummaryRow = {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        acceptedPredictionTokens: 0,
        rejectedPredictionTokens: 0,
        audioInputTokens: 0,
        audioOutputTokens: 0,
        imageCount: 0,
        videoCount: 0,
        seconds: 0,
        characters: 0,
        chargedCredit: 0,
        usageBreakdown: {}
    }
    const breakdownSources = new Set<string>()

    for (const row of rows) {
        summary.inputTokens = safeToNumber(summary.inputTokens) + safeToNumber(row.inputTokens)
        summary.outputTokens = safeToNumber(summary.outputTokens) + safeToNumber(row.outputTokens)
        summary.totalTokens = safeToNumber(summary.totalTokens) + safeToNumber(row.totalTokens)
        summary.cacheReadTokens = safeToNumber(summary.cacheReadTokens) + safeToNumber(row.cacheReadTokens)
        summary.cacheWriteTokens = safeToNumber(summary.cacheWriteTokens) + safeToNumber(row.cacheWriteTokens)
        summary.reasoningTokens = safeToNumber(summary.reasoningTokens) + safeToNumber(row.reasoningTokens)
        summary.acceptedPredictionTokens = safeToNumber(summary.acceptedPredictionTokens) + safeToNumber(row.acceptedPredictionTokens)
        summary.rejectedPredictionTokens = safeToNumber(summary.rejectedPredictionTokens) + safeToNumber(row.rejectedPredictionTokens)
        summary.audioInputTokens = safeToNumber(summary.audioInputTokens) + safeToNumber(row.audioInputTokens)
        summary.audioOutputTokens = safeToNumber(summary.audioOutputTokens) + safeToNumber(row.audioOutputTokens)
        summary.imageCount = safeToNumber(summary.imageCount) + safeToNumber(row.imageCount)
        summary.videoCount = safeToNumber(summary.videoCount) + safeToNumber(row.videoCount)
        summary.seconds = safeToNumber(summary.seconds) + safeToNumber(row.seconds)
        summary.characters = safeToNumber(summary.characters) + safeToNumber(row.characters)
        summary.chargedCredit = safeToNumber(summary.chargedCredit) + safeToNumber(row.chargedCredit)

        for (const [key, value] of Object.entries(row.usageBreakdown || {})) {
            if (key === 'source') {
                if (typeof value === 'string' && value.trim()) {
                    breakdownSources.add(value.trim())
                }
                continue
            }

            if (typeof value === 'number' && Number.isFinite(value)) {
                summary.usageBreakdown![key] = safeToNumber(summary.usageBreakdown?.[key]) + value
            }
        }
    }

    if (breakdownSources.size === 1) {
        summary.usageBreakdown!.source = Array.from(breakdownSources)[0]
    }

    return summary
}

const metricsFromSummaryRow = (row: IUsageSummaryRow | Record<string, any>): ITokenUsageMetrics => ({
    inputTokens: safeToNumber(row.inputTokens),
    outputTokens: safeToNumber(row.outputTokens),
    totalTokens: safeToNumber(row.totalTokens),
    cacheReadTokens: safeToNumber(row.cacheReadTokens),
    cacheWriteTokens: safeToNumber(row.cacheWriteTokens),
    reasoningTokens: safeToNumber(row.reasoningTokens),
    acceptedPredictionTokens: safeToNumber(row.acceptedPredictionTokens),
    rejectedPredictionTokens: safeToNumber(row.rejectedPredictionTokens),
    audioInputTokens: safeToNumber(row.audioInputTokens),
    audioOutputTokens: safeToNumber(row.audioOutputTokens),
    imageCount: safeToNumber(row.imageCount),
    videoCount: safeToNumber(row.videoCount),
    seconds: safeToNumber(row.seconds),
    characters: safeToNumber(row.characters),
    additionalBreakdown: {}
})

const getAssistantName = (assistant?: Assistant): string | undefined => {
    if (!assistant?.details) return undefined
    try {
        const parsed = JSON.parse(assistant.details)
        if (!parsed || typeof parsed !== 'object') return undefined
        if (typeof parsed.name === 'string' && parsed.name) return parsed.name
        if (typeof parsed.title === 'string' && parsed.title) return parsed.title
        if (typeof parsed.assistantName === 'string' && parsed.assistantName) return parsed.assistantName
        return undefined
    } catch {
        return undefined
    }
}

const buildDeterministicCallId = (seed: string) => {
    const hex = createHash('sha1').update(seed).digest('hex').slice(0, 32)
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

const buildUsagePayloadFingerprint = (usagePayloads: any[]): string => {
    const serializedPayloads = usagePayloads
        .map((payload) => {
            try {
                return JSON.stringify(payload)
            } catch {
                return String(payload)
            }
        })
        .sort()

    if (!serializedPayloads.length) return 'empty'

    return createHash('sha1').update(serializedPayloads.join('|')).digest('hex')
}

const mergeNumericBreakdown = (current: Record<string, any>, delta: Record<string, number>): Record<string, number> => {
    const merged: Record<string, number> = {}

    for (const [key, value] of Object.entries(current || {})) {
        const numericValue = safeToNumber(value)
        if (numericValue !== 0) {
            merged[key] = numericValue
        }
    }

    for (const [key, value] of Object.entries(delta || {})) {
        const numericValue = safeToNumber(value)
        if (numericValue === 0 && merged[key] === undefined) continue
        merged[key] = safeToNumber(merged[key]) + numericValue
    }

    return merged
}

const normalizeCredentialAccesses = (credentialAccesses: ICredentialAccess[]) =>
    credentialAccesses.map((access) => ({
        credentialId: typeof access.credentialId === 'string' && access.credentialId.trim() ? access.credentialId.trim() : undefined,
        credentialName:
            typeof access.credentialName === 'string' && access.credentialName.trim() ? access.credentialName.trim() : 'Unknown Credential',
        model: typeof access.model === 'string' && access.model.trim() ? access.model.trim() : undefined,
        provider: typeof access.provider === 'string' && access.provider.trim() ? access.provider.trim() : undefined,
        tokenUsageCredentialCallId:
            typeof access.tokenUsageCredentialCallId === 'string' && access.tokenUsageCredentialCallId.trim()
                ? access.tokenUsageCredentialCallId.trim()
                : undefined
    }))

const isChargeableBillingMode = (billingMode?: string): billingMode is CredentialBillingMode =>
    typeof billingMode === 'string' && BILLING_MODE_SET.has(billingMode as CredentialBillingMode)

const buildBillingUsageFromMetrics = ({
    credentialId,
    credentialName,
    provider,
    model,
    billingMode,
    tokenUsageCredentialCallId,
    metrics,
    usageBreakdown
}: {
    credentialId?: string
    credentialName?: string
    provider?: string
    model?: string
    billingMode?: string
    tokenUsageCredentialCallId?: string
    metrics: ITokenUsageMetrics
    usageBreakdown?: Record<string, any>
}): ICredentialBillingUsage | undefined => {
    if (!isChargeableBillingMode(billingMode)) return undefined

    const baseUsage = {
        credentialId,
        credentialName,
        provider,
        model,
        source: typeof usageBreakdown?.source === 'string' ? usageBreakdown.source : undefined,
        tokenUsageCredentialCallId,
        billingMode
    }

    switch (billingMode) {
        case 'token':
            if (metrics.totalTokens <= 0 && metrics.inputTokens <= 0 && metrics.outputTokens <= 0) return undefined
            return {
                ...baseUsage,
                usage: {
                    inputTokens: metrics.inputTokens,
                    outputTokens: metrics.outputTokens,
                    totalTokens: metrics.totalTokens
                }
            }
        case 'image_count':
            if (metrics.imageCount <= 0) return undefined
            return {
                ...baseUsage,
                usage: {
                    units: metrics.imageCount
                }
            }
        case 'video_count':
            if (metrics.videoCount <= 0) return undefined
            return {
                ...baseUsage,
                usage: {
                    units: metrics.videoCount
                }
            }
        case 'seconds':
            if (metrics.seconds <= 0) return undefined
            return {
                ...baseUsage,
                usage: {
                    seconds: metrics.seconds
                }
            }
        case 'characters':
            if (metrics.characters <= 0) return undefined
            return {
                ...baseUsage,
                usage: {
                    characters: metrics.characters
                }
            }
        default:
            return undefined
    }
}

const getUsageMetricForWeight = (metrics: ITokenUsageMetrics) => {
    return metrics.totalTokens || metrics.imageCount || metrics.videoCount || metrics.seconds || metrics.characters || 1
}

export class TokenUsageService {
    private dataSource: DataSource

    constructor() {
        const appServer = getRunningExpressApp()
        this.dataSource = appServer.AppDataSource
    }

    private async findExecutionByIdempotencyKey(
        workspaceId: string,
        organizationId: string,
        idempotencyKey?: string
    ): Promise<TokenUsageExecution | null> {
        if (!idempotencyKey) return null

        return this.dataSource.getRepository(TokenUsageExecution).findOneBy({
            workspaceId,
            organizationId,
            idempotencyKey
        })
    }

    private async loadPersistedRows(executionId: string): Promise<IPersistedUsageRows> {
        const executionRepository = this.dataSource.getRepository(TokenUsageExecution)
        const credentialRepository = this.dataSource.getRepository(TokenUsageCredential)
        const callRepository = this.dataSource.getRepository(TokenUsageCredentialCall)

        const execution = await executionRepository.findOneBy({ id: executionId })
        if (!execution) {
            throw new Error(`Token usage execution ${executionId} not found`)
        }
        const credentialRows = await credentialRepository.findBy({ usageExecutionId: executionId })
        const credentialIds = credentialRows.map((row) => row.id)
        const callRows = credentialIds.length
            ? await callRepository.findBy({
                  tokenUsageCredentialId: In(credentialIds)
              })
            : []

        return {
            execution,
            credentialRows,
            callRows
        }
    }

    private buildAttributionGroups(
        input: IRecordTokenUsageInput,
        usageEntryMetrics: IUsageEntryMetrics[],
        normalizedCredentialAccesses: ReturnType<typeof normalizeCredentialAccesses>,
        aggregatedMetrics: ITokenUsageMetrics,
        modelTotals: Record<string, number>
    ) {
        const topModel = getTopModel(modelTotals)
        const usagePayloadFingerprint = buildUsagePayloadFingerprint(input.usagePayloads || [])
        const credentialGroups = new Map<string, ICredentialGroup>()

        const credentialAccessByCallId = normalizedCredentialAccesses.reduce((acc, access) => {
            if (access.tokenUsageCredentialCallId) {
                acc.set(access.tokenUsageCredentialCallId, access)
            }
            return acc
        }, new Map<string, (typeof normalizedCredentialAccesses)[number]>())

        const singleCredentialAccessMap = normalizedCredentialAccesses.reduce((acc, access) => {
            const key = `${access.credentialId || ''}:${access.credentialName}`
            if (!acc.has(key)) {
                acc.set(key, access)
            }
            return acc
        }, new Map<string, (typeof normalizedCredentialAccesses)[number]>())
        const singleCredentialAccess = singleCredentialAccessMap.size === 1 ? Array.from(singleCredentialAccessMap.values())[0] : undefined

        const canAttributeByCallId =
            usageEntryMetrics.length > 0 &&
            usageEntryMetrics.every(
                (entry) =>
                    !!entry.tokenUsageCredentialCallId &&
                    (credentialAccessByCallId.has(entry.tokenUsageCredentialCallId) || Boolean(entry.credentialId || entry.credentialName))
            )
        const canAttributeByUsageEntryMetadata =
            usageEntryMetrics.length > 0 && usageEntryMetrics.every((entry) => !!entry.credentialId || !!entry.credentialName)
        const canAttributeByAccessOrder = normalizedCredentialAccesses.length === usageEntryMetrics.length && usageEntryMetrics.length > 0
        const canAttributeBySingleCredential =
            !canAttributeByCallId && !canAttributeByUsageEntryMetadata && !canAttributeByAccessOrder && !!singleCredentialAccess

        const appendAttributedUsage = (
            usageEntry: IUsageEntryMetrics,
            access: {
                credentialId?: string
                credentialName?: string
                model?: string
                provider?: string
            }
        ) => {
            const resolvedCredentialId = access.credentialId || usageEntry.credentialId
            const resolvedCredentialName = access.credentialName || usageEntry.credentialName
            if (!resolvedCredentialId && !resolvedCredentialName) {
                return
            }

            const resolvedModel = access.model || usageEntry.model || topModel
            const resolvedProvider = access.provider || usageEntry.provider
            const billingMode =
                usageEntry.billingMode ||
                (usageEntry.metrics.totalTokens > 0 ? 'token' : getSharedBillingMode([usageEntry.billingMode]) || 'degraded')
            const usageBreakdown = withUsageDiagnostics(
                buildUsageBreakdown(usageEntry.metrics.additionalBreakdown, usageEntry.billingSource, billingMode),
                usageEntry.metrics
            )
            const callId =
                usageEntry.tokenUsageCredentialCallId ||
                buildDeterministicCallId(
                    `${input.idempotencyKey || input.executionId || input.chatId || uuidv4()}:${usagePayloadFingerprint}:${
                        resolvedCredentialId || resolvedCredentialName
                    }:${resolvedModel || 'unknown'}:${billingMode}:${credentialGroups.size}:${getEntryVolume(usageEntry.metrics)}`
                )
            const groupKey = buildCredentialGroupKey(
                resolvedCredentialId,
                resolvedCredentialName || 'Unknown Credential',
                resolvedModel,
                billingMode
            )

            if (!credentialGroups.has(groupKey)) {
                credentialGroups.set(groupKey, {
                    key: groupKey,
                    credentialId: resolvedCredentialId,
                    credentialName: resolvedCredentialName || 'Unknown Credential',
                    model: resolvedModel,
                    billingMode,
                    attributionMode: 'ordered',
                    usageCount: 0,
                    metrics: createEmptyMetrics(),
                    usageBreakdown: {},
                    calls: []
                })
            }

            const group = credentialGroups.get(groupKey)
            if (!group) return

            group.usageCount += 1
            addMetrics(group.metrics, usageEntry.metrics)
            group.calls.push({
                id: callId,
                credentialId: resolvedCredentialId,
                credentialName: resolvedCredentialName || 'Unknown Credential',
                provider: resolvedProvider,
                model: resolvedModel,
                billingMode,
                metrics: usageEntry.metrics,
                usageBreakdown
            })
            group.usageBreakdown = withUsageDiagnostics(
                buildUsageBreakdown(
                    group.metrics.additionalBreakdown,
                    getSharedBillingSource(
                        group.calls.map((call) => (typeof call.usageBreakdown.source === 'string' ? call.usageBreakdown.source : undefined))
                    ),
                    group.billingMode
                ),
                group.metrics
            )
        }

        if (canAttributeByCallId) {
            logger.info(
                `[token-usage] attribution strategy=ordered flowType=${input.flowType} credentials=${normalizedCredentialAccesses.length} entries=${usageEntryMetrics.length} reason=call_id`
            )

            for (const usageEntry of usageEntryMetrics) {
                const access = credentialAccessByCallId.get(usageEntry.tokenUsageCredentialCallId || '') || {
                    credentialId: usageEntry.credentialId,
                    credentialName: usageEntry.credentialName,
                    model: usageEntry.model,
                    provider: usageEntry.provider
                }
                appendAttributedUsage(usageEntry, access)
            }
        } else if (canAttributeByUsageEntryMetadata) {
            logger.info(
                `[token-usage] attribution strategy=ordered flowType=${input.flowType} credentials=${normalizedCredentialAccesses.length} entries=${usageEntryMetrics.length} reason=entry_metadata`
            )

            for (const usageEntry of usageEntryMetrics) {
                const matchingAccess =
                    normalizedCredentialAccesses.find(
                        (access) =>
                            (!!usageEntry.credentialId && access.credentialId === usageEntry.credentialId) ||
                            (!!usageEntry.credentialName && access.credentialName === usageEntry.credentialName)
                    ) || usageEntry

                appendAttributedUsage(usageEntry, matchingAccess)
            }
        } else if (canAttributeByAccessOrder) {
            logger.info(
                `[token-usage] attribution strategy=ordered flowType=${input.flowType} credentials=${normalizedCredentialAccesses.length} entries=${usageEntryMetrics.length} reason=access_order`
            )

            for (let index = 0; index < normalizedCredentialAccesses.length; index += 1) {
                appendAttributedUsage(usageEntryMetrics[index], normalizedCredentialAccesses[index])
            }
        } else if (canAttributeBySingleCredential && singleCredentialAccess) {
            logger.info(
                `[token-usage] attribution strategy=ordered flowType=${input.flowType} credentials=${normalizedCredentialAccesses.length} entries=${usageEntryMetrics.length} reason=single_credential`
            )

            for (const usageEntry of usageEntryMetrics) {
                appendAttributedUsage(usageEntry, singleCredentialAccess)
            }
        } else if (normalizedCredentialAccesses.length > 0) {
            logger.info(
                `[token-usage] attribution strategy=weighted flowType=${input.flowType} credentials=${normalizedCredentialAccesses.length} entries=${usageEntryMetrics.length}`
            )

            const groupedCredentialAccess = new Map<
                string,
                {
                    credentialId?: string
                    credentialName: string
                    model?: string
                    usageCount: number
                }
            >()

            for (const access of normalizedCredentialAccesses) {
                const key = `${access.credentialId || ''}:${access.credentialName}:${access.model || '__unknown_model__'}`
                const existing = groupedCredentialAccess.get(key)
                if (existing) {
                    existing.usageCount += 1
                } else {
                    groupedCredentialAccess.set(key, {
                        credentialId: access.credentialId,
                        credentialName: access.credentialName,
                        model: access.model,
                        usageCount: 1
                    })
                }
            }

            const groups = Array.from(groupedCredentialAccess.values())
            const weights = groups.map((group) => group.usageCount)
            const sharedBillingSource = getSharedBillingSource(usageEntryMetrics.map((entry) => entry.billingSource))
            const sharedBillingMode = getSharedBillingMode(usageEntryMetrics.map((entry) => entry.billingMode)) || 'token'

            const distributedMetrics = {
                inputTokens: distributeIntegerByWeights(aggregatedMetrics.inputTokens, weights),
                outputTokens: distributeIntegerByWeights(aggregatedMetrics.outputTokens, weights),
                totalTokens: distributeIntegerByWeights(aggregatedMetrics.totalTokens, weights),
                cacheReadTokens: distributeIntegerByWeights(aggregatedMetrics.cacheReadTokens, weights),
                cacheWriteTokens: distributeIntegerByWeights(aggregatedMetrics.cacheWriteTokens, weights),
                reasoningTokens: distributeIntegerByWeights(aggregatedMetrics.reasoningTokens, weights),
                acceptedPredictionTokens: distributeIntegerByWeights(aggregatedMetrics.acceptedPredictionTokens, weights),
                rejectedPredictionTokens: distributeIntegerByWeights(aggregatedMetrics.rejectedPredictionTokens, weights),
                audioInputTokens: distributeIntegerByWeights(aggregatedMetrics.audioInputTokens, weights),
                audioOutputTokens: distributeIntegerByWeights(aggregatedMetrics.audioOutputTokens, weights),
                imageCount: distributeIntegerByWeights(aggregatedMetrics.imageCount, weights),
                videoCount: distributeIntegerByWeights(aggregatedMetrics.videoCount, weights),
                seconds: distributeIntegerByWeights(aggregatedMetrics.seconds, weights),
                characters: distributeIntegerByWeights(aggregatedMetrics.characters, weights)
            }

            const additionalBreakdownKeys = Object.keys(aggregatedMetrics.additionalBreakdown)
            const distributedAdditionalBreakdown: Record<string, number[]> = {}
            for (const key of additionalBreakdownKeys) {
                distributedAdditionalBreakdown[key] = distributeIntegerByWeights(aggregatedMetrics.additionalBreakdown[key], weights)
            }

            groups.forEach((group, index) => {
                const metrics = createEmptyMetrics()
                metrics.inputTokens = distributedMetrics.inputTokens[index] || 0
                metrics.outputTokens = distributedMetrics.outputTokens[index] || 0
                metrics.totalTokens = metrics.inputTokens + metrics.outputTokens
                metrics.cacheReadTokens = distributedMetrics.cacheReadTokens[index] || 0
                metrics.cacheWriteTokens = distributedMetrics.cacheWriteTokens[index] || 0
                metrics.reasoningTokens = distributedMetrics.reasoningTokens[index] || 0
                metrics.acceptedPredictionTokens = distributedMetrics.acceptedPredictionTokens[index] || 0
                metrics.rejectedPredictionTokens = distributedMetrics.rejectedPredictionTokens[index] || 0
                metrics.audioInputTokens = distributedMetrics.audioInputTokens[index] || 0
                metrics.audioOutputTokens = distributedMetrics.audioOutputTokens[index] || 0
                metrics.imageCount = distributedMetrics.imageCount[index] || 0
                metrics.videoCount = distributedMetrics.videoCount[index] || 0
                metrics.seconds = distributedMetrics.seconds[index] || 0
                metrics.characters = distributedMetrics.characters[index] || 0

                const additionalBreakdown: Record<string, number> = {}
                for (const key of additionalBreakdownKeys) {
                    additionalBreakdown[key] = distributedAdditionalBreakdown[key][index] || 0
                }
                metrics.additionalBreakdown = additionalBreakdown

                const resolvedModel = group.model || topModel
                const groupKey = buildCredentialGroupKey(group.credentialId, group.credentialName, resolvedModel, sharedBillingMode)
                const usageBreakdown = withUsageDiagnostics(
                    buildUsageBreakdown(additionalBreakdown, sharedBillingSource, sharedBillingMode),
                    metrics
                )
                const callId = buildDeterministicCallId(
                    `${input.idempotencyKey || input.executionId || input.chatId || uuidv4()}:${usagePayloadFingerprint}:${groupKey}:${
                        index + 1
                    }`
                )

                credentialGroups.set(groupKey, {
                    key: groupKey,
                    credentialId: group.credentialId,
                    credentialName: group.credentialName,
                    model: resolvedModel,
                    billingMode: sharedBillingMode,
                    attributionMode: 'estimated',
                    usageCount: group.usageCount,
                    metrics,
                    usageBreakdown,
                    calls: [
                        {
                            id: callId,
                            credentialId: group.credentialId,
                            credentialName: group.credentialName,
                            provider: undefined,
                            model: resolvedModel,
                            billingMode: sharedBillingMode,
                            metrics,
                            usageBreakdown
                        }
                    ]
                })
            })
        }

        return Array.from(credentialGroups.values())
    }

    private async persistUsageRows(
        input: IRecordTokenUsageInput,
        usageEntryMetrics: IUsageEntryMetrics[],
        aggregatedMetrics: ITokenUsageMetrics,
        modelTotals: Record<string, number>,
        normalizedCredentialAccesses: ReturnType<typeof normalizeCredentialAccesses>
    ): Promise<IPersistedUsageRows | null> {
        const executionRepository = this.dataSource.getRepository(TokenUsageExecution)
        const credentialRepository = this.dataSource.getRepository(TokenUsageCredential)
        const credentialCallRepository = this.dataSource.getRepository(TokenUsageCredentialCall)

        const execution = executionRepository.create({
            workspaceId: input.workspaceId,
            organizationId: input.organizationId,
            userId: input.userId,
            flowType: input.flowType,
            flowId: input.flowId,
            executionId: input.executionId,
            chatId: input.chatId,
            chatMessageId: input.chatMessageId,
            sessionId: input.sessionId,
            idempotencyKey: input.idempotencyKey,
            inputTokens: aggregatedMetrics.inputTokens,
            outputTokens: aggregatedMetrics.outputTokens,
            totalTokens: aggregatedMetrics.totalTokens,
            cacheReadTokens: aggregatedMetrics.cacheReadTokens,
            cacheWriteTokens: aggregatedMetrics.cacheWriteTokens,
            reasoningTokens: aggregatedMetrics.reasoningTokens,
            acceptedPredictionTokens: aggregatedMetrics.acceptedPredictionTokens,
            rejectedPredictionTokens: aggregatedMetrics.rejectedPredictionTokens,
            audioInputTokens: aggregatedMetrics.audioInputTokens,
            audioOutputTokens: aggregatedMetrics.audioOutputTokens,
            imageCount: aggregatedMetrics.imageCount,
            videoCount: aggregatedMetrics.videoCount,
            seconds: aggregatedMetrics.seconds,
            characters: aggregatedMetrics.characters,
            usageBreakdown: JSON.stringify(aggregatedMetrics.additionalBreakdown),
            modelBreakdown: JSON.stringify(modelTotals)
        })

        const savedExecution = await executionRepository.save(execution)
        logger.info(`[token-usage] execution inserted id=${savedExecution.id} flowType=${input.flowType} chatId=${input.chatId || '-'}`)

        const credentialGroups = this.buildAttributionGroups(
            input,
            usageEntryMetrics,
            normalizedCredentialAccesses,
            aggregatedMetrics,
            modelTotals
        )

        if (!credentialGroups.length) {
            logger.info(`[token-usage] no attributable credential groups executionId=${savedExecution.id}`)
            return {
                execution: savedExecution,
                credentialRows: [],
                callRows: []
            }
        }

        const credentialRows = await credentialRepository.save(
            credentialGroups.map((group) =>
                credentialRepository.create({
                    usageExecutionId: savedExecution.id,
                    workspaceId: input.workspaceId,
                    organizationId: input.organizationId,
                    userId: input.userId,
                    credentialId: group.credentialId,
                    credentialName: group.credentialName,
                    model: group.model,
                    usageCount: group.usageCount,
                    attributionMode: group.attributionMode,
                    inputTokens: group.metrics.inputTokens,
                    outputTokens: group.metrics.outputTokens,
                    totalTokens: group.metrics.totalTokens,
                    cacheReadTokens: group.metrics.cacheReadTokens,
                    cacheWriteTokens: group.metrics.cacheWriteTokens,
                    reasoningTokens: group.metrics.reasoningTokens,
                    acceptedPredictionTokens: group.metrics.acceptedPredictionTokens,
                    rejectedPredictionTokens: group.metrics.rejectedPredictionTokens,
                    audioInputTokens: group.metrics.audioInputTokens,
                    audioOutputTokens: group.metrics.audioOutputTokens,
                    imageCount: group.metrics.imageCount,
                    videoCount: group.metrics.videoCount,
                    seconds: group.metrics.seconds,
                    characters: group.metrics.characters,
                    usageBreakdown: JSON.stringify(group.usageBreakdown),
                    chargedCredit: 0
                })
            )
        )

        const credentialRowByKey = new Map(credentialRows.map((row, index) => [credentialGroups[index].key, row]))

        const callRows = await credentialCallRepository.save(
            credentialGroups.flatMap((group) => {
                const parentRow = credentialRowByKey.get(group.key)
                if (!parentRow) return []

                return group.calls.map((call, index) =>
                    credentialCallRepository.create({
                        id: call.id,
                        usageExecutionId: savedExecution.id,
                        tokenUsageCredentialId: parentRow.id,
                        workspaceId: input.workspaceId,
                        organizationId: input.organizationId,
                        userId: input.userId,
                        sequenceIndex: index + 1,
                        attributionMode: group.attributionMode,
                        billingMode: call.billingMode,
                        inputTokens: call.metrics.inputTokens,
                        outputTokens: call.metrics.outputTokens,
                        totalTokens: call.metrics.totalTokens,
                        cacheReadTokens: call.metrics.cacheReadTokens,
                        cacheWriteTokens: call.metrics.cacheWriteTokens,
                        reasoningTokens: call.metrics.reasoningTokens,
                        acceptedPredictionTokens: call.metrics.acceptedPredictionTokens,
                        rejectedPredictionTokens: call.metrics.rejectedPredictionTokens,
                        audioInputTokens: call.metrics.audioInputTokens,
                        audioOutputTokens: call.metrics.audioOutputTokens,
                        imageCount: call.metrics.imageCount,
                        videoCount: call.metrics.videoCount,
                        seconds: call.metrics.seconds,
                        characters: call.metrics.characters,
                        usageBreakdown: JSON.stringify(call.usageBreakdown),
                        chargedCredit: 0
                    })
                )
            })
        )

        logger.info(`[token-usage] credential rows inserted count=${credentialRows.length} executionId=${savedExecution.id}`)
        logger.info(`[token-usage] credential call rows inserted count=${callRows.length} executionId=${savedExecution.id}`)

        return {
            execution: savedExecution,
            credentialRows,
            callRows
        }
    }

    private rebuildCredentialGroupWithCalls(group: ICredentialGroup, calls: IAttributedUsageCall[]): ICredentialGroup | null {
        if (!calls.length) return null

        const metrics = createEmptyMetrics()
        calls.forEach((call) => addMetrics(metrics, call.metrics))

        return {
            ...group,
            usageCount: calls.length,
            metrics,
            usageBreakdown: withUsageDiagnostics(
                buildUsageBreakdown(
                    metrics.additionalBreakdown,
                    getSharedBillingSource(
                        calls.map((call) => (typeof call.usageBreakdown.source === 'string' ? call.usageBreakdown.source : undefined))
                    ),
                    group.billingMode
                ),
                metrics
            ),
            calls
        }
    }

    private async appendUsageMetricsToExecution(
        execution: TokenUsageExecution,
        aggregatedMetrics: ITokenUsageMetrics,
        modelTotals: Record<string, number>
    ): Promise<TokenUsageExecution> {
        const executionRepository = this.dataSource.getRepository(TokenUsageExecution)
        const mergedExecution = executionRepository.create({
            ...execution,
            inputTokens: safeToNumber(execution.inputTokens) + aggregatedMetrics.inputTokens,
            outputTokens: safeToNumber(execution.outputTokens) + aggregatedMetrics.outputTokens,
            totalTokens:
                safeToNumber(execution.inputTokens) +
                aggregatedMetrics.inputTokens +
                safeToNumber(execution.outputTokens) +
                aggregatedMetrics.outputTokens,
            cacheReadTokens: safeToNumber(execution.cacheReadTokens) + aggregatedMetrics.cacheReadTokens,
            cacheWriteTokens: safeToNumber(execution.cacheWriteTokens) + aggregatedMetrics.cacheWriteTokens,
            reasoningTokens: safeToNumber(execution.reasoningTokens) + aggregatedMetrics.reasoningTokens,
            acceptedPredictionTokens: safeToNumber(execution.acceptedPredictionTokens) + aggregatedMetrics.acceptedPredictionTokens,
            rejectedPredictionTokens: safeToNumber(execution.rejectedPredictionTokens) + aggregatedMetrics.rejectedPredictionTokens,
            audioInputTokens: safeToNumber(execution.audioInputTokens) + aggregatedMetrics.audioInputTokens,
            audioOutputTokens: safeToNumber(execution.audioOutputTokens) + aggregatedMetrics.audioOutputTokens,
            imageCount: safeToNumber(execution.imageCount) + aggregatedMetrics.imageCount,
            videoCount: safeToNumber(execution.videoCount) + aggregatedMetrics.videoCount,
            seconds: safeToNumber(execution.seconds) + aggregatedMetrics.seconds,
            characters: safeToNumber(execution.characters) + aggregatedMetrics.characters,
            usageBreakdown: JSON.stringify(
                mergeNumericBreakdown(parseJsonRecord(execution.usageBreakdown), aggregatedMetrics.additionalBreakdown)
            ),
            modelBreakdown: JSON.stringify(mergeNumericBreakdown(parseJsonRecord(execution.modelBreakdown), modelTotals))
        })

        return executionRepository.save(mergedExecution)
    }

    private async ensureRecoveryCallRows(persistedRows: IPersistedUsageRows, input: IRecordTokenUsageInput): Promise<IPersistedUsageRows> {
        if (persistedRows.callRows.length || !persistedRows.credentialRows.length) {
            return persistedRows
        }

        const callRepository = this.dataSource.getRepository(TokenUsageCredentialCall)
        const callRows = await callRepository.save(
            persistedRows.credentialRows.map((row, index) =>
                callRepository.create({
                    id: buildDeterministicCallId(`${persistedRows.execution.id}:${row.id}:${input.idempotencyKey || 'recovery'}:${index}`),
                    usageExecutionId: persistedRows.execution.id,
                    tokenUsageCredentialId: row.id,
                    workspaceId: row.workspaceId,
                    organizationId: row.organizationId,
                    userId: row.userId,
                    sequenceIndex: 1,
                    attributionMode: row.attributionMode || 'estimated',
                    billingMode: inferBillingModeFromUsage(parseJsonRecord(row.usageBreakdown), 'token') || 'token',
                    inputTokens: row.inputTokens || 0,
                    outputTokens: row.outputTokens || 0,
                    totalTokens: row.totalTokens || 0,
                    cacheReadTokens: row.cacheReadTokens || 0,
                    cacheWriteTokens: row.cacheWriteTokens || 0,
                    reasoningTokens: row.reasoningTokens || 0,
                    acceptedPredictionTokens: row.acceptedPredictionTokens || 0,
                    rejectedPredictionTokens: row.rejectedPredictionTokens || 0,
                    audioInputTokens: row.audioInputTokens || 0,
                    audioOutputTokens: row.audioOutputTokens || 0,
                    imageCount: row.imageCount || 0,
                    videoCount: row.videoCount || 0,
                    seconds: row.seconds || 0,
                    characters: row.characters || 0,
                    usageBreakdown: row.usageBreakdown,
                    chargedCredit: 0
                })
            )
        )

        return {
            ...persistedRows,
            callRows
        }
    }

    private async ensurePersistedUsageRowsForExistingExecution(
        execution: TokenUsageExecution,
        input: IRecordTokenUsageInput
    ): Promise<IPersistedUsageRows> {
        let persistedRows = await this.loadPersistedRows(execution.id)
        persistedRows = await this.ensureRecoveryCallRows(persistedRows, input)

        const usagePayloads = input.usagePayloads || []
        if (!usagePayloads.length) {
            return persistedRows
        }

        const usageExtraction = extractUsageEntryMetricsFromPayloads(usagePayloads)
        if (!usageExtraction.hasAnyUsage || !usageExtraction.selectedEntries) {
            return persistedRows
        }

        const normalizedCredentialAccesses = normalizeCredentialAccesses(input.credentialAccesses || [])
        const credentialRepository = this.dataSource.getRepository(TokenUsageCredential)
        const callRepository = this.dataSource.getRepository(TokenUsageCredentialCall)
        const credentialGroups = this.buildAttributionGroups(
            input,
            usageExtraction.usageEntryMetrics,
            normalizedCredentialAccesses,
            usageExtraction.aggregatedMetrics,
            usageExtraction.modelTotals
        )

        if (!credentialGroups.length) {
            return persistedRows
        }

        const existingCallIds = new Set(persistedRows.callRows.map((row) => row.id))
        const filteredCredentialGroups = credentialGroups
            .map((group) =>
                this.rebuildCredentialGroupWithCalls(
                    group,
                    group.calls.filter((call) => !existingCallIds.has(call.id))
                )
            )
            .filter((group): group is ICredentialGroup => Boolean(group))

        if (!filteredCredentialGroups.length) {
            return persistedRows
        }

        const newAggregatedMetrics = createEmptyMetrics()
        const newModelTotals: Record<string, number> = {}
        for (const group of filteredCredentialGroups) {
            addMetrics(newAggregatedMetrics, group.metrics)
            const modelKey = group.model || 'unknown'
            newModelTotals[modelKey] = (newModelTotals[modelKey] || 0) + getUsageMetricForWeight(group.metrics)
        }

        if (!hasAnyUsage(newAggregatedMetrics)) {
            return persistedRows
        }

        await this.appendUsageMetricsToExecution(execution, newAggregatedMetrics, newModelTotals)

        const credentialRows = await credentialRepository.save(
            filteredCredentialGroups.map((group) =>
                credentialRepository.create({
                    usageExecutionId: execution.id,
                    workspaceId: execution.workspaceId,
                    organizationId: execution.organizationId,
                    userId: execution.userId,
                    credentialId: group.credentialId,
                    credentialName: group.credentialName,
                    model: group.model,
                    usageCount: group.usageCount,
                    attributionMode: group.attributionMode,
                    inputTokens: group.metrics.inputTokens,
                    outputTokens: group.metrics.outputTokens,
                    totalTokens: group.metrics.totalTokens,
                    cacheReadTokens: group.metrics.cacheReadTokens,
                    cacheWriteTokens: group.metrics.cacheWriteTokens,
                    reasoningTokens: group.metrics.reasoningTokens,
                    acceptedPredictionTokens: group.metrics.acceptedPredictionTokens,
                    rejectedPredictionTokens: group.metrics.rejectedPredictionTokens,
                    audioInputTokens: group.metrics.audioInputTokens,
                    audioOutputTokens: group.metrics.audioOutputTokens,
                    imageCount: group.metrics.imageCount,
                    videoCount: group.metrics.videoCount,
                    seconds: group.metrics.seconds,
                    characters: group.metrics.characters,
                    usageBreakdown: JSON.stringify(group.usageBreakdown),
                    chargedCredit: 0
                })
            )
        )

        const credentialRowByKey = new Map(credentialRows.map((row, index) => [filteredCredentialGroups[index].key, row]))
        const callRows = await callRepository.save(
            filteredCredentialGroups.flatMap((group) => {
                const parentRow = credentialRowByKey.get(group.key)
                if (!parentRow) return []

                return group.calls.map((call, index) =>
                    callRepository.create({
                        id: call.id,
                        usageExecutionId: execution.id,
                        tokenUsageCredentialId: parentRow.id,
                        workspaceId: execution.workspaceId,
                        organizationId: execution.organizationId,
                        userId: execution.userId,
                        sequenceIndex: index + 1,
                        attributionMode: group.attributionMode,
                        billingMode: call.billingMode,
                        inputTokens: call.metrics.inputTokens,
                        outputTokens: call.metrics.outputTokens,
                        totalTokens: call.metrics.totalTokens,
                        cacheReadTokens: call.metrics.cacheReadTokens,
                        cacheWriteTokens: call.metrics.cacheWriteTokens,
                        reasoningTokens: call.metrics.reasoningTokens,
                        acceptedPredictionTokens: call.metrics.acceptedPredictionTokens,
                        rejectedPredictionTokens: call.metrics.rejectedPredictionTokens,
                        audioInputTokens: call.metrics.audioInputTokens,
                        audioOutputTokens: call.metrics.audioOutputTokens,
                        imageCount: call.metrics.imageCount,
                        videoCount: call.metrics.videoCount,
                        seconds: call.metrics.seconds,
                        characters: call.metrics.characters,
                        usageBreakdown: JSON.stringify(call.usageBreakdown),
                        chargedCredit: 0
                    })
                )
            })
        )

        persistedRows = await this.loadPersistedRows(execution.id)
        return {
            ...persistedRows,
            credentialRows: persistedRows.credentialRows.length ? persistedRows.credentialRows : credentialRows,
            callRows: persistedRows.callRows.length ? persistedRows.callRows : callRows
        }
    }

    private async settlePersistedUsageRows(persistedRows: IPersistedUsageRows, workspaceId: string, userId?: string) {
        if (!userId) {
            logger.info(`[token-usage] skip credit consumption: missing userId executionId=${persistedRows.execution.id}`)
            return {
                creditConsumed: 0,
                creditBalance: undefined
            }
        }

        const callRepository = this.dataSource.getRepository(TokenUsageCredentialCall)
        const credentialRepository = this.dataSource.getRepository(TokenUsageCredential)
        const transactionRepository = this.dataSource.getRepository(WorkspaceCreditTransaction)

        const credentialById = new Map(persistedRows.credentialRows.map((row) => [row.id, row]))
        const billableUsages = persistedRows.callRows
            .filter((row) => safeToNumber(row.chargedCredit) <= 0)
            .map((row) =>
                buildBillingUsageFromMetrics({
                    credentialId: credentialById.get(row.tokenUsageCredentialId)?.credentialId,
                    credentialName: credentialById.get(row.tokenUsageCredentialId)?.credentialName,
                    model: credentialById.get(row.tokenUsageCredentialId)?.model,
                    billingMode: row.billingMode,
                    tokenUsageCredentialCallId: row.id,
                    metrics: {
                        inputTokens: row.inputTokens || 0,
                        outputTokens: row.outputTokens || 0,
                        totalTokens: row.totalTokens || 0,
                        cacheReadTokens: row.cacheReadTokens || 0,
                        cacheWriteTokens: row.cacheWriteTokens || 0,
                        reasoningTokens: row.reasoningTokens || 0,
                        acceptedPredictionTokens: row.acceptedPredictionTokens || 0,
                        rejectedPredictionTokens: row.rejectedPredictionTokens || 0,
                        audioInputTokens: row.audioInputTokens || 0,
                        audioOutputTokens: row.audioOutputTokens || 0,
                        imageCount: row.imageCount || 0,
                        videoCount: row.videoCount || 0,
                        seconds: row.seconds || 0,
                        characters: row.characters || 0,
                        additionalBreakdown: {}
                    },
                    usageBreakdown: parseJsonRecord(row.usageBreakdown)
                })
            )
            .filter((usage): usage is ICredentialBillingUsage => Boolean(usage))

        const workspaceCreditService = new WorkspaceCreditService()
        const creditResult = billableUsages.length
            ? await workspaceCreditService.consumeCreditByBillingUsages(workspaceId, userId, billableUsages)
            : {
                  creditConsumed: 0,
                  creditBalance: undefined,
                  transactions: [],
                  usageResults: []
              }

        const callIds = persistedRows.callRows.map((row) => row.id).filter((id): id is string => !!id)
        const transactions = callIds.length
            ? await transactionRepository.findBy({
                  tokenUsageCredentialCallId: In(callIds)
              })
            : []
        const transactionByCallId = new Map(
            transactions
                .filter(
                    (transaction): transaction is WorkspaceCreditTransaction & { tokenUsageCredentialCallId: string } =>
                        typeof transaction.tokenUsageCredentialCallId === 'string' && transaction.tokenUsageCredentialCallId.length > 0
                )
                .map((transaction) => [transaction.tokenUsageCredentialCallId, transaction])
        )

        const updatedCallRows = persistedRows.callRows.map((row) => {
            const transaction = transactionByCallId.get(row.id)
            const chargedCredit = transaction ? Math.abs(transaction.amount || 0) : 0
            return callRepository.create({
                ...row,
                chargedCredit,
                creditTransactionId: transaction?.id,
                creditedAt: transaction?.createdDate
            })
        })

        const savedCallRows = updatedCallRows.length ? await callRepository.save(updatedCallRows) : persistedRows.callRows

        const chargedCreditByCredentialId = savedCallRows.reduce((acc, row) => {
            acc.set(row.tokenUsageCredentialId, (acc.get(row.tokenUsageCredentialId) || 0) + safeToNumber(row.chargedCredit))
            return acc
        }, new Map<string, number>())

        const savedCredentialRows = persistedRows.credentialRows.length
            ? await credentialRepository.save(
                  persistedRows.credentialRows.map((row) =>
                      credentialRepository.create({
                          ...row,
                          chargedCredit: chargedCreditByCredentialId.get(row.id) || 0
                      })
                  )
              )
            : persistedRows.credentialRows

        logger.info(
            `[token-usage] credit consumed=${safeToNumber((creditResult as Record<string, any>).creditConsumed)} executionId=${
                persistedRows.execution.id
            }`
        )

        return {
            ...creditResult,
            callRows: savedCallRows,
            credentialRows: savedCredentialRows
        }
    }

    public async recordTokenUsage(input: IRecordTokenUsageInput) {
        const { usagePayloads = [], credentialAccesses = [] } = input

        logger.info(
            `[token-usage] start record flowType=${input.flowType} flowId=${input.flowId || '-'} chatId=${input.chatId || '-'} userId=${
                input.userId || '-'
            } payloads=${usagePayloads.length} credentials=${credentialAccesses.length} idempotencyKey=${input.idempotencyKey || '-'}`
        )

        if (!usagePayloads.length) {
            logger.warn('[token-usage] skip: empty usagePayloads')
            return
        }

        const usageExtraction = extractUsageEntryMetricsFromPayloads(usagePayloads)
        if (!usageExtraction.extractedEntries) {
            const firstPayloadKeys =
                usagePayloads[0] && typeof usagePayloads[0] === 'object' ? Object.keys(usagePayloads[0]).slice(0, 30) : []
            logger.warn(
                `[token-usage] skip: no usage entries extracted. firstPayloadKeys=${JSON.stringify(firstPayloadKeys)} flowType=${
                    input.flowType
                } chatId=${input.chatId || '-'}`
            )
            return
        }

        if (!usageExtraction.selectedEntries) {
            logger.warn(
                `[token-usage] skip: usage entries extracted=${
                    usageExtraction.extractedEntries
                }, but all entries were filtered out. flowType=${input.flowType} chatId=${input.chatId || '-'}`
            )
            return
        }

        if (!usageExtraction.hasActualUsageEntry) {
            logger.warn(
                `[token-usage] degraded audit only: estimated-only usage extracted=${usageExtraction.selectedEntries} flowType=${
                    input.flowType
                } chatId=${input.chatId || '-'}`
            )
            return
        }

        if (usageExtraction.hasActualUsageEntry && usageExtraction.selectedEntries !== usageExtraction.extractedEntries) {
            logger.info(
                `[token-usage] filtered estimated usage entries: before=${usageExtraction.extractedEntries} after=${
                    usageExtraction.selectedEntries
                } flowType=${input.flowType} chatId=${input.chatId || '-'}`
            )
        }

        logger.info(`[token-usage] selected usage sources: ${JSON.stringify(usageExtraction.sourceCounts)}`)

        const { usageEntryMetrics, aggregatedMetrics, modelTotals } = usageExtraction

        if (!usageExtraction.hasAnyUsage) {
            logger.warn(
                `[token-usage] skip: extracted usage entries=${usageExtraction.selectedEntries} but aggregated metrics are zero. flowType=${
                    input.flowType
                } chatId=${input.chatId || '-'}`
            )
            return
        }

        const existingExecution = await this.findExecutionByIdempotencyKey(input.workspaceId, input.organizationId, input.idempotencyKey)
        if (existingExecution) {
            logger.info(`[token-usage] reusing existing execution id=${existingExecution.id} idempotencyKey=${input.idempotencyKey}`)
            const persistedRows = await this.ensurePersistedUsageRowsForExistingExecution(existingExecution, input)
            await this.settlePersistedUsageRows(persistedRows, input.workspaceId, input.userId)
            return
        }

        logger.info(
            `[token-usage] extracted entries=${usageExtraction.selectedEntries} total=${aggregatedMetrics.totalTokens} input=${
                aggregatedMetrics.inputTokens
            } output=${aggregatedMetrics.outputTokens} imageCount=${aggregatedMetrics.imageCount} videoCount=${
                aggregatedMetrics.videoCount
            } seconds=${aggregatedMetrics.seconds} characters=${aggregatedMetrics.characters} models=${JSON.stringify(modelTotals)}`
        )

        const normalizedCredentialAccesses = normalizeCredentialAccesses(credentialAccesses)
        const persistedRows = await this.persistUsageRows(
            input,
            usageEntryMetrics,
            aggregatedMetrics,
            modelTotals,
            normalizedCredentialAccesses
        )

        if (!persistedRows) return

        await this.settlePersistedUsageRows(persistedRows, input.workspaceId, input.userId)
    }

    public async getUsageSummaryByOrganization(organizationId: string, startDate?: string, endDate?: string) {
        const { startDate: start, endDate: end } = parseDateRange(startDate, endDate)

        const executions = await this.dataSource
            .getRepository(TokenUsageExecution)
            .createQueryBuilder('usage')
            .where('usage.organizationId = :organizationId', { organizationId })
            .andWhere('usage.createdDate BETWEEN :startDate AND :endDate', { startDate: start, endDate: end })
            .orderBy('usage.createdDate', 'DESC')
            .getMany()

        const credentials = await this.dataSource
            .getRepository(TokenUsageCredential)
            .createQueryBuilder('usage')
            .where('usage.organizationId = :organizationId', { organizationId })
            .andWhere('usage.createdDate BETWEEN :startDate AND :endDate', { startDate: start, endDate: end })
            .orderBy('usage.createdDate', 'DESC')
            .getMany()

        const userIds = Array.from(new Set(executions.map((item) => item.userId).filter((id): id is string => !!id)))
        const users = userIds.length ? await this.dataSource.getRepository(User).findBy({ id: In(userIds) }) : []
        const userMap = new Map(users.map((user) => [user.id, user]))

        const overall = createEmptyMetrics()
        const byUser = new Map<string, { metrics: ITokenUsageMetrics; executionCount: number; chargedCredit: number }>()

        for (const execution of executions) {
            const metrics = metricsFromSummaryRow(execution)
            addMetrics(overall, metrics)

            if (!execution.userId) continue

            if (!byUser.has(execution.userId)) {
                byUser.set(execution.userId, { metrics: createEmptyMetrics(), executionCount: 0, chargedCredit: 0 })
            }

            const current = byUser.get(execution.userId)
            if (!current) continue
            addMetrics(current.metrics, metrics)
            current.executionCount += 1
        }

        const credentialByUser = new Map<string, any[]>()
        for (const credential of credentials) {
            if (!credential.userId) continue
            if (!credentialByUser.has(credential.userId)) credentialByUser.set(credential.userId, [])

            credentialByUser.get(credential.userId)?.push({
                credentialId: credential.credentialId,
                credentialName: credential.credentialName,
                model: credential.model,
                usageCount: credential.usageCount,
                inputTokens: credential.inputTokens,
                outputTokens: credential.outputTokens,
                totalTokens: credential.totalTokens,
                cacheReadTokens: credential.cacheReadTokens,
                cacheWriteTokens: credential.cacheWriteTokens,
                reasoningTokens: credential.reasoningTokens,
                acceptedPredictionTokens: credential.acceptedPredictionTokens,
                rejectedPredictionTokens: credential.rejectedPredictionTokens,
                audioInputTokens: credential.audioInputTokens,
                audioOutputTokens: credential.audioOutputTokens,
                imageCount: credential.imageCount,
                videoCount: credential.videoCount,
                seconds: credential.seconds,
                characters: credential.characters,
                chargedCredit: credential.chargedCredit || 0
            })

            const current = byUser.get(credential.userId)
            if (current) {
                current.chargedCredit += safeToNumber(credential.chargedCredit)
            }
        }

        const usersSummary = Array.from(byUser.entries())
            .map(([userId, usage]) => {
                const user = userMap.get(userId)
                return {
                    userId,
                    userName: user?.name || 'Unknown',
                    userEmail: user?.email || '',
                    executionCount: usage.executionCount,
                    inputTokens: usage.metrics.inputTokens,
                    outputTokens: usage.metrics.outputTokens,
                    totalTokens: usage.metrics.totalTokens,
                    cacheReadTokens: usage.metrics.cacheReadTokens,
                    cacheWriteTokens: usage.metrics.cacheWriteTokens,
                    reasoningTokens: usage.metrics.reasoningTokens,
                    acceptedPredictionTokens: usage.metrics.acceptedPredictionTokens,
                    rejectedPredictionTokens: usage.metrics.rejectedPredictionTokens,
                    audioInputTokens: usage.metrics.audioInputTokens,
                    audioOutputTokens: usage.metrics.audioOutputTokens,
                    imageCount: usage.metrics.imageCount,
                    videoCount: usage.metrics.videoCount,
                    seconds: usage.metrics.seconds,
                    characters: usage.metrics.characters,
                    chargedCredit: usage.chargedCredit,
                    credentials: credentialByUser.get(userId) || []
                }
            })
            .sort((a, b) => b.totalTokens - a.totalTokens)

        return {
            startDate: start,
            endDate: end,
            total: {
                inputTokens: overall.inputTokens,
                outputTokens: overall.outputTokens,
                totalTokens: overall.totalTokens,
                cacheReadTokens: overall.cacheReadTokens,
                cacheWriteTokens: overall.cacheWriteTokens,
                reasoningTokens: overall.reasoningTokens,
                acceptedPredictionTokens: overall.acceptedPredictionTokens,
                rejectedPredictionTokens: overall.rejectedPredictionTokens,
                audioInputTokens: overall.audioInputTokens,
                audioOutputTokens: overall.audioOutputTokens,
                imageCount: overall.imageCount,
                videoCount: overall.videoCount,
                seconds: overall.seconds,
                characters: overall.characters,
                chargedCredit: credentials.reduce((sum, item) => sum + safeToNumber(item.chargedCredit), 0)
            },
            users: usersSummary,
            recentExecutions: executions.slice(0, 30)
        }
    }

    public async getUsageDetailsByUser(organizationId: string, userId: string, startDate?: string, endDate?: string, page = 1, limit = 10) {
        const { startDate: start, endDate: end } = parseDateRange(startDate, endDate)
        const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1
        const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 100) : 10

        const executionRepo = this.dataSource.getRepository(TokenUsageExecution)
        const executionBaseQuery = executionRepo
            .createQueryBuilder('usage')
            .where('usage.organizationId = :organizationId', { organizationId })
            .andWhere('usage.userId = :userId', { userId })
            .andWhere('usage.createdDate BETWEEN :startDate AND :endDate', { startDate: start, endDate: end })

        const totalCount = await executionBaseQuery.clone().getCount()
        const executions = await executionBaseQuery
            .clone()
            .orderBy('usage.createdDate', 'DESC')
            .skip((safePage - 1) * safeLimit)
            .take(safeLimit)
            .getMany()

        const totalsRaw = await executionBaseQuery
            .clone()
            .select('COALESCE(SUM(usage.inputTokens), 0)', 'inputTokens')
            .addSelect('COALESCE(SUM(usage.outputTokens), 0)', 'outputTokens')
            .addSelect('COALESCE(SUM(usage.totalTokens), 0)', 'totalTokens')
            .addSelect('COALESCE(SUM(usage.cacheReadTokens), 0)', 'cacheReadTokens')
            .addSelect('COALESCE(SUM(usage.cacheWriteTokens), 0)', 'cacheWriteTokens')
            .addSelect('COALESCE(SUM(usage.reasoningTokens), 0)', 'reasoningTokens')
            .addSelect('COALESCE(SUM(usage.acceptedPredictionTokens), 0)', 'acceptedPredictionTokens')
            .addSelect('COALESCE(SUM(usage.rejectedPredictionTokens), 0)', 'rejectedPredictionTokens')
            .addSelect('COALESCE(SUM(usage.audioInputTokens), 0)', 'audioInputTokens')
            .addSelect('COALESCE(SUM(usage.audioOutputTokens), 0)', 'audioOutputTokens')
            .addSelect('COALESCE(SUM(usage.imageCount), 0)', 'imageCount')
            .addSelect('COALESCE(SUM(usage.videoCount), 0)', 'videoCount')
            .addSelect('COALESCE(SUM(usage.seconds), 0)', 'seconds')
            .addSelect('COALESCE(SUM(usage.characters), 0)', 'characters')
            .getRawOne()

        const executionIds = executions.map((execution) => execution.id)
        const credentials = executionIds.length
            ? await this.dataSource
                  .getRepository(TokenUsageCredential)
                  .createQueryBuilder('usage')
                  .where('usage.organizationId = :organizationId', { organizationId })
                  .andWhere('usage.userId = :userId', { userId })
                  .andWhere('usage.usageExecutionId IN (:...executionIds)', { executionIds })
                  .orderBy('usage.createdDate', 'DESC')
                  .getMany()
            : []
        const credentialIds = credentials.map((credential) => credential.id)
        const credentialCalls = credentialIds.length
            ? await this.dataSource
                  .getRepository(TokenUsageCredentialCall)
                  .createQueryBuilder('usage')
                  .where('usage.organizationId = :organizationId', { organizationId })
                  .andWhere('usage.userId = :userId', { userId })
                  .andWhere('usage.tokenUsageCredentialId IN (:...credentialIds)', { credentialIds })
                  .orderBy('usage.sequenceIndex', 'ASC')
                  .getMany()
            : []

        const chatflowIds = Array.from(
            new Set(executions.filter((execution) => execution.flowId).map((execution) => execution.flowId as string))
        )
        const assistantIds = Array.from(
            new Set(
                executions
                    .filter((execution) => execution.flowId && execution.flowType === 'ASSISTANT')
                    .map((execution) => execution.flowId as string)
            )
        )

        const chatflows = chatflowIds.length ? await this.dataSource.getRepository(ChatFlow).findBy({ id: In(chatflowIds) }) : []
        const assistants = assistantIds.length ? await this.dataSource.getRepository(Assistant).findBy({ id: In(assistantIds) }) : []
        const flowNameMap = new Map(chatflows.map((flow) => [flow.id, flow.name]))
        const assistantNameMap = new Map(assistants.map((assistant) => [assistant.id, getAssistantName(assistant) || 'Unknown Assistant']))
        const user = await this.dataSource.getRepository(User).findOneBy({ id: userId })

        const credentialCallsByCredential = new Map<string, any[]>()
        for (const credentialCall of credentialCalls) {
            const callDetails = {
                id: credentialCall.id,
                sequenceIndex: credentialCall.sequenceIndex || 0,
                billingMode: credentialCall.billingMode || 'token',
                attributionMode: credentialCall.attributionMode || 'estimated',
                inputTokens: credentialCall.inputTokens,
                outputTokens: credentialCall.outputTokens,
                totalTokens: credentialCall.totalTokens,
                cacheReadTokens: credentialCall.cacheReadTokens,
                cacheWriteTokens: credentialCall.cacheWriteTokens,
                reasoningTokens: credentialCall.reasoningTokens,
                acceptedPredictionTokens: credentialCall.acceptedPredictionTokens,
                rejectedPredictionTokens: credentialCall.rejectedPredictionTokens,
                audioInputTokens: credentialCall.audioInputTokens,
                audioOutputTokens: credentialCall.audioOutputTokens,
                imageCount: credentialCall.imageCount,
                videoCount: credentialCall.videoCount,
                seconds: credentialCall.seconds,
                characters: credentialCall.characters,
                usageBreakdown: parseJsonRecord(credentialCall.usageBreakdown),
                chargedCredit: credentialCall.chargedCredit || 0,
                creditTransactionId: credentialCall.creditTransactionId,
                creditedAt: credentialCall.creditedAt
            }

            if (!credentialCallsByCredential.has(credentialCall.tokenUsageCredentialId)) {
                credentialCallsByCredential.set(credentialCall.tokenUsageCredentialId, [])
            }
            credentialCallsByCredential.get(credentialCall.tokenUsageCredentialId)?.push(callDetails)
        }

        const credentialByExecution = new Map<string, any[]>()
        for (const credential of credentials) {
            const calls = (credentialCallsByCredential.get(credential.id) || []).sort((a, b) => a.sequenceIndex - b.sequenceIndex)
            const credentialDetails = {
                id: credential.id,
                createdDate: credential.createdDate,
                credentialId: credential.credentialId,
                credentialName: credential.credentialName,
                model: credential.model,
                usageCount: credential.usageCount,
                attributionMode: credential.attributionMode || 'estimated',
                inputTokens: credential.inputTokens,
                outputTokens: credential.outputTokens,
                totalTokens: credential.totalTokens,
                cacheReadTokens: credential.cacheReadTokens,
                cacheWriteTokens: credential.cacheWriteTokens,
                reasoningTokens: credential.reasoningTokens,
                acceptedPredictionTokens: credential.acceptedPredictionTokens,
                rejectedPredictionTokens: credential.rejectedPredictionTokens,
                audioInputTokens: credential.audioInputTokens,
                audioOutputTokens: credential.audioOutputTokens,
                imageCount: credential.imageCount,
                videoCount: credential.videoCount,
                seconds: credential.seconds,
                characters: credential.characters,
                usageBreakdown: parseJsonRecord(credential.usageBreakdown),
                chargedCredit: credential.chargedCredit || 0,
                hasCallDetails: calls.length > 0,
                calls
            }
            if (!credentialByExecution.has(credential.usageExecutionId)) {
                credentialByExecution.set(credential.usageExecutionId, [])
            }
            credentialByExecution.get(credential.usageExecutionId)?.push(credentialDetails)
        }

        const records = executions.map((execution) => {
            const executionCredentials = credentialByExecution.get(execution.id) || []
            const credentialSummary = executionCredentials.length ? summarizeUsageRows(executionCredentials) : undefined
            const flowName =
                execution.flowType === 'ASSISTANT'
                    ? execution.flowId
                        ? flowNameMap.get(execution.flowId) || assistantNameMap.get(execution.flowId) || 'Unknown Assistant'
                        : undefined
                    : execution.flowId
                    ? flowNameMap.get(execution.flowId) || 'Unknown Flow'
                    : undefined

            return {
                id: execution.id,
                createdDate: execution.createdDate,
                workspaceId: execution.workspaceId,
                flowType: execution.flowType,
                flowId: execution.flowId,
                flowName,
                executionId: execution.executionId,
                chatId: execution.chatId,
                chatMessageId: execution.chatMessageId,
                sessionId: execution.sessionId,
                inputTokens: credentialSummary ? safeToNumber(credentialSummary.inputTokens) : execution.inputTokens,
                outputTokens: credentialSummary ? safeToNumber(credentialSummary.outputTokens) : execution.outputTokens,
                totalTokens: credentialSummary ? safeToNumber(credentialSummary.totalTokens) : execution.totalTokens,
                cacheReadTokens: credentialSummary ? safeToNumber(credentialSummary.cacheReadTokens) : execution.cacheReadTokens,
                cacheWriteTokens: credentialSummary ? safeToNumber(credentialSummary.cacheWriteTokens) : execution.cacheWriteTokens,
                reasoningTokens: credentialSummary ? safeToNumber(credentialSummary.reasoningTokens) : execution.reasoningTokens,
                acceptedPredictionTokens: credentialSummary
                    ? safeToNumber(credentialSummary.acceptedPredictionTokens)
                    : execution.acceptedPredictionTokens,
                rejectedPredictionTokens: credentialSummary
                    ? safeToNumber(credentialSummary.rejectedPredictionTokens)
                    : execution.rejectedPredictionTokens,
                audioInputTokens: credentialSummary ? safeToNumber(credentialSummary.audioInputTokens) : execution.audioInputTokens,
                audioOutputTokens: credentialSummary ? safeToNumber(credentialSummary.audioOutputTokens) : execution.audioOutputTokens,
                imageCount: credentialSummary ? safeToNumber(credentialSummary.imageCount) : execution.imageCount,
                videoCount: credentialSummary ? safeToNumber(credentialSummary.videoCount) : execution.videoCount,
                seconds: credentialSummary ? safeToNumber(credentialSummary.seconds) : execution.seconds,
                characters: credentialSummary ? safeToNumber(credentialSummary.characters) : execution.characters,
                chargedCredit: credentialSummary ? safeToNumber(credentialSummary.chargedCredit) : 0,
                usageBreakdown: credentialSummary?.usageBreakdown || parseJsonRecord(execution.usageBreakdown),
                modelBreakdown: parseJsonRecord(execution.modelBreakdown),
                credentials: executionCredentials
            }
        })

        return {
            startDate: start,
            endDate: end,
            user: {
                id: userId,
                name: user?.name || 'Unknown',
                email: user?.email || ''
            },
            executionCount: totalCount,
            pagination: {
                page: safePage,
                limit: safeLimit,
                total: totalCount,
                totalPages: Math.max(1, Math.ceil(totalCount / safeLimit))
            },
            total: {
                inputTokens: safeToNumber(totalsRaw?.inputTokens),
                outputTokens: safeToNumber(totalsRaw?.outputTokens),
                totalTokens: safeToNumber(totalsRaw?.totalTokens),
                cacheReadTokens: safeToNumber(totalsRaw?.cacheReadTokens),
                cacheWriteTokens: safeToNumber(totalsRaw?.cacheWriteTokens),
                reasoningTokens: safeToNumber(totalsRaw?.reasoningTokens),
                acceptedPredictionTokens: safeToNumber(totalsRaw?.acceptedPredictionTokens),
                rejectedPredictionTokens: safeToNumber(totalsRaw?.rejectedPredictionTokens),
                audioInputTokens: safeToNumber(totalsRaw?.audioInputTokens),
                audioOutputTokens: safeToNumber(totalsRaw?.audioOutputTokens),
                imageCount: safeToNumber(totalsRaw?.imageCount),
                videoCount: safeToNumber(totalsRaw?.videoCount),
                seconds: safeToNumber(totalsRaw?.seconds),
                characters: safeToNumber(totalsRaw?.characters),
                chargedCredit: credentials.reduce((sum, item) => sum + safeToNumber(item.chargedCredit), 0),
                additionalBreakdown: {}
            },
            records
        }
    }
}
