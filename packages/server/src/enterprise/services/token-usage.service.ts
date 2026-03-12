import { DataSource, In } from 'typeorm'
import { v4 as uuidv4 } from 'uuid'
import { getRunningExpressApp } from '../../utils/getRunningExpressApp'
import { TokenUsageCredential } from '../database/entities/token-usage-credential.entity'
import { TokenUsageCredentialCall } from '../database/entities/token-usage-credential-call.entity'
import { TokenUsageExecution } from '../database/entities/token-usage-execution.entity'
import { User } from '../database/entities/user.entity'
import logger from '../../utils/logger'
import { WorkspaceCreditService } from './workspace-credit.service'
import { ChatFlow } from '../../database/entities/ChatFlow'
import { Assistant } from '../../database/entities/Assistant'
import { WorkspaceCreditTransaction } from '../database/entities/workspace-credit-transaction.entity'

type TokenUsageMetricKeys =
    | 'inputTokens'
    | 'outputTokens'
    | 'totalTokens'
    | 'cacheReadTokens'
    | 'cacheWriteTokens'
    | 'reasoningTokens'
    | 'acceptedPredictionTokens'
    | 'rejectedPredictionTokens'
    | 'audioInputTokens'
    | 'audioOutputTokens'

interface ITokenUsageMetrics {
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
    additionalBreakdown: Record<string, number>
}

interface IUsageEntry {
    usage: Record<string, any>
    model?: string
    source?: string
    billingSource?: string
    billingMode?: string
    tokenUsageCredentialCallId?: string
}

interface ICredentialAccess {
    credentialId?: string
    credentialName?: string
    model?: string
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
    usagePayloads: any[]
    credentialAccesses?: ICredentialAccess[]
}

type TokenUsageAttributionMode = 'ordered' | 'estimated'

interface IUsageEntryMetrics {
    metrics: ITokenUsageMetrics
    model?: string
    billingSource?: string
    billingMode?: string
    tokenUsageCredentialCallId?: string
}

interface IAttributedUsageCall {
    id: string
    credentialId?: string
    credentialName: string
    model?: string
    billingMode: string
    metrics: ITokenUsageMetrics
    usageBreakdown: Record<string, number | string>
}

interface ICredentialGroup {
    key: string
    credentialId?: string
    credentialName: string
    model?: string
    attributionMode: TokenUsageAttributionMode
    usageCount: number
    metrics: ITokenUsageMetrics
    usageBreakdown: Record<string, number | string>
    calls: IAttributedUsageCall[]
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
    additionalBreakdown: {}
})

const safeToNumber = (value: any): number => {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) return Number(value)
    return 0
}

const addAdditionalBreakdown = (target: Record<string, number>, source: Record<string, number>, multiplier = 1) => {
    for (const [key, value] of Object.entries(source)) {
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
    total_tokens: 'totalTokens',
    totaltokens: 'totalTokens',
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

const deriveMetricsFromUsage = (usage: Record<string, any>): ITokenUsageMetrics => {
    const metrics = createEmptyMetrics()
    const flat = flattenNumericFields(usage)

    for (const [rawKey, value] of Object.entries(flat)) {
        const key = normalizeBreakdownKey(rawKey)
        const metricKey = tokenAliasMap[key] || tokenAliasMap[key.split('.').pop() || '']

        if (metricKey) {
            metrics[metricKey] += value
        } else {
            metrics.additionalBreakdown[key] = (metrics.additionalBreakdown[key] || 0) + value
        }
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
        safeToNumber(usage.completionTokens)
    const directTotal = safeToNumber(usage.total_tokens) + safeToNumber(usage.totalTokens)

    if (directInput > 0) metrics.inputTokens = Math.max(metrics.inputTokens, directInput)
    if (directOutput > 0) metrics.outputTokens = Math.max(metrics.outputTokens, directOutput)
    if (directTotal > 0) metrics.totalTokens = Math.max(metrics.totalTokens, directTotal)
    if (!metrics.totalTokens && (metrics.inputTokens || metrics.outputTokens)) {
        metrics.totalTokens = metrics.inputTokens + metrics.outputTokens
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

const actualUsageContainerKeys = new Set(['usage', 'usagemetadata', 'usage_metadata', 'amazon-bedrock-invocationmetrics'])
const estimatedUsageContainerKeys = new Set(['estimatedtokenusage', 'estimated_token_usage', 'tokenusage', 'token_usage'])

const modelKeys = ['model', 'modelName', 'model_name']

const getModelFromObject = (obj: Record<string, any>, inheritedModel?: string): string | undefined => {
    for (const key of modelKeys) {
        if (typeof obj[key] === 'string' && obj[key]) return obj[key]
    }

    const responseMetadata = obj.response_metadata || obj.responseMetadata
    if (responseMetadata && typeof responseMetadata === 'object') {
        for (const key of modelKeys) {
            if (typeof responseMetadata[key] === 'string' && responseMetadata[key]) return responseMetadata[key]
        }
    }

    return inheritedModel
}

const getBillingSourceFromObject = (obj: Record<string, any>): string | undefined => {
    if (typeof obj.source !== 'string') return undefined

    const normalizedSource = obj.source.trim()
    return normalizedSource || undefined
}

const getBillingModeFromObject = (obj: Record<string, any>): string | undefined => {
    if (typeof obj.billingMode !== 'string') return undefined

    const normalizedBillingMode = obj.billingMode.trim()
    return normalizedBillingMode || undefined
}

const getTokenUsageCredentialCallIdFromObject = (obj: Record<string, any>): string | undefined => {
    if (typeof obj.tokenUsageCredentialCallId !== 'string') return undefined

    const normalizedCallId = obj.tokenUsageCredentialCallId.trim()
    return normalizedCallId || undefined
}

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
        'totalTokens' in obj
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

const pickPreferredUsageEntry = (obj: Record<string, any>, model?: string): IUsageEntry | undefined => {
    type UsageCandidate = {
        usage: Record<string, any>
        source: string
        priority: number
        totalTokens: number
    }

    const candidates: UsageCandidate[] = []

    for (const [key, child] of Object.entries(obj)) {
        if (!child || typeof child !== 'object') continue

        const normalizedKey = normalizeContainerKey(key)
        if (!usageContainerKeys.has(normalizedKey)) continue

        const usage = child as Record<string, any>
        const metrics = deriveMetricsFromUsage(usage)

        candidates.push({
            usage,
            source: normalizedKey,
            priority: getCandidatePriority(normalizedKey),
            totalTokens: metrics.totalTokens
        })
    }

    if (!candidates.length) {
        if (hasUsageSignals(obj)) {
            return {
                usage: obj,
                model,
                source: 'direct_usage_object',
                billingSource: getBillingSourceFromObject(obj),
                billingMode: getBillingModeFromObject(obj),
                tokenUsageCredentialCallId: getTokenUsageCredentialCallIdFromObject(obj)
            }
        }
        return undefined
    }

    candidates.sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority
        return b.totalTokens - a.totalTokens
    })

    return {
        usage: candidates[0].usage,
        model,
        source: candidates[0].source,
        billingSource: getBillingSourceFromObject(obj),
        billingMode: getBillingModeFromObject(obj),
        tokenUsageCredentialCallId: getTokenUsageCredentialCallIdFromObject(obj)
    }
}

const getSharedBillingSource = (sources: Array<string | undefined>): string | undefined => {
    const normalizedSources = sources.map((source) => (typeof source === 'string' && source.trim().length > 0 ? source.trim() : undefined))
    if (!normalizedSources.length || normalizedSources.some((source) => !source)) return undefined

    const uniqueSources = Array.from(new Set(normalizedSources as string[]))

    return uniqueSources.length === 1 ? uniqueSources[0] : undefined
}

const getSharedBillingMode = (billingModes: Array<string | undefined>): string | undefined => {
    const normalizedBillingModes = billingModes.map((billingMode) =>
        typeof billingMode === 'string' && billingMode.trim().length > 0 ? billingMode.trim() : undefined
    )
    if (!normalizedBillingModes.length || normalizedBillingModes.some((billingMode) => !billingMode)) return undefined

    const uniqueBillingModes = Array.from(new Set(normalizedBillingModes as string[]))

    return uniqueBillingModes.length === 1 ? uniqueBillingModes[0] : undefined
}

const buildUsageBreakdown = (
    additionalBreakdown: Record<string, number>,
    billingSource?: string,
    billingMode?: string
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

    if (billingSource) {
        usageBreakdown.source = billingSource
    }

    return usageBreakdown
}

const buildCredentialGroupKey = (credentialId: string | undefined, credentialName: string, model: string | undefined): string =>
    `${credentialId || ''}:${credentialName}:${model || '__unknown_model__'}`

const extractUsageEntriesFromPayload = (payload: any): IUsageEntry[] => {
    const entries: IUsageEntry[] = []

    const walk = (value: any, currentModel?: string) => {
        if (!value || typeof value !== 'object') return

        if (Array.isArray(value)) {
            for (const item of value) {
                walk(item, currentModel)
            }
            return
        }

        const nextModel = getModelFromObject(value, currentModel)
        const preferredEntry = pickPreferredUsageEntry(value as Record<string, any>, nextModel)

        if (preferredEntry) {
            entries.push(preferredEntry)
            return
        }

        for (const child of Object.values(value)) {
            if (!child || typeof child !== 'object') continue
            walk(child, nextModel)
        }
    }

    walk(payload)
    return entries
}

const getTopModel = (modelTotals: Record<string, number>): string | undefined => {
    const entries = Object.entries(modelTotals)
    if (!entries.length) return undefined
    entries.sort((a, b) => b[1] - a[1])
    return entries[0][0]
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
        additionalBreakdownTotal > 0
    )
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

export class TokenUsageService {
    private dataSource: DataSource

    constructor() {
        const appServer = getRunningExpressApp()
        this.dataSource = appServer.AppDataSource
    }

    public async recordTokenUsage(input: IRecordTokenUsageInput) {
        const { usagePayloads, credentialAccesses = [] } = input

        logger.info(
            `[token-usage] start record flowType=${input.flowType} flowId=${input.flowId || '-'} chatId=${input.chatId || '-'} userId=${
                input.userId || '-'
            } payloads=${usagePayloads?.length || 0} credentials=${credentialAccesses.length}`
        )

        if (!usagePayloads?.length) {
            logger.warn('[token-usage] skip: empty usagePayloads')
            return
        }

        const usageEntries = usagePayloads.flatMap((payload) => extractUsageEntriesFromPayload(payload))
        if (!usageEntries.length) {
            const firstPayloadKeys =
                usagePayloads?.[0] && typeof usagePayloads[0] === 'object' ? Object.keys(usagePayloads[0]).slice(0, 30) : []
            logger.warn(
                `[token-usage] skip: no usage entries extracted. firstPayloadKeys=${JSON.stringify(firstPayloadKeys)} flowType=${
                    input.flowType
                } chatId=${input.chatId || '-'}`
            )
            return
        }

        const hasActualUsageEntry = usageEntries.some((entry) => isActualUsageSource(entry.source))
        const selectedUsageEntries = hasActualUsageEntry
            ? usageEntries.filter((entry) => !isEstimatedUsageSource(entry.source))
            : usageEntries

        if (!selectedUsageEntries.length) {
            logger.warn(
                `[token-usage] skip: usage entries extracted=${usageEntries.length}, but all entries were filtered out. flowType=${
                    input.flowType
                } chatId=${input.chatId || '-'}`
            )
            return
        }

        if (hasActualUsageEntry && selectedUsageEntries.length !== usageEntries.length) {
            logger.info(
                `[token-usage] filtered estimated usage entries: before=${usageEntries.length} after=${
                    selectedUsageEntries.length
                } flowType=${input.flowType} chatId=${input.chatId || '-'}`
            )
        }

        const sourceCounts = selectedUsageEntries.reduce((acc, entry) => {
            const key = entry.source || 'unknown_source'
            acc[key] = (acc[key] || 0) + 1
            return acc
        }, {} as Record<string, number>)
        logger.info(`[token-usage] selected usage sources: ${JSON.stringify(sourceCounts)}`)

        const usageEntryMetrics = selectedUsageEntries.map((entry) => ({
            metrics: deriveMetricsFromUsage(entry.usage),
            model: typeof entry.model === 'string' && entry.model.trim() ? entry.model.trim() : undefined,
            billingSource: typeof entry.billingSource === 'string' && entry.billingSource.trim() ? entry.billingSource.trim() : undefined,
            billingMode: typeof entry.billingMode === 'string' && entry.billingMode.trim() ? entry.billingMode.trim() : undefined,
            tokenUsageCredentialCallId:
                typeof entry.tokenUsageCredentialCallId === 'string' && entry.tokenUsageCredentialCallId.trim()
                    ? entry.tokenUsageCredentialCallId.trim()
                    : undefined
        })) as IUsageEntryMetrics[]

        const aggregatedMetrics = createEmptyMetrics()
        const modelTotals: Record<string, number> = {}

        for (const entry of usageEntryMetrics) {
            addMetrics(aggregatedMetrics, entry.metrics)
            const modelKey = entry.model || 'unknown'
            modelTotals[modelKey] = (modelTotals[modelKey] || 0) + entry.metrics.totalTokens
        }

        if (!hasAnyUsage(aggregatedMetrics)) {
            logger.warn(
                `[token-usage] skip: extracted usage entries=${selectedUsageEntries.length} but aggregated metrics are zero. flowType=${
                    input.flowType
                } chatId=${input.chatId || '-'}`
            )
            return
        }

        logger.info(
            `[token-usage] extracted entries=${selectedUsageEntries.length} total=${aggregatedMetrics.totalTokens} input=${
                aggregatedMetrics.inputTokens
            } output=${aggregatedMetrics.outputTokens} models=${JSON.stringify(modelTotals)}`
        )

        const execution = this.dataSource.getRepository(TokenUsageExecution).create({
            workspaceId: input.workspaceId,
            organizationId: input.organizationId,
            userId: input.userId,
            flowType: input.flowType,
            flowId: input.flowId,
            executionId: input.executionId,
            chatId: input.chatId,
            chatMessageId: input.chatMessageId,
            sessionId: input.sessionId,
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
            usageBreakdown: JSON.stringify(aggregatedMetrics.additionalBreakdown),
            modelBreakdown: JSON.stringify(modelTotals)
        })

        const savedExecution = await this.dataSource.getRepository(TokenUsageExecution).save(execution)
        logger.info(`[token-usage] execution inserted id=${savedExecution.id} flowType=${input.flowType} chatId=${input.chatId || '-'}`)

        if (!credentialAccesses.length) return

        const normalizedCredentialAccesses = credentialAccesses.map((access) => ({
            credentialId: access.credentialId,
            credentialName: access.credentialName || 'Unknown Credential',
            model: typeof access.model === 'string' && access.model.trim() ? access.model.trim() : undefined
        }))

        const topModel = getTopModel(modelTotals)
        const canAttributeByAccessOrder = normalizedCredentialAccesses.length === usageEntryMetrics.length && usageEntryMetrics.length > 0

        const credentialRepository = this.dataSource.getRepository(TokenUsageCredential)
        const credentialCallRepository = this.dataSource.getRepository(TokenUsageCredentialCall)
        const workspaceCreditTransactionRepository = this.dataSource.getRepository(WorkspaceCreditTransaction)

        const credentialGroups = new Map<string, ICredentialGroup>()
        const orderedChargeUsages: Array<{
            tokenUsageCredentialCallId: string
            credentialId?: string
            credentialName?: string
            model?: string
            totalTokens: number
            inputTokens?: number
            outputTokens?: number
            usageBreakdown?: Record<string, number | string>
        }> = []

        if (canAttributeByAccessOrder) {
            logger.info(
                `[token-usage] attribution strategy=ordered flowType=${input.flowType} credentials=${normalizedCredentialAccesses.length} entries=${usageEntryMetrics.length}`
            )

            for (let index = 0; index < normalizedCredentialAccesses.length; index += 1) {
                const access = normalizedCredentialAccesses[index]
                const usageEntry = usageEntryMetrics[index]
                const resolvedModel = access.model || usageEntry.model || topModel
                const billingMode = usageEntry.billingMode || 'token'
                const usageBreakdown = buildUsageBreakdown(
                    usageEntry.metrics.additionalBreakdown,
                    usageEntry.billingSource,
                    usageEntry.billingMode
                )
                const callId = usageEntry.tokenUsageCredentialCallId || uuidv4()
                const groupKey = buildCredentialGroupKey(access.credentialId, access.credentialName, resolvedModel)

                if (!credentialGroups.has(groupKey)) {
                    const metrics = createEmptyMetrics()
                    credentialGroups.set(groupKey, {
                        key: groupKey,
                        credentialId: access.credentialId,
                        credentialName: access.credentialName,
                        model: resolvedModel,
                        attributionMode: 'ordered',
                        usageCount: 0,
                        metrics,
                        usageBreakdown: {},
                        calls: []
                    })
                }

                const group = credentialGroups.get(groupKey)
                if (!group) continue

                group.usageCount += 1
                addMetrics(group.metrics, usageEntry.metrics)
                group.calls.push({
                    id: callId,
                    credentialId: access.credentialId,
                    credentialName: access.credentialName,
                    model: resolvedModel,
                    billingMode,
                    metrics: usageEntry.metrics,
                    usageBreakdown
                })
                group.usageBreakdown = buildUsageBreakdown(
                    group.metrics.additionalBreakdown,
                    getSharedBillingSource(
                        group.calls.map((call) => (typeof call.usageBreakdown.source === 'string' ? call.usageBreakdown.source : undefined))
                    ),
                    getSharedBillingMode(group.calls.map((call) => call.billingMode))
                )

                orderedChargeUsages.push({
                    tokenUsageCredentialCallId: callId,
                    credentialId: access.credentialId,
                    credentialName: access.credentialName,
                    model: resolvedModel,
                    totalTokens: usageEntry.metrics.totalTokens,
                    inputTokens: usageEntry.metrics.inputTokens,
                    outputTokens: usageEntry.metrics.outputTokens,
                    usageBreakdown
                })
            }
        } else {
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
                const groupKey = buildCredentialGroupKey(access.credentialId, access.credentialName, access.model)
                const existing = groupedCredentialAccess.get(groupKey)
                if (existing) {
                    existing.usageCount += 1
                } else {
                    groupedCredentialAccess.set(groupKey, {
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
            const sharedBillingMode = getSharedBillingMode(usageEntryMetrics.map((entry) => entry.billingMode))

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
                audioOutputTokens: distributeIntegerByWeights(aggregatedMetrics.audioOutputTokens, weights)
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
                metrics.totalTokens = distributedMetrics.totalTokens[index] || 0
                metrics.cacheReadTokens = distributedMetrics.cacheReadTokens[index] || 0
                metrics.cacheWriteTokens = distributedMetrics.cacheWriteTokens[index] || 0
                metrics.reasoningTokens = distributedMetrics.reasoningTokens[index] || 0
                metrics.acceptedPredictionTokens = distributedMetrics.acceptedPredictionTokens[index] || 0
                metrics.rejectedPredictionTokens = distributedMetrics.rejectedPredictionTokens[index] || 0
                metrics.audioInputTokens = distributedMetrics.audioInputTokens[index] || 0
                metrics.audioOutputTokens = distributedMetrics.audioOutputTokens[index] || 0

                const additionalBreakdown: Record<string, number> = {}
                for (const key of additionalBreakdownKeys) {
                    additionalBreakdown[key] = distributedAdditionalBreakdown[key][index] || 0
                }
                metrics.additionalBreakdown = additionalBreakdown

                const resolvedModel = group.model || topModel
                const groupKey = buildCredentialGroupKey(group.credentialId, group.credentialName, resolvedModel)
                credentialGroups.set(groupKey, {
                    key: groupKey,
                    credentialId: group.credentialId,
                    credentialName: group.credentialName,
                    model: resolvedModel,
                    attributionMode: 'estimated',
                    usageCount: group.usageCount,
                    metrics,
                    usageBreakdown: buildUsageBreakdown(additionalBreakdown, sharedBillingSource, sharedBillingMode),
                    calls: []
                })
            })
        }

        const credentialGroupList = Array.from(credentialGroups.values())
        const credentialRows = credentialGroupList.map((group) =>
            credentialRepository.create({
                usageExecutionId: savedExecution.id,
                workspaceId: input.workspaceId,
                organizationId: input.organizationId,
                userId: input.userId,
                credentialId: group.credentialId,
                credentialName: group.credentialName,
                model: group.model || topModel,
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
                usageBreakdown: JSON.stringify(group.usageBreakdown),
                chargedCredit: 0
            })
        )

        let savedCredentialRows = await credentialRepository.save(credentialRows)
        logger.info(`[token-usage] credential rows inserted count=${credentialRows.length} executionId=${savedExecution.id}`)

        let savedCredentialCallRows: TokenUsageCredentialCall[] = []

        if (canAttributeByAccessOrder && credentialGroupList.length) {
            const credentialRowByKey = new Map(
                savedCredentialRows.map((row) => [
                    buildCredentialGroupKey(row.credentialId, row.credentialName || 'Unknown Credential', row.model),
                    row
                ])
            )
            const callRows = credentialGroupList.flatMap((group) => {
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
                        attributionMode: 'ordered',
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
                        usageBreakdown: JSON.stringify(call.usageBreakdown),
                        chargedCredit: 0
                    })
                )
            })

            savedCredentialCallRows = callRows.length ? await credentialCallRepository.save(callRows) : []
        }

        if (!input.userId) {
            logger.info(`[token-usage] skip credit consumption: missing userId executionId=${savedExecution.id}`)
            return
        }

        const workspaceCreditService = new WorkspaceCreditService()
        const creditResult = await workspaceCreditService.consumeCreditByCredentialUsages(
            input.workspaceId,
            input.userId,
            canAttributeByAccessOrder
                ? orderedChargeUsages
                : savedCredentialRows.map((row) => ({
                      credentialId: row.credentialId,
                      credentialName: row.credentialName,
                      model: row.model,
                      totalTokens: row.totalTokens || 0,
                      inputTokens: row.inputTokens || 0,
                      outputTokens: row.outputTokens || 0,
                      usageBreakdown: parseJsonRecord(row.usageBreakdown)
                  }))
        )

        if (savedCredentialCallRows.length) {
            const callIds = savedCredentialCallRows.map((row) => row.id).filter((id): id is string => !!id)
            const transactions = callIds.length
                ? await workspaceCreditTransactionRepository.findBy({
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

            const chargedCreditByCredentialId = new Map<string, number>()
            const updatedCallRows = savedCredentialCallRows.map((row) => {
                const transaction = transactionByCallId.get(row.id)
                const chargedCredit = transaction ? Math.abs(transaction.amount || 0) : 0
                chargedCreditByCredentialId.set(
                    row.tokenUsageCredentialId,
                    (chargedCreditByCredentialId.get(row.tokenUsageCredentialId) || 0) + chargedCredit
                )

                return credentialCallRepository.create({
                    ...row,
                    chargedCredit,
                    creditTransactionId: transaction?.id,
                    creditedAt: transaction?.createdDate
                })
            })

            savedCredentialCallRows = updatedCallRows.length
                ? await credentialCallRepository.save(updatedCallRows)
                : savedCredentialCallRows
            savedCredentialRows = await credentialRepository.save(
                savedCredentialRows.map((row) =>
                    credentialRepository.create({
                        ...row,
                        chargedCredit: chargedCreditByCredentialId.get(row.id) || 0
                    })
                )
            )
        } else if (Array.isArray(creditResult.usageResults) && creditResult.usageResults.length) {
            const chargedCreditByGroupKey = creditResult.usageResults.reduce((acc, usageResult) => {
                const key = buildCredentialGroupKey(
                    usageResult.usage.credentialId,
                    usageResult.usage.credentialName || 'Unknown Credential',
                    usageResult.usage.model
                )
                acc.set(key, (acc.get(key) || 0) + (usageResult.chargedCredit || 0))
                return acc
            }, new Map<string, number>())

            savedCredentialRows = await credentialRepository.save(
                savedCredentialRows.map((row) =>
                    credentialRepository.create({
                        ...row,
                        chargedCredit:
                            chargedCreditByGroupKey.get(
                                buildCredentialGroupKey(row.credentialId, row.credentialName || 'Unknown Credential', row.model)
                            ) || 0
                    })
                )
            )
        }

        logger.info(
            `[token-usage] credit consumed=${creditResult.creditConsumed} balance=${creditResult.creditBalance} executionId=${savedExecution.id}`
        )
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
        const byUser = new Map<string, { metrics: ITokenUsageMetrics; executionCount: number }>()

        for (const execution of executions) {
            const metrics: ITokenUsageMetrics = {
                inputTokens: execution.inputTokens || 0,
                outputTokens: execution.outputTokens || 0,
                totalTokens: execution.totalTokens || 0,
                cacheReadTokens: execution.cacheReadTokens || 0,
                cacheWriteTokens: execution.cacheWriteTokens || 0,
                reasoningTokens: execution.reasoningTokens || 0,
                acceptedPredictionTokens: execution.acceptedPredictionTokens || 0,
                rejectedPredictionTokens: execution.rejectedPredictionTokens || 0,
                audioInputTokens: execution.audioInputTokens || 0,
                audioOutputTokens: execution.audioOutputTokens || 0,
                additionalBreakdown: {}
            }

            addMetrics(overall, metrics)

            if (!execution.userId) continue

            if (!byUser.has(execution.userId)) {
                byUser.set(execution.userId, { metrics: createEmptyMetrics(), executionCount: 0 })
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
                audioOutputTokens: credential.audioOutputTokens
            })
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
                audioOutputTokens: overall.audioOutputTokens
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
                usageBreakdown: parseJsonRecord(credential.usageBreakdown),
                chargedCredit: credential.chargedCredit || 0,
                hasCallDetails: credential.attributionMode === 'ordered' && calls.length > 0,
                calls
            }
            if (!credentialByExecution.has(credential.usageExecutionId)) {
                credentialByExecution.set(credential.usageExecutionId, [])
            }
            credentialByExecution.get(credential.usageExecutionId)?.push(credentialDetails)
        }

        const records = executions.map((execution) => {
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
                inputTokens: execution.inputTokens,
                outputTokens: execution.outputTokens,
                totalTokens: execution.totalTokens,
                cacheReadTokens: execution.cacheReadTokens,
                cacheWriteTokens: execution.cacheWriteTokens,
                reasoningTokens: execution.reasoningTokens,
                acceptedPredictionTokens: execution.acceptedPredictionTokens,
                rejectedPredictionTokens: execution.rejectedPredictionTokens,
                audioInputTokens: execution.audioInputTokens,
                audioOutputTokens: execution.audioOutputTokens,
                usageBreakdown: parseJsonRecord(execution.usageBreakdown),
                modelBreakdown: parseJsonRecord(execution.modelBreakdown),
                credentials: credentialByExecution.get(execution.id) || []
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
                additionalBreakdown: {}
            },
            records
        }
    }
}
