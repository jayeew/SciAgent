import { AxiosResponse } from 'axios'
import { ICommonObject, IFileUpload } from '../../../src/Interface'
import {
    BaseMediaModel,
    IMediaArtifact,
    IMediaGenerationInput,
    IMediaGenerationMetadata,
    IMediaGenerationResult,
    IMediaVideoSummary
} from '../../../src/mediaModels'
import { secureAxiosRequest, secureFetch } from '../../../src/httpSecurity'
import { addSingleFileToStorage, getFileFromStorage } from '../../../src/storageUtils'
import { mapMimeTypeToExt, parseJsonBody } from '../../../src/utils'

export const DEFAULT_DOUBAO_ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'
export const DEFAULT_DOUBAO_VIDEO_MODEL = 'doubao-seedance-1-5-pro-251215'
export const DEFAULT_DOUBAO_VIDEO_RATIO = '16:9'
export const DEFAULT_DOUBAO_VIDEO_RESOLUTION = '720p'
export const DEFAULT_DOUBAO_VIDEO_DURATION = 5
export const DEFAULT_DOUBAO_VIDEO_CAMERA_FIXED = false
export const DEFAULT_DOUBAO_VIDEO_WATERMARK = false
export const DEFAULT_DOUBAO_VIDEO_POLL_INTERVAL_MS = 3000
export const DEFAULT_DOUBAO_VIDEO_TIMEOUT_MS = 180000
export const DOUBAO_VIDEO_PROVIDER = 'doubao-ark'
export const DOUBAO_VIDEO_MIN_DURATION = 2
export const DOUBAO_VIDEO_MAX_DURATION = 12

const DOUBAO_VIDEO_MODEL_ALIASES: Record<string, string> = {
    'doubao-seedance-1-0-pro': 'doubao-seedance-1-0-pro-250528',
    'doubao-seedance-1-5-pro': DEFAULT_DOUBAO_VIDEO_MODEL
}

export interface IDoubaoVideoGenerationSchema {
    prompt: string
    ratio?: string
    resolution?: string
    duration?: number
    frames?: number
    seed?: number
    cameraFixed?: boolean
    watermark?: boolean
}

export interface IDoubaoVideoGenerationConfig {
    apiKey: string
    credentialId?: string
    baseUrl?: string
    model?: string
    ratio?: string
    resolution?: string
    duration?: number
    frames?: number
    seed?: number
    cameraFixed?: boolean
    watermark?: boolean
    pollIntervalMs?: number
    timeoutMs?: number
    chatflowid?: string
    orgId?: string
}

export interface IDoubaoVideoGenerationArgs {
    prompt: string
    model: string
    ratio: string
    resolution: string
    duration?: number
    frames?: number
    seed?: number
    cameraFixed: boolean
    watermark: boolean
}

interface IDoubaoArkVideoTextContent {
    type: 'text'
    text: string
}

interface IDoubaoArkVideoImageUrlContent {
    type: 'image_url'
    image_url: {
        url: string
    }
}

type IDoubaoArkVideoContent = IDoubaoArkVideoTextContent | IDoubaoArkVideoImageUrlContent

interface IDoubaoArkVideoRequest {
    model: string
    content: IDoubaoArkVideoContent[]
    resolution: string
    ratio: string
    duration?: number
    frames?: number
    seed?: number
    camera_fixed: boolean
    watermark: boolean
}

interface IDoubaoArkVideoTaskCreationResponse {
    id?: string
}

interface IDoubaoArkVideoTaskContent {
    video_url?: string
}

interface IDoubaoArkVideoTaskStatusResponse {
    id?: string
    model?: string
    status?: string
    content?: IDoubaoArkVideoTaskContent
    usage?: Record<string, unknown>
    created_at?: number
    updated_at?: number
    seed?: number
    resolution?: string
    ratio?: string
    duration?: number
    frames?: number
    framespersecond?: number
    error?: Record<string, unknown> | string
    message?: string
    detail?: string
}

interface IStorageContext {
    chatflowid?: string
    orgId?: string
    chatId?: string
}

interface IResolvedReferenceFrame {
    url: string
}

const VIDEO_ARTIFACT_TYPES = new Set(['mp4', 'webm', 'mov', 'avi'])
const FAILED_TASK_STATUSES = new Set(['failed', 'error', 'cancelled', 'canceled', 'expired'])

export const normalizeDoubaoBaseUrl = (baseUrl?: string): string => {
    const normalizedBaseUrl = baseUrl?.trim() || DEFAULT_DOUBAO_ARK_BASE_URL
    return normalizedBaseUrl.replace(/\/+$/, '')
}

export const normalizeDoubaoVideoRatio = (ratio?: string): string | undefined => {
    if (!ratio) return undefined

    const trimmedRatio = ratio.trim()
    if (!trimmedRatio) return undefined

    const matchedRatio = trimmedRatio.match(/^(\d+)\s*:\s*(\d+)$/)
    if (matchedRatio) {
        return `${matchedRatio[1]}:${matchedRatio[2]}`
    }

    return trimmedRatio
}

export const normalizeDoubaoVideoResolution = (resolution?: string): string | undefined => {
    if (!resolution) return undefined

    const trimmedResolution = resolution.trim()
    if (!trimmedResolution) return undefined

    const matchedResolution = trimmedResolution.match(/^(\d+)\s*p$/i)
    if (matchedResolution) {
        return `${matchedResolution[1]}p`
    }

    return trimmedResolution
}

export const normalizeDoubaoVideoModel = (model?: string): string => {
    const normalizedModel = model?.trim() || DEFAULT_DOUBAO_VIDEO_MODEL
    return DOUBAO_VIDEO_MODEL_ALIASES[normalizedModel] || normalizedModel
}

const parseOptionalInteger = (
    value: unknown,
    fieldName: string,
    options?: {
        minimum?: number
        allowZero?: boolean
    }
): number | undefined => {
    if (value === undefined || value === null || value === '') return undefined

    const numericValue = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(numericValue)) {
        throw new Error(`${fieldName} must be a valid number`)
    }

    const normalizedValue = Math.trunc(numericValue)
    const minimum = options?.minimum ?? (options?.allowZero ? 0 : 1)
    if (normalizedValue < minimum) {
        throw new Error(`${fieldName} must be greater than or equal to ${minimum}`)
    }

    return normalizedValue
}

export const resolveDoubaoVideoGenerationArgs = (
    input: IDoubaoVideoGenerationSchema,
    config: Partial<IDoubaoVideoGenerationConfig>
): IDoubaoVideoGenerationArgs => {
    const prompt = input.prompt?.trim()
    if (!prompt) {
        throw new Error('Prompt is required')
    }

    const duration = parseOptionalInteger(input.duration ?? config.duration, 'Duration')
    const frames = duration === undefined ? parseOptionalInteger(input.frames ?? config.frames, 'Frames') : undefined
    if (duration === undefined && frames === undefined) {
        throw new Error('Either duration or frames is required')
    }

    const seed = parseOptionalInteger(input.seed ?? config.seed, 'Seed', {
        allowZero: true
    })

    const model = normalizeDoubaoVideoModel(config.model)

    if (typeof duration === 'number' && (duration < DOUBAO_VIDEO_MIN_DURATION || duration > DOUBAO_VIDEO_MAX_DURATION)) {
        throw new Error(`Duration must be between ${DOUBAO_VIDEO_MIN_DURATION} and ${DOUBAO_VIDEO_MAX_DURATION} seconds for model ${model}`)
    }

    return {
        prompt,
        model,
        ratio: normalizeDoubaoVideoRatio(input.ratio) || normalizeDoubaoVideoRatio(config.ratio) || DEFAULT_DOUBAO_VIDEO_RATIO,
        resolution:
            normalizeDoubaoVideoResolution(input.resolution) ||
            normalizeDoubaoVideoResolution(config.resolution) ||
            DEFAULT_DOUBAO_VIDEO_RESOLUTION,
        ...(typeof duration === 'number' ? { duration } : {}),
        ...(typeof frames === 'number' ? { frames } : {}),
        ...(typeof seed === 'number' ? { seed } : {}),
        cameraFixed: typeof input.cameraFixed === 'boolean' ? input.cameraFixed : config.cameraFixed ?? DEFAULT_DOUBAO_VIDEO_CAMERA_FIXED,
        watermark: typeof input.watermark === 'boolean' ? input.watermark : config.watermark ?? DEFAULT_DOUBAO_VIDEO_WATERMARK
    }
}

const parseMaybeJson = (value: unknown): unknown => {
    if (typeof value !== 'string') return value

    const trimmedValue = value.trim()
    if (!trimmedValue) return value

    if (!(trimmedValue.startsWith('{') || trimmedValue.startsWith('['))) {
        return value
    }

    try {
        return parseJsonBody(trimmedValue)
    } catch {
        return value
    }
}

const getSafeDoubaoErrorMessage = (error: any): string => {
    const responseData = parseMaybeJson(error?.response?.data ?? error?.data)
    const responseDataRecord = responseData && typeof responseData === 'object' ? (responseData as Record<string, any>) : undefined
    const responseError =
        responseDataRecord?.error && typeof responseDataRecord.error === 'object'
            ? (responseDataRecord.error as Record<string, unknown>)
            : undefined

    const candidates = [
        responseDataRecord?.message,
        responseError?.message,
        responseDataRecord?.detail,
        responseDataRecord?.msg,
        error?.message
    ]

    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim()) {
            return candidate.trim()
        }
    }

    const status = error?.response?.status ?? error?.status
    if (status) {
        return `Doubao Ark request failed with status ${status}`
    }

    return 'Doubao Ark request failed'
}

const normalizeResponseRecord = (response: AxiosResponse): Record<string, unknown> => {
    if (response.status < 200 || response.status >= 300) {
        throw new Error(getSafeDoubaoErrorMessage({ response }))
    }

    const responseData = parseMaybeJson(response.data)
    if (!responseData || typeof responseData !== 'object') {
        throw new Error('Doubao Ark returned an invalid response')
    }

    return responseData as Record<string, unknown>
}

const normalizeTaskCreationResponse = (response: AxiosResponse): IDoubaoArkVideoTaskCreationResponse => {
    const record = normalizeResponseRecord(response)
    return record as IDoubaoArkVideoTaskCreationResponse
}

const normalizeTaskStatusResponse = (response: AxiosResponse): IDoubaoArkVideoTaskStatusResponse => {
    const record = normalizeResponseRecord(response)
    const normalizedContent = parseMaybeJson(record.content)

    return {
        ...(record as IDoubaoArkVideoTaskStatusResponse),
        ...(normalizedContent && typeof normalizedContent === 'object'
            ? {
                  content: normalizedContent as IDoubaoArkVideoTaskContent
              }
            : {})
    }
}

const getTaskFailureMessage = (taskResponse: IDoubaoArkVideoTaskStatusResponse): string => {
    return getSafeDoubaoErrorMessage({
        data: taskResponse,
        message: taskResponse.status ? `Doubao Ark video task ended with status ${taskResponse.status}` : undefined
    })
}

const getVideoArtifactType = (contentType?: string, resourceUrl?: string): 'mp4' | 'webm' | 'mov' | 'avi' => {
    const normalizedContentType = contentType?.split(';')[0]?.trim().toLowerCase()
    const extensionFromMimeType = normalizedContentType ? mapMimeTypeToExt(normalizedContentType) : ''
    if (VIDEO_ARTIFACT_TYPES.has(extensionFromMimeType)) {
        return extensionFromMimeType as 'mp4' | 'webm' | 'mov' | 'avi'
    }

    const normalizedResourceUrl = resourceUrl?.split('?')[0]?.trim().toLowerCase()
    if (normalizedResourceUrl?.endsWith('.webm')) return 'webm'
    if (normalizedResourceUrl?.endsWith('.mov')) return 'mov'
    if (normalizedResourceUrl?.endsWith('.avi')) return 'avi'

    return 'mp4'
}

const getMimeTypeForVideoArtifact = (artifactType: 'mp4' | 'webm' | 'mov' | 'avi'): string => {
    switch (artifactType) {
        case 'webm':
            return 'video/webm'
        case 'mov':
            return 'video/quicktime'
        case 'avi':
            return 'video/x-msvideo'
        case 'mp4':
        default:
            return 'video/mp4'
    }
}

const getSummaryPayload = (
    taskResponse: IDoubaoArkVideoTaskStatusResponse,
    effectiveArgs: IDoubaoVideoGenerationArgs,
    videos: IMediaVideoSummary[]
): IMediaGenerationMetadata => {
    return {
        provider: DOUBAO_VIDEO_PROVIDER,
        model: taskResponse.model || effectiveArgs.model,
        prompt: effectiveArgs.prompt,
        source: 'media_generation',
        mediaType: 'video',
        videoCount: videos.length,
        videos,
        usage: taskResponse.usage ?? null,
        created: taskResponse.created_at ?? null,
        updated: taskResponse.updated_at ?? null,
        taskId: taskResponse.id ?? null,
        status: taskResponse.status ?? null,
        ratio: taskResponse.ratio || effectiveArgs.ratio,
        resolution: taskResponse.resolution || effectiveArgs.resolution,
        duration: taskResponse.duration ?? effectiveArgs.duration ?? null,
        frames: taskResponse.frames ?? effectiveArgs.frames ?? null,
        seed: taskResponse.seed ?? effectiveArgs.seed ?? null
    }
}

const getNormalizedUsageValue = (usage: Record<string, unknown> | undefined, keys: string[]): number | undefined => {
    if (!usage) return undefined

    for (const key of keys) {
        const value = Number(usage[key])
        if (Number.isFinite(value) && value >= 0) {
            return value
        }
    }

    return undefined
}

const getMediaBillingPayload = (
    credentialId: string | undefined,
    taskResponse: IDoubaoArkVideoTaskStatusResponse,
    effectiveArgs: IDoubaoVideoGenerationArgs
) => {
    const usage = taskResponse.usage
    const inputTokens = getNormalizedUsageValue(usage, ['input_tokens', 'prompt_tokens'])
    const outputTokens = getNormalizedUsageValue(usage, ['output_tokens', 'completion_tokens'])
    const totalTokens = getNormalizedUsageValue(usage, ['total_tokens'])

    return {
        provider: DOUBAO_VIDEO_PROVIDER,
        credentialId,
        model: taskResponse.model || effectiveArgs.model,
        source: 'media_generation',
        billingMode: 'token' as const,
        usage: {
            ...(typeof inputTokens === 'number' ? { inputTokens } : {}),
            ...(typeof outputTokens === 'number' ? { outputTokens } : {}),
            ...(typeof totalTokens === 'number' ? { totalTokens } : {})
        }
    }
}

const buildGenerationText = (metadata: IMediaGenerationMetadata): string => {
    const videoCount = metadata.videoCount ?? 0
    return `Generated ${videoCount} video${videoCount === 1 ? '' : 's'} with ${metadata.provider}.`
}

const normalizeReferenceFrameUrl = (value: string): string => {
    const normalizedValue = value.trim()
    if (!normalizedValue) {
        throw new Error('Doubao image-to-video reference image URL is missing')
    }

    if (normalizedValue.startsWith('data:image/')) {
        return normalizedValue
    }

    const uriListEntry = normalizedValue
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line && !line.startsWith('#'))

    if (!uriListEntry) {
        throw new Error('Doubao image-to-video reference image URL is missing')
    }

    let parsedUrl: URL
    try {
        parsedUrl = new URL(uriListEntry)
    } catch {
        throw new Error('Doubao image-to-video reference image URL must be a valid absolute http(s) URL')
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        throw new Error('Doubao image-to-video reference image URL must use http or https')
    }

    return parsedUrl.toString()
}

const hasStorageContext = (storageContext: IStorageContext): storageContext is Required<IStorageContext> => {
    return Boolean(storageContext.chatflowid && storageContext.orgId && storageContext.chatId)
}

const resolveStorageContext = (
    config: Pick<IDoubaoVideoGenerationConfig, 'chatflowid' | 'orgId'>,
    options?: ICommonObject
): IStorageContext => {
    const chatflowid = typeof options?.chatflowid === 'string' ? options.chatflowid : config.chatflowid
    const orgId = typeof options?.orgId === 'string' ? options.orgId : config.orgId
    const chatId = typeof options?.chatId === 'string' ? options.chatId : undefined

    return {
        chatflowid,
        orgId,
        chatId
    }
}

const resolveReferenceFramePayload = async (
    referenceImages: IFileUpload[] | undefined,
    storageContext: IStorageContext
): Promise<IResolvedReferenceFrame | undefined> => {
    if (!referenceImages?.length) return undefined

    if (referenceImages.length > 1) {
        throw new Error('Doubao image-to-video supports exactly one reference image')
    }

    const referenceImage = referenceImages[0]

    if (referenceImage.type === 'stored-file') {
        if (!hasStorageContext(storageContext)) {
            throw new Error('Doubao image-to-video requires chat storage context for uploaded reference images')
        }

        const fileName = referenceImage.name.replace(/^FILE-STORAGE::/, '').trim()
        if (!fileName) {
            throw new Error('Doubao image-to-video reference image file name is missing')
        }

        const fileBuffer = await getFileFromStorage(fileName, storageContext.orgId, storageContext.chatflowid, storageContext.chatId)
        const base64Payload = fileBuffer.toString('base64')
        const mimeType = referenceImage.mime?.trim() || 'image/png'
        return {
            url: `data:${mimeType};base64,${base64Payload}`
        }
    }

    if (referenceImage.type === 'url') {
        return { url: normalizeReferenceFrameUrl(referenceImage.data || '') }
    }

    const rawData = referenceImage.data?.trim()
    if (!rawData) {
        throw new Error(`Doubao image-to-video does not support reference image type: ${referenceImage.type}`)
    }

    if (rawData.startsWith('data:image/')) {
        return { url: rawData }
    }

    const mimeType = referenceImage.mime?.trim()
    if (mimeType?.startsWith('image/')) {
        return {
            url: `data:${mimeType};base64,${rawData}`
        }
    }

    return { url: rawData }
}

const buildDoubaoVideoRequestPayload = (
    effectiveArgs: IDoubaoVideoGenerationArgs,
    referenceFrame?: IResolvedReferenceFrame
): IDoubaoArkVideoRequest => {
    const content: IDoubaoArkVideoContent[] = [
        {
            type: 'text',
            text: effectiveArgs.prompt
        }
    ]

    if (referenceFrame?.url) {
        content.push({
            type: 'image_url',
            image_url: {
                url: referenceFrame.url
            }
        })
    }

    return {
        model: effectiveArgs.model,
        content,
        resolution: effectiveArgs.resolution,
        ratio: effectiveArgs.ratio,
        ...(typeof effectiveArgs.duration === 'number' ? { duration: effectiveArgs.duration } : {}),
        ...(typeof effectiveArgs.frames === 'number' ? { frames: effectiveArgs.frames } : {}),
        ...(typeof effectiveArgs.seed === 'number' ? { seed: effectiveArgs.seed } : {}),
        camera_fixed: effectiveArgs.cameraFixed,
        watermark: effectiveArgs.watermark
    }
}

const wait = async (durationMs: number): Promise<void> =>
    new Promise((resolve) => {
        setTimeout(resolve, durationMs)
    })

export class DoubaoVideoModel extends BaseMediaModel {
    readonly provider = DOUBAO_VIDEO_PROVIDER
    readonly modelName: string
    readonly capabilities = {
        textToVideo: true,
        imageToVideo: true,
        multiTurnPrompting: true
    }

    private readonly apiKey: string
    private readonly credentialId?: string
    private readonly baseUrl: string
    private readonly ratio?: string
    private readonly resolution?: string
    private readonly duration?: number
    private readonly frames?: number
    private readonly seed?: number
    private readonly cameraFixed: boolean
    private readonly watermark: boolean
    private readonly pollIntervalMs: number
    private readonly timeoutMs: number
    private readonly chatflowid?: string
    private readonly orgId?: string

    constructor(config: IDoubaoVideoGenerationConfig) {
        super()
        this.apiKey = config.apiKey
        this.credentialId = config.credentialId
        this.baseUrl = normalizeDoubaoBaseUrl(config.baseUrl)
        this.modelName = config.model?.trim() || DEFAULT_DOUBAO_VIDEO_MODEL
        this.ratio = normalizeDoubaoVideoRatio(config.ratio)
        this.resolution = normalizeDoubaoVideoResolution(config.resolution)
        this.duration = parseOptionalInteger(config.duration, 'Duration')
        this.frames = this.duration === undefined ? parseOptionalInteger(config.frames, 'Frames') : undefined
        this.seed = parseOptionalInteger(config.seed, 'Seed', {
            allowZero: true
        })
        this.cameraFixed = config.cameraFixed ?? DEFAULT_DOUBAO_VIDEO_CAMERA_FIXED
        this.watermark = config.watermark ?? DEFAULT_DOUBAO_VIDEO_WATERMARK
        this.pollIntervalMs =
            parseOptionalInteger(config.pollIntervalMs, 'Poll interval', {
                minimum: 1
            }) ?? DEFAULT_DOUBAO_VIDEO_POLL_INTERVAL_MS
        this.timeoutMs =
            parseOptionalInteger(config.timeoutMs, 'Timeout', {
                minimum: 1
            }) ?? DEFAULT_DOUBAO_VIDEO_TIMEOUT_MS
        this.chatflowid = config.chatflowid
        this.orgId = config.orgId
    }

    async invoke(input: IMediaGenerationInput, options?: ICommonObject): Promise<IMediaGenerationResult> {
        const effectiveArgs = resolveDoubaoVideoGenerationArgs(
            {
                prompt: input.prompt,
                ratio: input.ratio,
                resolution: input.resolution,
                duration: input.duration,
                frames: input.frames,
                seed: input.seed,
                cameraFixed: input.cameraFixed,
                watermark: input.watermark
            },
            {
                model: this.modelName,
                ratio: this.ratio,
                resolution: this.resolution,
                duration: this.duration,
                frames: this.frames,
                seed: this.seed,
                cameraFixed: this.cameraFixed,
                watermark: this.watermark,
                chatflowid: this.chatflowid,
                orgId: this.orgId
            }
        )

        const storageContext = resolveStorageContext(
            {
                chatflowid: this.chatflowid,
                orgId: this.orgId
            },
            options
        )
        const referenceFrame = await resolveReferenceFramePayload(input.referenceImages, storageContext)

        const createTaskResponse = await secureAxiosRequest({
            method: 'POST',
            url: `${this.baseUrl}/contents/generations/tasks`,
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.apiKey}`
            },
            data: buildDoubaoVideoRequestPayload(effectiveArgs, referenceFrame),
            responseType: 'json'
        })

        const taskCreation = normalizeTaskCreationResponse(createTaskResponse)
        const taskId = typeof taskCreation.id === 'string' ? taskCreation.id.trim() : ''
        if (!taskId) {
            throw new Error('Doubao Ark video generation returned no task id')
        }

        const deadline = Date.now() + this.timeoutMs
        let taskResponse: IDoubaoArkVideoTaskStatusResponse | undefined

        while (Date.now() <= deadline) {
            const taskStatusResponse = await secureAxiosRequest({
                method: 'GET',
                url: `${this.baseUrl}/contents/generations/tasks/${encodeURIComponent(taskId)}`,
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${this.apiKey}`
                },
                responseType: 'json'
            })

            taskResponse = normalizeTaskStatusResponse(taskStatusResponse)
            const normalizedStatus = taskResponse.status?.trim().toLowerCase()

            if (normalizedStatus === 'succeeded') {
                break
            }

            if (normalizedStatus && FAILED_TASK_STATUSES.has(normalizedStatus)) {
                throw new Error(getTaskFailureMessage(taskResponse))
            }

            await wait(this.pollIntervalMs)
        }

        if (!taskResponse || taskResponse.status?.trim().toLowerCase() !== 'succeeded') {
            throw new Error(`Doubao Ark video generation timed out after ${Math.round(this.timeoutMs / 1000)} seconds`)
        }

        const videoUrl = taskResponse.content?.video_url?.trim()
        if (!videoUrl) {
            throw new Error('Doubao Ark video generation succeeded but no video URL was returned')
        }

        const artifacts: IMediaArtifact[] = []
        const videos: IMediaVideoSummary[] = []

        if (hasStorageContext(storageContext)) {
            const downloadResponse: any = await secureFetch(videoUrl, { method: 'GET' })
            if (!downloadResponse.ok) {
                throw new Error(`Video download failed with status ${downloadResponse.status}`)
            }

            const contentType = downloadResponse.headers?.get?.('content-type') || undefined
            const artifactType = getVideoArtifactType(contentType, videoUrl)
            const fileName = `doubao_generated_video_${Date.now()}.${artifactType}`
            const arrayBuffer = await downloadResponse.arrayBuffer()
            const videoBuffer = Buffer.from(arrayBuffer)

            const { path } = await addSingleFileToStorage(
                getMimeTypeForVideoArtifact(artifactType),
                videoBuffer,
                fileName,
                storageContext.orgId,
                storageContext.chatflowid,
                storageContext.chatId
            )

            artifacts.push({
                type: artifactType,
                data: path
            })
            videos.push({
                fileName,
                resolution: taskResponse.resolution || effectiveArgs.resolution,
                ratio: taskResponse.ratio || effectiveArgs.ratio,
                duration: taskResponse.duration ?? effectiveArgs.duration
            })
        } else {
            const artifactType = getVideoArtifactType(undefined, videoUrl)
            artifacts.push({
                type: artifactType,
                data: videoUrl
            })
            videos.push({
                url: videoUrl,
                resolution: taskResponse.resolution || effectiveArgs.resolution,
                ratio: taskResponse.ratio || effectiveArgs.ratio,
                duration: taskResponse.duration ?? effectiveArgs.duration
            })
        }

        const metadata = getSummaryPayload(taskResponse, effectiveArgs, videos)

        return {
            text: buildGenerationText(metadata),
            artifacts,
            input: effectiveArgs,
            metadata,
            mediaBilling: getMediaBillingPayload(this.credentialId, taskResponse, effectiveArgs)
        }
    }
}
