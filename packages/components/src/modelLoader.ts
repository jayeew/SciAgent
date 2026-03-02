import axios from 'axios'
import * as fs from 'fs'
import * as path from 'path'
import { INodeOptionsValue } from './Interface'

export enum MODEL_TYPE {
    CHAT = 'chat',
    LLM = 'llm',
    EMBEDDING = 'embedding'
}

const DEFAULT_MODEL_LIST_FETCH_TIMEOUT_MS = 10000
const DEFAULT_MODEL_LIST_CACHE_TTL_MS = 5 * 60 * 1000

let cachedRemoteModelFile: Record<string, any> | undefined
let cachedRemoteModelFileFetchedAt = 0
let cachedRemoteModelFileUrl = ''

const getModelsJSONPath = (): string => {
    const checkModelsPaths = [path.join(__dirname, '..', 'models.json'), path.join(__dirname, '..', '..', 'models.json')]
    for (const checkPath of checkModelsPaths) {
        if (fs.existsSync(checkPath)) {
            return checkPath
        }
    }
    return ''
}

const isValidUrl = (urlString: string) => {
    let url
    try {
        url = new URL(urlString)
    } catch (e) {
        return false
    }
    return url.protocol === 'http:' || url.protocol === 'https:'
}

const getModelListFetchTimeoutMs = () => {
    const rawValue = process.env.MODEL_LIST_FETCH_TIMEOUT_MS
    const parsed = Number(rawValue)
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return DEFAULT_MODEL_LIST_FETCH_TIMEOUT_MS
    }
    return parsed
}

const getModelListCacheTtlMs = () => {
    const rawValue = process.env.MODEL_LIST_CACHE_TTL_MS
    const parsed = Number(rawValue)
    if (!Number.isFinite(parsed) || parsed < 0) {
        return DEFAULT_MODEL_LIST_CACHE_TTL_MS
    }
    return parsed
}

const loadBundledModelFile = async (): Promise<Record<string, any>> => {
    const bundledModelsPath = getModelsJSONPath()
    if (!bundledModelsPath) return {}

    try {
        const models = await fs.promises.readFile(bundledModelsPath, 'utf8')
        if (models) {
            return JSON.parse(models)
        }
        return {}
    } catch (e) {
        return {}
    }
}

/**
 * Load the raw model file from either a URL or a local file
 * If any of the loading fails, fallback to the default models.json file on disk
 */
const getRawModelFile = async () => {
    const modelFile = process.env.MODEL_LIST_CONFIG_JSON
    const cacheTtlMs = getModelListCacheTtlMs()

    // Default behavior: use bundled local models.json to avoid runtime network dependency.
    if (!modelFile) {
        return await loadBundledModelFile()
    }

    try {
        if (isValidUrl(modelFile)) {
            if (
                cacheTtlMs > 0 &&
                cachedRemoteModelFile &&
                cachedRemoteModelFileUrl === modelFile &&
                Date.now() - cachedRemoteModelFileFetchedAt < cacheTtlMs
            ) {
                return cachedRemoteModelFile
            }

            const resp = await axios.get(modelFile, { timeout: getModelListFetchTimeoutMs() })
            if (resp.status === 200 && resp.data) {
                cachedRemoteModelFile = resp.data
                cachedRemoteModelFileFetchedAt = Date.now()
                cachedRemoteModelFileUrl = modelFile
                return resp.data
            } else {
                throw new Error('Error fetching model list')
            }
        } else if (fs.existsSync(modelFile)) {
            const models = await fs.promises.readFile(modelFile, 'utf8')
            if (models) {
                return JSON.parse(models)
            }
        }
        throw new Error('Model file does not exist or is empty')
    } catch (e) {
        return await loadBundledModelFile()
    }
}

const getModelConfig = async (category: MODEL_TYPE, name: string) => {
    const models = await getRawModelFile()

    const categoryModels = Array.isArray(models?.[category]) ? models[category] : []
    return categoryModels.find((model: INodeOptionsValue) => model.name === name)
}

export const getModelConfigByModelName = async (category: MODEL_TYPE, provider: string | undefined, name: string | undefined) => {
    const models = await getRawModelFile()

    const categoryModels = models[category]
    return getSpecificModelFromCategory(categoryModels, provider, name)
}

const getSpecificModelFromCategory = (categoryModels: any, provider: string | undefined, name: string | undefined) => {
    if (!Array.isArray(categoryModels)) return undefined

    for (const cm of categoryModels) {
        if (cm.models && cm.name.toLowerCase() === provider?.toLowerCase()) {
            for (const m of cm.models) {
                if (m.name === name) {
                    return m
                }
            }
        }
    }
    return undefined
}

export const getModels = async (category: MODEL_TYPE, name: string) => {
    const returnData: INodeOptionsValue[] = []
    try {
        const modelConfig = await getModelConfig(category, name)
        if (!modelConfig || !Array.isArray(modelConfig.models)) return returnData
        returnData.push(...modelConfig.models)
        return returnData
    } catch (e) {
        throw new Error(`Error: getModels - ${e}`)
    }
}

export const getRegions = async (category: MODEL_TYPE, name: string) => {
    const returnData: INodeOptionsValue[] = []
    try {
        const modelConfig = await getModelConfig(category, name)
        if (!modelConfig || !Array.isArray(modelConfig.regions)) return returnData
        returnData.push(...modelConfig.regions)
        return returnData
    } catch (e) {
        throw new Error(`Error: getRegions - ${e}`)
    }
}
