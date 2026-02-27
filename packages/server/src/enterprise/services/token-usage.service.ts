import { DataSource, In } from 'typeorm'
import { getRunningExpressApp } from '../../utils/getRunningExpressApp'
import { TokenUsageCredential } from '../database/entities/token-usage-credential.entity'
import { TokenUsageExecution } from '../database/entities/token-usage-execution.entity'
import { User } from '../database/entities/user.entity'
import logger from '../../utils/logger'
import { WorkspaceCreditService } from './workspace-credit.service'

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
            return { usage: obj, model, source: 'direct_usage_object' }
        }
        return undefined
    }

    candidates.sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority
        return b.totalTokens - a.totalTokens
    })

    return { usage: candidates[0].usage, model, source: candidates[0].source }
}

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
        metrics.audioOutputTokens > 0
    )
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

        const sourceCounts = usageEntries.reduce((acc, entry) => {
            const key = entry.source || 'unknown_source'
            acc[key] = (acc[key] || 0) + 1
            return acc
        }, {} as Record<string, number>)
        logger.info(`[token-usage] selected usage sources: ${JSON.stringify(sourceCounts)}`)

        const aggregatedMetrics = createEmptyMetrics()
        const modelTotals: Record<string, number> = {}

        for (const entry of usageEntries) {
            const usageMetrics = deriveMetricsFromUsage(entry.usage)
            addMetrics(aggregatedMetrics, usageMetrics)
            const modelKey = entry.model || 'unknown'
            modelTotals[modelKey] = (modelTotals[modelKey] || 0) + usageMetrics.totalTokens
        }

        if (!hasAnyUsage(aggregatedMetrics)) {
            logger.warn(
                `[token-usage] skip: extracted usage entries=${usageEntries.length} but aggregated metrics are zero. flowType=${
                    input.flowType
                } chatId=${input.chatId || '-'}`
            )
            return
        }

        logger.info(
            `[token-usage] extracted entries=${usageEntries.length} total=${aggregatedMetrics.totalTokens} input=${
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

        const groupedCredentialAccess = new Map<
            string,
            {
                credentialId?: string
                credentialName?: string
                model?: string
                usageCount: number
            }
        >()

        for (const access of credentialAccesses) {
            const groupKey = `${access.credentialId || ''}:${access.credentialName || 'Unknown Credential'}`
            const existing = groupedCredentialAccess.get(groupKey)
            if (existing) {
                existing.usageCount += 1
            } else {
                groupedCredentialAccess.set(groupKey, {
                    credentialId: access.credentialId,
                    credentialName: access.credentialName || 'Unknown Credential',
                    model: access.model,
                    usageCount: 1
                })
            }
        }

        const groups = Array.from(groupedCredentialAccess.values())
        const weights = groups.map((group) => group.usageCount)

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

        const topModel = getTopModel(modelTotals)

        const credentialRows = groups.map((group, index) => {
            const usageBreakdown: Record<string, number> = {}
            for (const key of additionalBreakdownKeys) {
                usageBreakdown[key] = distributedAdditionalBreakdown[key][index] || 0
            }

            return this.dataSource.getRepository(TokenUsageCredential).create({
                usageExecutionId: savedExecution.id,
                workspaceId: input.workspaceId,
                organizationId: input.organizationId,
                userId: input.userId,
                credentialId: group.credentialId,
                credentialName: group.credentialName,
                model: group.model || topModel,
                usageCount: group.usageCount,
                inputTokens: distributedMetrics.inputTokens[index] || 0,
                outputTokens: distributedMetrics.outputTokens[index] || 0,
                totalTokens: distributedMetrics.totalTokens[index] || 0,
                cacheReadTokens: distributedMetrics.cacheReadTokens[index] || 0,
                cacheWriteTokens: distributedMetrics.cacheWriteTokens[index] || 0,
                reasoningTokens: distributedMetrics.reasoningTokens[index] || 0,
                acceptedPredictionTokens: distributedMetrics.acceptedPredictionTokens[index] || 0,
                rejectedPredictionTokens: distributedMetrics.rejectedPredictionTokens[index] || 0,
                audioInputTokens: distributedMetrics.audioInputTokens[index] || 0,
                audioOutputTokens: distributedMetrics.audioOutputTokens[index] || 0,
                usageBreakdown: JSON.stringify(usageBreakdown)
            })
        })

        const savedCredentialRows = await this.dataSource.getRepository(TokenUsageCredential).save(credentialRows)
        logger.info(`[token-usage] credential rows inserted count=${credentialRows.length} executionId=${savedExecution.id}`)

        if (!input.userId) {
            logger.info(`[token-usage] skip credit consumption: missing userId executionId=${savedExecution.id}`)
            return
        }

        const workspaceCreditService = new WorkspaceCreditService()
        const creditResult = await workspaceCreditService.consumeCreditByCredentialUsages(
            input.workspaceId,
            input.userId,
            savedCredentialRows.map((row) => ({
                credentialId: row.credentialId,
                credentialName: row.credentialName,
                totalTokens: row.totalTokens || 0
            }))
        )
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
}
