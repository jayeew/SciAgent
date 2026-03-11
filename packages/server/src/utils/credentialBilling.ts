import { StatusCodes } from 'http-status-codes'
import {
    CredentialBillingMode,
    ICredentialBillingRule,
    ICredentialBillingRuleMap,
    ICredentialBillingUsage,
    ICredentialCharactersBillingRule,
    ICredentialLegacyBillingFallback,
    ICredentialModelBillingConfig,
    ICredentialSecondsBillingRule,
    ICredentialTokenBillingRule,
    ICredentialUnitBillingRule
} from '../Interface'
import { Credential } from '../database/entities/Credential'
import { InternalFlowiseError } from '../errors/internalFlowiseError'

export const MODEL_NAME_MAX_LENGTH = 255
export const LEGACY_DEFAULT_RMB_PER_MTOK = 0
export const ONE_MILLION_TOKENS = 1_000_000
export const TEN_THOUSAND_CHARACTERS = 10_000

const BILLING_MODES: CredentialBillingMode[] = ['token', 'image_count', 'video_count', 'seconds', 'characters']

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))

const isNonNegativeNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0

const normalizeMultiplier = (value: unknown): number | null => {
    const multiplier = Number(value)
    if (!Number.isFinite(multiplier) || multiplier <= 0) return null
    return multiplier
}

const normalizeBillingMode = (value: unknown): CredentialBillingMode | null => {
    if (typeof value !== 'string') return null
    const normalized = value.trim().toLowerCase() as CredentialBillingMode
    return BILLING_MODES.includes(normalized) ? normalized : null
}

const normalizeTokenRule = (rawValue: unknown): ICredentialTokenBillingRule | null => {
    if (typeof rawValue === 'number' || typeof rawValue === 'string') {
        const multiplier = normalizeMultiplier(rawValue)
        if (!multiplier) return null

        return {
            billingMode: 'token',
            multiplier,
            inputRmbPerMTok: LEGACY_DEFAULT_RMB_PER_MTOK,
            outputRmbPerMTok: LEGACY_DEFAULT_RMB_PER_MTOK
        }
    }

    if (!isRecord(rawValue)) return null

    const multiplier = normalizeMultiplier(rawValue.multiplier)
    if (!multiplier) return null

    const inputRmbPerMTok = Number(rawValue.inputRmbPerMTok)
    const outputRmbPerMTok = Number(rawValue.outputRmbPerMTok)
    const legacyRmbPerMTok = Number(rawValue.rmbPerMTok)

    if (Number.isFinite(inputRmbPerMTok) && inputRmbPerMTok >= 0 && Number.isFinite(outputRmbPerMTok) && outputRmbPerMTok >= 0) {
        return {
            billingMode: 'token',
            multiplier,
            inputRmbPerMTok,
            outputRmbPerMTok
        }
    }

    if (!Number.isFinite(legacyRmbPerMTok) || legacyRmbPerMTok < 0) return null

    return {
        billingMode: 'token',
        multiplier,
        inputRmbPerMTok: legacyRmbPerMTok,
        outputRmbPerMTok: legacyRmbPerMTok
    }
}

const normalizeBillingRule = (rawValue: unknown): ICredentialBillingRule | null => {
    if (!isRecord(rawValue)) {
        return normalizeTokenRule(rawValue)
    }

    const billingMode = normalizeBillingMode(rawValue.billingMode)
    if (!billingMode) {
        return normalizeTokenRule(rawValue)
    }

    const multiplier = normalizeMultiplier(rawValue.multiplier)
    if (!multiplier) return null

    switch (billingMode) {
        case 'token': {
            const inputRmbPerMTok = Number(rawValue.inputRmbPerMTok)
            const outputRmbPerMTok = Number(rawValue.outputRmbPerMTok)
            if (!Number.isFinite(inputRmbPerMTok) || inputRmbPerMTok < 0 || !Number.isFinite(outputRmbPerMTok) || outputRmbPerMTok < 0) {
                return null
            }

            return {
                billingMode,
                multiplier,
                inputRmbPerMTok,
                outputRmbPerMTok
            }
        }
        case 'image_count':
        case 'video_count': {
            const rmbPerUnit = Number(rawValue.rmbPerUnit)
            if (!Number.isFinite(rmbPerUnit) || rmbPerUnit < 0) return null

            return {
                billingMode,
                multiplier,
                rmbPerUnit
            } as ICredentialUnitBillingRule
        }
        case 'seconds': {
            const rmbPerSecond = Number(rawValue.rmbPerSecond)
            if (!Number.isFinite(rmbPerSecond) || rmbPerSecond < 0) return null

            return {
                billingMode,
                multiplier,
                rmbPerSecond
            } as ICredentialSecondsBillingRule
        }
        case 'characters': {
            const rmbPer10kChars = Number(rawValue.rmbPer10kChars)
            if (!Number.isFinite(rmbPer10kChars) || rmbPer10kChars < 0) return null

            return {
                billingMode,
                multiplier,
                rmbPer10kChars
            } as ICredentialCharactersBillingRule
        }
        default:
            return null
    }
}

export const parseCredentialBillingRules = (value?: string | null): ICredentialBillingRuleMap => {
    if (!value) return {}

    try {
        const parsed = JSON.parse(value)
        if (!isRecord(parsed)) return {}

        const result: ICredentialBillingRuleMap = {}
        for (const [rawModelName, rawRule] of Object.entries(parsed)) {
            const modelName = String(rawModelName).trim()
            if (!modelName || modelName.length > MODEL_NAME_MAX_LENGTH) continue

            const normalizedRule = normalizeBillingRule(rawRule)
            if (!normalizedRule) continue

            result[modelName] = normalizedRule
        }

        return result
    } catch {
        return {}
    }
}

export const convertLegacyModelMultipliersToBillingRules = (
    value?: string | null | Record<string, ICredentialModelBillingConfig> | Record<string, number>
): ICredentialBillingRuleMap => {
    if (!value) return {}

    let parsedValue: unknown = value
    if (typeof value === 'string') {
        try {
            parsedValue = JSON.parse(value)
        } catch {
            return {}
        }
    }

    if (!isRecord(parsedValue)) return {}

    const result: ICredentialBillingRuleMap = {}
    for (const [rawModelName, rawRule] of Object.entries(parsedValue)) {
        const modelName = String(rawModelName).trim()
        if (!modelName || modelName.length > MODEL_NAME_MAX_LENGTH) continue

        const normalizedRule = normalizeTokenRule(rawRule)
        if (!normalizedRule) continue

        result[modelName] = normalizedRule
    }

    return result
}

export const mergeBillingRuleMaps = (
    primaryRules: ICredentialBillingRuleMap,
    fallbackRules: ICredentialBillingRuleMap
): ICredentialBillingRuleMap => {
    const mergedRules: ICredentialBillingRuleMap = { ...primaryRules }

    for (const [modelName, rule] of Object.entries(fallbackRules)) {
        if (!mergedRules[modelName]) {
            mergedRules[modelName] = rule
        }
    }

    return mergedRules
}

export const validateAndNormalizeBillingRules = (billingRules: unknown): ICredentialBillingRuleMap => {
    if (!isRecord(billingRules)) {
        throw new InternalFlowiseError(StatusCodes.BAD_REQUEST, 'Invalid billing rules payload')
    }

    const normalizedRules: ICredentialBillingRuleMap = {}

    for (const [rawModelName, rawRule] of Object.entries(billingRules)) {
        const modelName = rawModelName.trim()
        if (!modelName) {
            throw new InternalFlowiseError(StatusCodes.BAD_REQUEST, 'Model name cannot be empty')
        }
        if (modelName.length > MODEL_NAME_MAX_LENGTH) {
            throw new InternalFlowiseError(StatusCodes.BAD_REQUEST, `Model name "${modelName}" exceeds max length ${MODEL_NAME_MAX_LENGTH}`)
        }
        if (Object.prototype.hasOwnProperty.call(normalizedRules, modelName)) {
            throw new InternalFlowiseError(StatusCodes.BAD_REQUEST, `Duplicate model name: ${modelName}`)
        }

        const normalizedRule = normalizeBillingRule(rawRule)
        if (!normalizedRule) {
            throw new InternalFlowiseError(StatusCodes.BAD_REQUEST, `Invalid billing rule for "${modelName}"`)
        }

        normalizedRules[modelName] = normalizedRule
    }

    return normalizedRules
}

export const validateAndNormalizeLegacyModelMultipliers = (modelMultipliers: unknown): ICredentialBillingRuleMap => {
    if (!isRecord(modelMultipliers)) {
        throw new InternalFlowiseError(StatusCodes.BAD_REQUEST, 'Invalid model multipliers payload')
    }

    const normalizedRules: ICredentialBillingRuleMap = {}

    for (const [rawModelName, rawRule] of Object.entries(modelMultipliers)) {
        const modelName = rawModelName.trim()
        if (!modelName) {
            throw new InternalFlowiseError(StatusCodes.BAD_REQUEST, 'Model name cannot be empty')
        }
        if (modelName.length > MODEL_NAME_MAX_LENGTH) {
            throw new InternalFlowiseError(StatusCodes.BAD_REQUEST, `Model name "${modelName}" exceeds max length ${MODEL_NAME_MAX_LENGTH}`)
        }
        if (Object.prototype.hasOwnProperty.call(normalizedRules, modelName)) {
            throw new InternalFlowiseError(StatusCodes.BAD_REQUEST, `Duplicate model name: ${modelName}`)
        }

        const normalizedRule = normalizeTokenRule(rawRule)
        if (!normalizedRule) {
            throw new InternalFlowiseError(
                StatusCodes.BAD_REQUEST,
                `Invalid model billing config for "${modelName}". Expect { multiplier > 0, inputRmbPerMTok >= 0, outputRmbPerMTok >= 0 }`
            )
        }

        normalizedRules[modelName] = normalizedRule
    }

    return normalizedRules
}

export const getEffectiveCredentialBillingRules = (credential: Pick<Credential, 'billingRules' | 'creditConsumptionMultiplierByModel'>) => {
    return mergeBillingRuleMaps(
        parseCredentialBillingRules(typeof credential.billingRules === 'string' ? credential.billingRules : undefined),
        convertLegacyModelMultipliersToBillingRules(credential.creditConsumptionMultiplierByModel)
    )
}

export const getCredentialBillingRulesForStorage = (billingRules: ICredentialBillingRuleMap): string | undefined => {
    return Object.keys(billingRules).length ? JSON.stringify(billingRules) : undefined
}

export const getLegacyBillingFallbacks = (plainDataObj?: Record<string, unknown>): ICredentialLegacyBillingFallback[] => {
    if (!plainDataObj || typeof plainDataObj !== 'object') return []

    const fallbacks: ICredentialLegacyBillingFallback[] = []

    if (Object.prototype.hasOwnProperty.call(plainDataObj, 'inputRmbPerImage')) {
        const unitPrice = Number(plainDataObj.inputRmbPerImage)
        if (Number.isFinite(unitPrice) && unitPrice >= 0) {
            fallbacks.push({
                billingMode: 'image_count',
                sourceField: 'inputRmbPerImage',
                unitPrice
            })
        }
    }

    if (Object.prototype.hasOwnProperty.call(plainDataObj, 'inputRmbPerSecond')) {
        const unitPrice = Number(plainDataObj.inputRmbPerSecond)
        if (Number.isFinite(unitPrice) && unitPrice >= 0) {
            fallbacks.push({
                billingMode: 'seconds',
                sourceField: 'inputRmbPerSecond',
                unitPrice
            })
        }
    }

    if (Object.prototype.hasOwnProperty.call(plainDataObj, 'inputRmbPer10kChars')) {
        const unitPrice = Number(plainDataObj.inputRmbPer10kChars)
        if (Number.isFinite(unitPrice) && unitPrice >= 0) {
            fallbacks.push({
                billingMode: 'characters',
                sourceField: 'inputRmbPer10kChars',
                unitPrice
            })
        }
    }

    return fallbacks
}

export const getLegacyFallbackRule = (
    plainDataObj: Record<string, unknown> | undefined,
    billingMode: ICredentialBillingUsage['billingMode']
): ICredentialBillingRule | undefined => {
    const legacyFallbacks = getLegacyBillingFallbacks(plainDataObj)

    switch (billingMode) {
        case 'image_count': {
            const fallback = legacyFallbacks.find((item) => item.billingMode === billingMode)
            if (!fallback) return undefined

            return {
                billingMode,
                multiplier: 1,
                rmbPerUnit: fallback.unitPrice
            }
        }
        case 'seconds': {
            const fallback = legacyFallbacks.find((item) => item.billingMode === billingMode)
            if (!fallback) return undefined

            return {
                billingMode,
                multiplier: 1,
                rmbPerSecond: fallback.unitPrice
            }
        }
        case 'characters': {
            const fallback = legacyFallbacks.find((item) => item.billingMode === billingMode)
            if (!fallback) return undefined

            return {
                billingMode,
                multiplier: 1,
                rmbPer10kChars: fallback.unitPrice
            }
        }
        default:
            return undefined
    }
}

export const getNormalizedCredentialMultiplier = (credential?: Pick<Credential, 'creditConsumptionMultiplier'>): number => {
    const multiplier = Number(credential?.creditConsumptionMultiplier)
    return Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1
}

export const getNormalizedTokenUsage = (usage: ICredentialBillingUsage['usage']) => {
    const inputTokens = Number(usage.inputTokens)
    const outputTokens = Number(usage.outputTokens)
    const totalTokens = Number(usage.totalTokens)

    const normalizedInputTokens = Number.isFinite(inputTokens) && inputTokens > 0 ? inputTokens : 0
    const normalizedOutputTokens = Number.isFinite(outputTokens) && outputTokens > 0 ? outputTokens : 0
    const normalizedTotalTokens = Number.isFinite(totalTokens) && totalTokens > 0 ? totalTokens : 0
    const hasDirectionalTokens = normalizedInputTokens > 0 || normalizedOutputTokens > 0

    return {
        inputTokens: normalizedInputTokens,
        outputTokens: normalizedOutputTokens,
        totalTokens: normalizedTotalTokens,
        billableInputTokens: hasDirectionalTokens ? normalizedInputTokens : normalizedTotalTokens,
        billableOutputTokens: hasDirectionalTokens ? normalizedOutputTokens : 0,
        billableTotalTokens: hasDirectionalTokens ? normalizedInputTokens + normalizedOutputTokens : normalizedTotalTokens
    }
}

export const getResolvedRuleForUsage = (
    credential: Pick<Credential, 'billingRules' | 'creditConsumptionMultiplierByModel'> | undefined,
    plainDataObj: Record<string, unknown> | undefined,
    usage: ICredentialBillingUsage
): {
    rule?: ICredentialBillingRule
    source: 'billing_rules' | 'legacy_compatibility' | 'missing'
    modeMismatch: boolean
} => {
    const normalizedModel = typeof usage.model === 'string' ? usage.model.trim() : ''
    const effectiveRules = credential ? getEffectiveCredentialBillingRules(credential) : {}

    if (normalizedModel && effectiveRules[normalizedModel]) {
        const rule = effectiveRules[normalizedModel]
        return {
            rule,
            source: 'billing_rules',
            modeMismatch: rule.billingMode !== usage.billingMode
        }
    }

    const legacyRule = getLegacyFallbackRule(plainDataObj, usage.billingMode)
    if (legacyRule) {
        return {
            rule: legacyRule,
            source: 'legacy_compatibility',
            modeMismatch: false
        }
    }

    return {
        source: 'missing',
        modeMismatch: false
    }
}

export const calculateBaseCreditFromRmb = (costRmb: number): number => {
    if (!Number.isFinite(costRmb) || costRmb <= 0) return 0
    return Math.ceil(costRmb * 100 - Number.EPSILON)
}
