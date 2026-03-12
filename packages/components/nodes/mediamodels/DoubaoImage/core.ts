import { AxiosResponse } from 'axios'
import { ICommonObject, IFileUpload } from '../../../src/Interface'
import {
    BaseMediaModel,
    IMediaArtifact,
    IMediaGenerationInput,
    IMediaGenerationMetadata,
    IMediaGenerationResult,
    IMediaImageSummary
} from '../../../src/mediaModels'
import { secureAxiosRequest, secureFetch } from '../../../src/httpSecurity'
import { addSingleFileToStorage, getFileFromStorage } from '../../../src/storageUtils'
import { parseJsonBody } from '../../../src/utils'

export const DEFAULT_DOUBAO_ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'
export const DEFAULT_DOUBAO_IMAGE_MODEL = 'doubao-seedream-5-0-260128'
export const DEFAULT_DOUBAO_IMAGE_SIZE = '2048x2048'
export const DEFAULT_DOUBAO_IMAGE_OUTPUT_FORMAT = 'png'
export const DEFAULT_DOUBAO_IMAGE_WATERMARK = false
export const DEFAULT_DOUBAO_IMAGE_SEQUENTIAL_IMAGE_GENERATION = 'disabled'
export const DEFAULT_DOUBAO_IMAGE_SEQUENTIAL_IMAGE_GENERATION_MAX_IMAGES = 15
export const MIN_DOUBAO_IMAGE_SEQUENTIAL_IMAGE_GENERATION_MAX_IMAGES = 1
export const MAX_DOUBAO_IMAGE_SEQUENTIAL_IMAGE_GENERATION_MAX_IMAGES = 15
export const DOUBAO_IMAGE_PROVIDER = 'doubao-ark'
const MAX_DOUBAO_IMAGE_REQUEST_ATTEMPTS = 3
const RETRYABLE_DOUBAO_IMAGE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504])
export const DOUBAO_IMAGE_SIZE_OPTIONS = [
    { label: '2K (1:1)', name: '2048x2048' },
    { label: '2K (4:3)', name: '2304x1728' },
    { label: '2K (3:4)', name: '1728x2304' },
    { label: '2K (16:9)', name: '2848x1600' },
    { label: '2K (9:16)', name: '1600x2848' },
    { label: '2K (3:2)', name: '2496x1664' },
    { label: '2K (2:3)', name: '1664x2496' },
    { label: '2K (21:9)', name: '3136x1344' },
    { label: '3K (1:1)', name: '3072x3072' },
    { label: '3K (4:3)', name: '3456x2592' },
    { label: '3K (3:4)', name: '2592x3456' },
    { label: '3K (16:9)', name: '4096x2304' },
    { label: '3K (9:16)', name: '2304x4096' },
    { label: '3K (3:2)', name: '2496x3744' },
    { label: '3K (2:3)', name: '3744x2496' },
    { label: '3K (21:9)', name: '4704x2016' }
]

export interface IDoubaoImageGenerationSchema {
    prompt: string
    size?: string
    outputFormat?: 'png' | 'jpeg' | 'jpg'
    watermark?: boolean
    sequentialImageGeneration?: 'disabled' | 'auto'
    sequentialImageGenerationMaxImages?: number
}

export interface IDoubaoImageGenerationConfig {
    apiKey: string
    credentialId?: string
    baseUrl?: string
    model?: string
    size?: string
    outputFormat?: string
    watermark?: boolean
    sequentialImageGeneration?: string
    sequentialImageGenerationMaxImages?: number
    chatflowid?: string
    orgId?: string
}

export interface IDoubaoImageGenerationArgs {
    prompt: string
    model: string
    size: string
    outputFormat: 'png' | 'jpeg'
    watermark: boolean
    sequentialImageGeneration: 'disabled' | 'auto'
    sequentialImageGenerationMaxImages?: number
}

interface IDoubaoArkImageRequest {
    model: string
    prompt: string
    size: string
    output_format: 'png' | 'jpeg'
    watermark: boolean
    image?: string | string[]
    sequential_image_generation?: 'disabled' | 'auto'
    sequential_image_generation_options?: {
        max_images?: number
    }
}

interface IDoubaoArkImageResponseItem {
    url?: string
    size?: string
}

interface IDoubaoArkImageResponse {
    model?: string
    created?: number
    data?: IDoubaoArkImageResponseItem[]
    usage?: Record<string, unknown>
}

interface IStorageContext {
    chatflowid?: string
    orgId?: string
    chatId?: string
}

interface IResolvedReferenceImage {
    primary: string
    fallback?: string
}

interface IResolvedReferenceImages {
    primaryList: string[]
}

export const normalizeDoubaoBaseUrl = (baseUrl?: string): string => {
    const normalizedBaseUrl = baseUrl?.trim() || DEFAULT_DOUBAO_ARK_BASE_URL
    return normalizedBaseUrl.replace(/\/+$/, '')
}

export const normalizeDoubaoOutputFormat = (outputFormat?: string): 'png' | 'jpeg' => {
    if (!outputFormat) return DEFAULT_DOUBAO_IMAGE_OUTPUT_FORMAT

    const normalized = outputFormat.trim().toLowerCase()
    if (normalized === 'png') return 'png'
    if (normalized === 'jpeg' || normalized === 'jpg') return 'jpeg'

    throw new Error(`Unsupported output format: ${outputFormat}. Only png and jpeg are supported.`)
}

export const normalizeDoubaoSequentialImageGeneration = (value?: string): 'disabled' | 'auto' => {
    if (!value?.trim()) return DEFAULT_DOUBAO_IMAGE_SEQUENTIAL_IMAGE_GENERATION as 'disabled'

    const normalizedValue = value.trim().toLowerCase()
    if (normalizedValue === 'disabled' || normalizedValue === 'auto') {
        return normalizedValue
    }

    throw new Error(`Unsupported sequential image generation mode: ${value}. Only disabled and auto are supported.`)
}

export const normalizeDoubaoSequentialImageGenerationMaxImages = (value?: number): number | undefined => {
    if (value === undefined || value === null || Number.isNaN(value)) {
        return undefined
    }

    const normalizedValue = Math.floor(value)
    if (normalizedValue < MIN_DOUBAO_IMAGE_SEQUENTIAL_IMAGE_GENERATION_MAX_IMAGES) {
        return MIN_DOUBAO_IMAGE_SEQUENTIAL_IMAGE_GENERATION_MAX_IMAGES
    }
    if (normalizedValue > MAX_DOUBAO_IMAGE_SEQUENTIAL_IMAGE_GENERATION_MAX_IMAGES) {
        return MAX_DOUBAO_IMAGE_SEQUENTIAL_IMAGE_GENERATION_MAX_IMAGES
    }

    return normalizedValue
}

const ENGLISH_IMAGE_COUNT_WORDS: Record<string, number> = {
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15
}

const CHINESE_IMAGE_COUNT_WORDS: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
    十一: 11,
    十二: 12,
    十三: 13,
    十四: 14,
    十五: 15
}

const normalizeRequestedImageCount = (value?: number): number | undefined => {
    const normalized = normalizeDoubaoSequentialImageGenerationMaxImages(value)
    if (typeof normalized !== 'number' || normalized < 2) {
        return undefined
    }

    return normalized
}

const inferSequentialImageCountFromPrompt = (prompt: string): number | undefined => {
    const trimmedPrompt = prompt.trim()
    if (!trimmedPrompt) return undefined
    if (!/(生成|创建|制作|输出|给我|帮我|画|draw|generate|create|make|produce|render)/i.test(trimmedPrompt)) {
        return undefined
    }

    const arabicCountMatch = trimmedPrompt.match(/(\d{1,2})\s*(?:张|幅|images?|pictures?|pics?)/i)
    if (arabicCountMatch?.[1]) {
        return normalizeRequestedImageCount(Number(arabicCountMatch[1]))
    }

    const englishCountMatch = trimmedPrompt.match(
        /\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen)\b\s*(?:images?|pictures?|pics?)\b/i
    )
    if (englishCountMatch?.[1]) {
        return normalizeRequestedImageCount(ENGLISH_IMAGE_COUNT_WORDS[englishCountMatch[1].toLowerCase()])
    }

    const chineseCountMatch = trimmedPrompt.match(/(十[一二三四五]?|[一二两三四五六七八九十])\s*(?:张|幅)/)
    if (chineseCountMatch?.[1]) {
        return normalizeRequestedImageCount(CHINESE_IMAGE_COUNT_WORDS[chineseCountMatch[1]])
    }

    return undefined
}

const LEGACY_DOUBAO_IMAGE_SIZE_MAP: Record<string, string> = {
    '1k': '1024x1024',
    '2k': '2048x2048',
    '3k': '3072x3072'
}

const DOUBAO_IMAGE_SIZE_ALIAS_MAP: Record<string, string> = {
    wide: '2848x1600',
    landscape: '2848x1600',
    horizontal: '2848x1600',
    tall: '1600x2848',
    portrait: '1600x2848',
    vertical: '1600x2848',
    square: '2048x2048'
}

export const normalizeDoubaoImageSize = (size?: string): string | undefined => {
    if (!size) return undefined

    const trimmedSize = size.trim()
    if (!trimmedSize) return undefined

    const normalizedSize = trimmedSize.toLowerCase()
    const matchedOption = DOUBAO_IMAGE_SIZE_OPTIONS.find(
        (option) => option.name.toLowerCase() === normalizedSize || option.label.toLowerCase() === normalizedSize
    )
    if (matchedOption) return matchedOption.name

    if (LEGACY_DOUBAO_IMAGE_SIZE_MAP[normalizedSize]) {
        return LEGACY_DOUBAO_IMAGE_SIZE_MAP[normalizedSize]
    }

    if (DOUBAO_IMAGE_SIZE_ALIAS_MAP[normalizedSize]) {
        return DOUBAO_IMAGE_SIZE_ALIAS_MAP[normalizedSize]
    }

    if (/^\d+\s*x\s*\d+$/i.test(trimmedSize)) {
        return trimmedSize.replace(/\s+/g, '')
    }

    return trimmedSize
}

export const resolveDoubaoImageGenerationArgs = (
    input: IDoubaoImageGenerationSchema,
    config: Partial<IDoubaoImageGenerationConfig>
): IDoubaoImageGenerationArgs => {
    const prompt = input.prompt?.trim()
    if (!prompt) {
        throw new Error('Prompt is required')
    }

    const hasRuntimeSequentialImageGeneration =
        typeof input.sequentialImageGeneration === 'string' && input.sequentialImageGeneration.trim().length > 0
    const runtimeSequentialImageGenerationMaxImages = normalizeDoubaoSequentialImageGenerationMaxImages(
        typeof input.sequentialImageGenerationMaxImages === 'number'
            ? input.sequentialImageGenerationMaxImages
            : input.sequentialImageGenerationMaxImages !== undefined && input.sequentialImageGenerationMaxImages !== null
            ? Number(input.sequentialImageGenerationMaxImages)
            : undefined
    )
    const hasRuntimeSequentialImageGenerationMaxImages = typeof runtimeSequentialImageGenerationMaxImages === 'number'

    let sequentialImageGeneration = normalizeDoubaoSequentialImageGeneration(
        hasRuntimeSequentialImageGeneration ? input.sequentialImageGeneration : config.sequentialImageGeneration
    )
    let sequentialImageGenerationMaxImages =
        (hasRuntimeSequentialImageGenerationMaxImages
            ? runtimeSequentialImageGenerationMaxImages
            : normalizeDoubaoSequentialImageGenerationMaxImages(config.sequentialImageGenerationMaxImages)) ??
        DEFAULT_DOUBAO_IMAGE_SEQUENTIAL_IMAGE_GENERATION_MAX_IMAGES

    if (!hasRuntimeSequentialImageGeneration && sequentialImageGeneration === 'disabled') {
        if (hasRuntimeSequentialImageGenerationMaxImages && sequentialImageGenerationMaxImages > 1) {
            sequentialImageGeneration = 'auto'
        } else {
            const inferredSequentialImageCount = inferSequentialImageCountFromPrompt(prompt)
            if (inferredSequentialImageCount) {
                sequentialImageGeneration = 'auto'
                if (!hasRuntimeSequentialImageGenerationMaxImages) {
                    sequentialImageGenerationMaxImages = inferredSequentialImageCount
                }
            }
        }
    }

    return {
        prompt,
        model: config.model?.trim() || DEFAULT_DOUBAO_IMAGE_MODEL,
        size: normalizeDoubaoImageSize(input.size) || normalizeDoubaoImageSize(config.size) || DEFAULT_DOUBAO_IMAGE_SIZE,
        outputFormat: normalizeDoubaoOutputFormat(input.outputFormat || config.outputFormat),
        watermark: typeof input.watermark === 'boolean' ? input.watermark : config.watermark ?? DEFAULT_DOUBAO_IMAGE_WATERMARK,
        sequentialImageGeneration,
        ...(sequentialImageGeneration === 'auto' ? { sequentialImageGenerationMaxImages } : {})
    }
}

const getSafeDoubaoErrorMessage = (error: any): string => {
    const responseData = parseMaybeJson(error?.response?.data ?? error?.data)
    const responseDataRecord = responseData && typeof responseData === 'object' ? (responseData as Record<string, any>) : undefined
    const responseDataString =
        typeof responseData === 'string'
            ? responseData.trim()
            : typeof error?.response?.data === 'string'
            ? error.response.data.trim()
            : typeof error?.data === 'string'
            ? error.data.trim()
            : undefined
    const candidates = [
        responseDataString,
        responseDataRecord?.message,
        responseDataRecord?.error?.message,
        responseDataRecord?.error,
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

const normalizeDoubaoImageResponse = (response: AxiosResponse): IDoubaoArkImageResponse => {
    if (response.status < 200 || response.status >= 300) {
        throw new Error(getSafeDoubaoErrorMessage({ response }))
    }

    const queue: unknown[] = [parseMaybeJson(response.data)]
    const visited = new Set<unknown>()

    while (queue.length > 0) {
        const candidate = queue.shift()
        if (!candidate || visited.has(candidate)) continue
        visited.add(candidate)

        if (Array.isArray(candidate)) {
            return {
                data: candidate as IDoubaoArkImageResponseItem[]
            }
        }

        if (typeof candidate !== 'object') continue

        const record = candidate as Record<string, unknown>
        if (Array.isArray(record.data)) {
            return record as IDoubaoArkImageResponse
        }

        const nestedData = parseMaybeJson(record.data)
        if (nestedData && typeof nestedData === 'object') {
            queue.push(nestedData)
        }
    }

    const errorMessage = getSafeDoubaoErrorMessage({ response })
    if (errorMessage !== 'Doubao Ark request failed') {
        throw new Error(errorMessage)
    }

    throw new Error('Doubao Ark image generation returned no images')
}

const getMimeTypeForFormat = (outputFormat: 'png' | 'jpeg'): string => {
    return outputFormat === 'png' ? 'image/png' : 'image/jpeg'
}

const getOutputFormatFromContentType = (contentType?: string, resourceUrl?: string, fallback?: string): 'png' | 'jpeg' => {
    const normalizedContentType = contentType?.split(';')[0]?.trim().toLowerCase()

    if (normalizedContentType === 'image/png') return 'png'
    if (normalizedContentType === 'image/jpeg' || normalizedContentType === 'image/jpg') return 'jpeg'

    const normalizedResourceUrl = resourceUrl?.split('?')[0]?.trim().toLowerCase()
    if (normalizedResourceUrl?.endsWith('.png')) return 'png'
    if (normalizedResourceUrl?.endsWith('.jpeg') || normalizedResourceUrl?.endsWith('.jpg')) return 'jpeg'

    return normalizeDoubaoOutputFormat(fallback)
}

const getSummaryPayload = (
    response: IDoubaoArkImageResponse,
    effectiveArgs: IDoubaoImageGenerationArgs,
    images: IMediaImageSummary[],
    partialFailureCount: number
): IMediaGenerationMetadata => {
    return {
        provider: DOUBAO_IMAGE_PROVIDER,
        model: response.model || effectiveArgs.model,
        prompt: effectiveArgs.prompt,
        source: 'media_generation',
        mediaType: 'image',
        imageCount: images.length,
        images,
        usage: response.usage ?? null,
        created: response.created ?? null,
        ...(partialFailureCount > 0 ? { partialFailureCount } : {})
    }
}

const hasStorageContext = (storageContext: IStorageContext): storageContext is Required<IStorageContext> => {
    return Boolean(storageContext.chatflowid && storageContext.orgId && storageContext.chatId)
}

const buildGenerationText = (metadata: IMediaGenerationMetadata): string => {
    const imageCount = metadata.imageCount ?? 0
    const imageLabel = `${imageCount} image${imageCount === 1 ? '' : 's'}`
    const partialFailureCount = metadata.partialFailureCount ?? 0
    const partialFailureSummary =
        partialFailureCount > 0
            ? ` ${partialFailureCount} additional image${partialFailureCount === 1 ? '' : 's'} could not be processed.`
            : ''

    return `Generated ${imageLabel} with ${metadata.provider}.${partialFailureSummary}`.trim()
}

const normalizeReferenceImageUrl = (value: string): string => {
    const normalizedValue = value.trim()
    if (!normalizedValue) {
        throw new Error('Doubao image-to-image reference image URL is missing')
    }

    if (normalizedValue.startsWith('data:image/')) {
        return normalizedValue
    }

    const uriListEntry = normalizedValue
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line && !line.startsWith('#'))

    if (!uriListEntry) {
        throw new Error('Doubao image-to-image reference image URL is missing')
    }

    let parsedUrl: URL
    try {
        parsedUrl = new URL(uriListEntry)
    } catch {
        throw new Error('Doubao image-to-image reference image URL must be a valid absolute http(s) URL')
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        throw new Error('Doubao image-to-image reference image URL must use http or https')
    }

    return parsedUrl.toString()
}

const resolveStorageContext = (config: IDoubaoImageGenerationConfig, options?: ICommonObject): IStorageContext => {
    const chatflowid = typeof options?.chatflowid === 'string' ? options.chatflowid : config.chatflowid
    const orgId = typeof options?.orgId === 'string' ? options.orgId : config.orgId
    const chatId = typeof options?.chatId === 'string' ? options.chatId : undefined

    return {
        chatflowid,
        orgId,
        chatId
    }
}

const resolveSingleReferenceImagePayload = async (
    referenceImage: IFileUpload,
    storageContext: IStorageContext
): Promise<IResolvedReferenceImage> => {
    if (referenceImage.type === 'stored-file') {
        if (!hasStorageContext(storageContext)) {
            throw new Error('Doubao image-to-image requires chat storage context for uploaded reference images')
        }

        const fileName = referenceImage.name.replace(/^FILE-STORAGE::/, '').trim()
        if (!fileName) {
            throw new Error('Doubao image-to-image reference image file name is missing')
        }

        const fileBuffer = await getFileFromStorage(fileName, storageContext.orgId, storageContext.chatflowid, storageContext.chatId)
        const base64Payload = fileBuffer.toString('base64')
        const mimeType = referenceImage.mime?.trim() || 'image/png'
        return {
            primary: `data:${mimeType};base64,${base64Payload}`,
            fallback: base64Payload
        }
    }

    if (referenceImage.type === 'url') {
        return { primary: normalizeReferenceImageUrl(referenceImage.data || '') }
    }

    const rawData = referenceImage.data?.trim()
    if (!rawData) {
        throw new Error(`Doubao image-to-image does not support reference image type: ${referenceImage.type}`)
    }

    if (rawData.startsWith('data:image/')) {
        const [, fallback] = rawData.split(',', 2)
        return {
            primary: rawData,
            ...(fallback ? { fallback } : {})
        }
    }

    const mimeType = referenceImage.mime?.trim()
    if (mimeType?.startsWith('image/')) {
        return {
            primary: `data:${mimeType};base64,${rawData}`,
            fallback: rawData
        }
    }

    return { primary: rawData }
}

const resolveMultipleReferenceImagesPayload = async (
    referenceImages: IFileUpload[],
    storageContext: IStorageContext
): Promise<IResolvedReferenceImages> => {
    if (referenceImages.length < 2) {
        throw new Error('Doubao multi-image generation requires at least two reference images')
    }

    const resolved: string[] = []
    for (const referenceImage of referenceImages) {
        const single = await resolveSingleReferenceImagePayload(referenceImage, storageContext)
        resolved.push(single.primary)
    }

    return { primaryList: resolved }
}

const resolveReferenceImagePayload = async (
    referenceImages: IFileUpload[] | undefined,
    storageContext: IStorageContext
): Promise<IResolvedReferenceImage | IResolvedReferenceImages | undefined> => {
    if (!referenceImages?.length) return undefined

    if (referenceImages.length === 1) {
        return await resolveSingleReferenceImagePayload(referenceImages[0], storageContext)
    }

    return await resolveMultipleReferenceImagesPayload(referenceImages, storageContext)
}

const buildDoubaoRequestPayload = (effectiveArgs: IDoubaoImageGenerationArgs, referenceImage?: string): IDoubaoArkImageRequest => {
    return {
        model: effectiveArgs.model,
        prompt: effectiveArgs.prompt,
        size: effectiveArgs.size,
        output_format: effectiveArgs.outputFormat,
        watermark: effectiveArgs.watermark,
        sequential_image_generation: effectiveArgs.sequentialImageGeneration,
        ...(effectiveArgs.sequentialImageGeneration === 'auto'
            ? {
                  sequential_image_generation_options: {
                      max_images: effectiveArgs.sequentialImageGenerationMaxImages
                  }
              }
            : {}),
        ...(referenceImage ? { image: referenceImage } : {})
    }
}

const buildDoubaoMultiImageRequestPayload = (
    effectiveArgs: IDoubaoImageGenerationArgs,
    referenceImages: string[]
): IDoubaoArkImageRequest => {
    return {
        model: effectiveArgs.model,
        prompt: effectiveArgs.prompt,
        size: effectiveArgs.size,
        output_format: effectiveArgs.outputFormat,
        watermark: effectiveArgs.watermark,
        image: referenceImages,
        sequential_image_generation: effectiveArgs.sequentialImageGeneration,
        ...(effectiveArgs.sequentialImageGeneration === 'auto'
            ? {
                  sequential_image_generation_options: {
                      max_images: effectiveArgs.sequentialImageGenerationMaxImages
                  }
              }
            : {})
    }
}

const shouldRetryDoubaoImageRequest = (response: AxiosResponse | undefined): boolean => {
    if (!response || typeof response.status !== 'number') return false

    return RETRYABLE_DOUBAO_IMAGE_STATUS_CODES.has(response.status)
}

const shouldRetryWithFallbackReferenceImage = (response: AxiosResponse | undefined, hasFallbackVariant: boolean): boolean => {
    return Boolean(hasFallbackVariant && response && typeof response.status === 'number' && response.status >= 500)
}

export class DoubaoImageModel extends BaseMediaModel {
    readonly provider = DOUBAO_IMAGE_PROVIDER
    readonly capabilities = {
        textToImage: true,
        imageToImage: true,
        multiTurnPrompting: true
    }

    readonly modelName: string

    private readonly apiKey: string
    private readonly baseUrl: string
    private readonly defaultSize: string
    private readonly defaultOutputFormat: 'png' | 'jpeg'
    private readonly defaultWatermark: boolean
    private readonly defaultSequentialImageGeneration: 'disabled' | 'auto'
    private readonly defaultSequentialImageGenerationMaxImages: number
    private readonly credentialId?: string
    private readonly chatflowid?: string
    private readonly orgId?: string

    constructor(config: IDoubaoImageGenerationConfig) {
        super()
        this.apiKey = config.apiKey
        this.credentialId = config.credentialId
        this.baseUrl = normalizeDoubaoBaseUrl(config.baseUrl)
        this.modelName = config.model?.trim() || DEFAULT_DOUBAO_IMAGE_MODEL
        this.defaultSize = config.size?.trim() || DEFAULT_DOUBAO_IMAGE_SIZE
        this.defaultOutputFormat = normalizeDoubaoOutputFormat(config.outputFormat)
        this.defaultWatermark = config.watermark ?? DEFAULT_DOUBAO_IMAGE_WATERMARK
        this.defaultSequentialImageGeneration = normalizeDoubaoSequentialImageGeneration(config.sequentialImageGeneration)
        this.defaultSequentialImageGenerationMaxImages =
            normalizeDoubaoSequentialImageGenerationMaxImages(config.sequentialImageGenerationMaxImages) ??
            DEFAULT_DOUBAO_IMAGE_SEQUENTIAL_IMAGE_GENERATION_MAX_IMAGES
        this.chatflowid = config.chatflowid
        this.orgId = config.orgId
    }

    async invoke(input: IMediaGenerationInput, options?: ICommonObject): Promise<IMediaGenerationResult> {
        if (!this.apiKey?.trim()) {
            throw new Error('Doubao Ark API key is required')
        }

        const storageContext = resolveStorageContext(
            {
                apiKey: this.apiKey,
                baseUrl: this.baseUrl,
                model: this.modelName,
                size: this.defaultSize,
                outputFormat: this.defaultOutputFormat,
                watermark: this.defaultWatermark,
                sequentialImageGeneration: this.defaultSequentialImageGeneration,
                sequentialImageGenerationMaxImages: this.defaultSequentialImageGenerationMaxImages,
                chatflowid: this.chatflowid,
                orgId: this.orgId
            },
            options
        )

        const effectiveArgs = resolveDoubaoImageGenerationArgs(input, {
            model: this.modelName,
            size: this.defaultSize,
            outputFormat: this.defaultOutputFormat,
            watermark: this.defaultWatermark,
            sequentialImageGeneration: this.defaultSequentialImageGeneration,
            sequentialImageGenerationMaxImages: this.defaultSequentialImageGenerationMaxImages
        })
        const resolvedReferenceImagePayload = await resolveReferenceImagePayload(input.referenceImages, storageContext)
        const payloads =
            resolvedReferenceImagePayload && 'primaryList' in resolvedReferenceImagePayload
                ? [buildDoubaoMultiImageRequestPayload(effectiveArgs, resolvedReferenceImagePayload.primaryList)]
                : resolvedReferenceImagePayload?.fallback
                ? [
                      buildDoubaoRequestPayload(effectiveArgs, resolvedReferenceImagePayload.primary),
                      buildDoubaoRequestPayload(effectiveArgs, resolvedReferenceImagePayload.fallback)
                  ]
                : [buildDoubaoRequestPayload(effectiveArgs, resolvedReferenceImagePayload?.primary)]

        let response: AxiosResponse<IDoubaoArkImageResponse> | undefined
        let lastError: unknown
        for (let index = 0; index < payloads.length; index += 1) {
            const payload = payloads[index]
            for (let attempt = 1; attempt <= MAX_DOUBAO_IMAGE_REQUEST_ATTEMPTS; attempt += 1) {
                response = undefined
                try {
                    response = await secureAxiosRequest({
                        method: 'POST',
                        url: `${this.baseUrl}/images/generations`,
                        headers: {
                            'Content-Type': 'application/json',
                            Authorization: `Bearer ${this.apiKey}`
                        },
                        data: payload,
                        responseType: 'json'
                    })

                    const hasFallbackVariant = index === 0 && payloads.length > 1
                    if (shouldRetryWithFallbackReferenceImage(response, hasFallbackVariant)) {
                        break
                    }

                    if (!shouldRetryDoubaoImageRequest(response) || attempt === MAX_DOUBAO_IMAGE_REQUEST_ATTEMPTS) {
                        break
                    }
                } catch (error) {
                    lastError = error
                    response = undefined
                    if (attempt === MAX_DOUBAO_IMAGE_REQUEST_ATTEMPTS) {
                        if (index === payloads.length - 1) {
                            throw new Error(getSafeDoubaoErrorMessage(error))
                        }
                        break
                    }

                    continue
                }

                lastError = response

                if (response && response.status >= 200 && response.status < 300) {
                    break
                }
            }

            const hasFallbackVariant = index === 0 && payloads.length > 1
            const shouldContinueWithFallback = shouldRetryWithFallbackReferenceImage(response, hasFallbackVariant)
            if (!shouldContinueWithFallback) {
                break
            }
        }

        if (!response) {
            throw new Error(getSafeDoubaoErrorMessage(lastError))
        }

        if (response.status < 200 || response.status >= 300) {
            throw new Error(getSafeDoubaoErrorMessage({ response }))
        }

        const responseData = normalizeDoubaoImageResponse(response)
        if (!responseData?.data || !Array.isArray(responseData.data) || responseData.data.length === 0) {
            throw new Error('Doubao Ark image generation returned no images')
        }

        const artifacts: IMediaArtifact[] = []
        const images: IMediaImageSummary[] = []
        let partialFailureCount = 0

        for (let index = 0; index < responseData.data.length; index += 1) {
            const image = responseData.data[index]
            if (!image?.url) {
                partialFailureCount += 1
                continue
            }

            try {
                if (hasStorageContext(storageContext)) {
                    const downloadResponse: any = await secureFetch(image.url, { method: 'GET' })
                    if (!downloadResponse.ok) {
                        throw new Error(`Image download failed with status ${downloadResponse.status}`)
                    }

                    const contentType = downloadResponse.headers?.get?.('content-type') || undefined
                    const artifactType = getOutputFormatFromContentType(contentType, image.url, effectiveArgs.outputFormat)
                    const fileName = `doubao_generated_image_${Date.now()}_${index + 1}.${artifactType}`
                    const arrayBuffer = await downloadResponse.arrayBuffer()
                    const imageBuffer = Buffer.from(arrayBuffer)

                    const { path } = await addSingleFileToStorage(
                        getMimeTypeForFormat(artifactType),
                        imageBuffer,
                        fileName,
                        storageContext.orgId,
                        storageContext.chatflowid,
                        storageContext.chatId
                    )

                    artifacts.push({
                        type: artifactType,
                        data: path
                    })

                    images.push({
                        fileName,
                        size: image.size
                    })
                } else {
                    artifacts.push({
                        type: effectiveArgs.outputFormat,
                        data: image.url
                    })

                    images.push({
                        url: image.url,
                        size: image.size
                    })
                }
            } catch (error) {
                partialFailureCount += 1
            }
        }

        if (artifacts.length === 0) {
            if (hasStorageContext(storageContext)) {
                throw new Error('Doubao Ark image generation succeeded but no images could be stored')
            }

            throw new Error('Doubao Ark image generation succeeded but no images could be processed')
        }

        const metadata = getSummaryPayload(responseData, effectiveArgs, images, partialFailureCount)
        const generatedImages = Number(responseData.usage?.generated_images)
        const normalizedGeneratedImages = Number.isFinite(generatedImages) && generatedImages >= 0 ? generatedImages : artifacts.length

        return {
            text: buildGenerationText(metadata),
            artifacts,
            input: effectiveArgs,
            metadata,
            mediaBilling: {
                provider: DOUBAO_IMAGE_PROVIDER,
                credentialId: this.credentialId,
                model: metadata.model,
                source: 'media_generation',
                billingMode: 'image_count',
                usage: {
                    units: normalizedGeneratedImages
                }
            }
        }
    }
}
