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
import { mapMimeTypeToExt, parseJsonBody } from '../../../src/utils'

export const DEFAULT_ALIBABA_IMAGE_BASE_URL = 'https://dashscope.aliyuncs.com/api/v1'
export const DEFAULT_ALIBABA_IMAGE_MODEL = 'qwen-image-2.0-pro'
export const DEFAULT_ALIBABA_IMAGE_COUNT = 1
export const DEFAULT_ALIBABA_IMAGE_PROMPT_EXTEND = true
export const DEFAULT_ALIBABA_IMAGE_WATERMARK = false
export const MIN_ALIBABA_IMAGE_COUNT = 1
export const MAX_ALIBABA_IMAGE_COUNT = 6
export const MAX_ALIBABA_REFERENCE_IMAGES = 3
export const MAX_ALIBABA_IMAGE_SEED = 2147483647
export const MIN_ALIBABA_IMAGE_PIXEL_COUNT = 512 * 512
export const MAX_ALIBABA_IMAGE_PIXEL_COUNT = 2048 * 2048
export const ALIBABA_IMAGE_PROVIDER = 'alibaba-dashscope'
export const ALIBABA_IMAGE_SIZE_OPTIONS = [
    { label: '16:9 (2688*1536)', name: '2688*1536' },
    { label: '9:16 (1536*2688)', name: '1536*2688' },
    { label: '1:1 (2048*2048)', name: '2048*2048' },
    { label: '4:3 (2368*1728)', name: '2368*1728' },
    { label: '3:4 (1728*2368)', name: '1728*2368' }
]

const IMAGE_ARTIFACT_TYPES = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff', 'avif'])

export interface IAlibabaImageGenerationSchema {
    prompt: string
    size?: string
    imageCount?: number
    negativePrompt?: string
    promptExtend?: boolean
    watermark?: boolean
    seed?: number
}

export interface IAlibabaImageGenerationConfig {
    apiKey: string
    credentialId?: string
    baseUrl?: string
    model?: string
    size?: string
    imageCount?: number
    negativePrompt?: string
    promptExtend?: boolean
    watermark?: boolean
    seed?: number
    chatflowid?: string
    orgId?: string
}

export interface IAlibabaImageGenerationArgs {
    prompt: string
    model: string
    size?: string
    imageCount: number
    negativePrompt?: string
    promptExtend: boolean
    watermark: boolean
    seed?: number
}

interface IAlibabaImageMessageTextContent {
    text: string
}

interface IAlibabaImageMessageImageContent {
    image: string
}

type IAlibabaImageMessageContent = IAlibabaImageMessageTextContent | IAlibabaImageMessageImageContent

interface IAlibabaImageRequest {
    model: string
    input: {
        messages: [
            {
                role: 'user'
                content: IAlibabaImageMessageContent[]
            }
        ]
    }
    parameters: {
        n: number
        prompt_extend: boolean
        watermark: boolean
        negative_prompt?: string
        size?: string
        seed?: number
    }
}

interface IAlibabaImageResponseChoice {
    finish_reason?: string
    message?: {
        role?: string
        content?: Array<{
            image?: string
        }>
    }
}

interface IAlibabaImageResponse {
    output?: {
        choices?: IAlibabaImageResponseChoice[]
    }
    usage?: Record<string, unknown>
    request_id?: string
    code?: string
    message?: string
}

interface IStorageContext {
    chatflowid?: string
    orgId?: string
    chatId?: string
}

const trimOptionalString = (value?: string): string | undefined => {
    const trimmedValue = value?.trim()
    return trimmedValue ? trimmedValue : undefined
}

const normalizeOptionalBoolean = (value: unknown, defaultValue: boolean): boolean => {
    if (typeof value === 'boolean') return value
    if (typeof value === 'string') {
        const normalizedValue = value.trim().toLowerCase()
        if (normalizedValue === 'true') return true
        if (normalizedValue === 'false') return false
    }
    return defaultValue
}

const parseOptionalInteger = (value: unknown, fieldName: string): number | undefined => {
    if (value === undefined || value === null || value === '') return undefined

    const numericValue = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(numericValue)) {
        throw new Error(`${fieldName} must be a valid number`)
    }

    return Math.trunc(numericValue)
}

export const normalizeAlibabaBaseUrl = (baseUrl?: string): string => {
    const normalizedBaseUrl = baseUrl?.trim() || DEFAULT_ALIBABA_IMAGE_BASE_URL
    return normalizedBaseUrl.replace(/\/+$/, '')
}

export const normalizeAlibabaImageSize = (size?: string): string | undefined => {
    if (!size?.trim()) return undefined

    const matchedDimensions = size.trim().match(/^(\d+)\s*(?:x|\*)\s*(\d+)$/i)
    if (!matchedDimensions) {
        throw new Error(`Unsupported Alibaba image size: ${size}. Use "width*height" or "widthxheight".`)
    }

    const width = Number(matchedDimensions[1])
    const height = Number(matchedDimensions[2])
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        throw new Error(`Unsupported Alibaba image size: ${size}. Width and height must be positive integers.`)
    }

    if (width % 16 !== 0 || height % 16 !== 0) {
        throw new Error(`Unsupported Alibaba image size: ${size}. Width and height must be multiples of 16.`)
    }

    const totalPixels = width * height
    if (totalPixels < MIN_ALIBABA_IMAGE_PIXEL_COUNT || totalPixels > MAX_ALIBABA_IMAGE_PIXEL_COUNT) {
        throw new Error(
            `Unsupported Alibaba image size: ${size}. Total pixels must be between ${MIN_ALIBABA_IMAGE_PIXEL_COUNT} and ${MAX_ALIBABA_IMAGE_PIXEL_COUNT}.`
        )
    }

    return `${width}*${height}`
}

export const normalizeAlibabaImageCount = (value?: number): number => {
    const normalizedValue = parseOptionalInteger(value, 'Image count')
    if (normalizedValue === undefined) {
        return DEFAULT_ALIBABA_IMAGE_COUNT
    }

    if (normalizedValue < MIN_ALIBABA_IMAGE_COUNT || normalizedValue > MAX_ALIBABA_IMAGE_COUNT) {
        throw new Error(`Image count must be between ${MIN_ALIBABA_IMAGE_COUNT} and ${MAX_ALIBABA_IMAGE_COUNT}`)
    }

    return normalizedValue
}

export const normalizeAlibabaPromptExtend = (value?: boolean): boolean => {
    return normalizeOptionalBoolean(value, DEFAULT_ALIBABA_IMAGE_PROMPT_EXTEND)
}

export const normalizeAlibabaWatermark = (value?: boolean): boolean => {
    return normalizeOptionalBoolean(value, DEFAULT_ALIBABA_IMAGE_WATERMARK)
}

export const normalizeAlibabaSeed = (value?: number): number | undefined => {
    const normalizedValue = parseOptionalInteger(value, 'Seed')
    if (normalizedValue === undefined) {
        return undefined
    }

    if (normalizedValue < 0 || normalizedValue > MAX_ALIBABA_IMAGE_SEED) {
        throw new Error(`Seed must be between 0 and ${MAX_ALIBABA_IMAGE_SEED}`)
    }

    return normalizedValue
}

export const resolveAlibabaImageGenerationArgs = (
    input: IAlibabaImageGenerationSchema,
    config: Partial<IAlibabaImageGenerationConfig>
): IAlibabaImageGenerationArgs => {
    const prompt = input.prompt?.trim()
    if (!prompt) {
        throw new Error('Prompt is required')
    }

    const normalizedInputSize = trimOptionalString(input.size)
    const normalizedConfigSize = trimOptionalString(config.size)
    const normalizedInputNegativePrompt = trimOptionalString(input.negativePrompt)
    const normalizedConfigNegativePrompt = trimOptionalString(config.negativePrompt)

    return {
        prompt,
        model: config.model?.trim() || DEFAULT_ALIBABA_IMAGE_MODEL,
        size: normalizeAlibabaImageSize(normalizedInputSize || normalizedConfigSize),
        imageCount: normalizeAlibabaImageCount(input.imageCount ?? config.imageCount),
        negativePrompt: normalizedInputNegativePrompt ?? normalizedConfigNegativePrompt,
        promptExtend: normalizeAlibabaPromptExtend(typeof input.promptExtend === 'boolean' ? input.promptExtend : config.promptExtend),
        watermark: normalizeAlibabaWatermark(typeof input.watermark === 'boolean' ? input.watermark : config.watermark),
        seed: normalizeAlibabaSeed(input.seed ?? config.seed)
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

const getSafeAlibabaErrorMessage = (error: any): string => {
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

    const codeMessage =
        responseDataRecord?.code && responseDataRecord?.message ? `${responseDataRecord.code}: ${responseDataRecord.message}` : undefined

    const candidates = [
        responseDataString,
        codeMessage,
        responseDataRecord?.message,
        responseDataRecord?.error?.message,
        responseDataRecord?.error,
        responseDataRecord?.detail,
        error?.message
    ]

    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim()) {
            return candidate.trim()
        }
    }

    const status = error?.response?.status ?? error?.status
    if (status) {
        return `Alibaba DashScope request failed with status ${status}`
    }

    return 'Alibaba DashScope request failed'
}

const normalizeAlibabaImageResponse = (response: AxiosResponse): IAlibabaImageResponse => {
    if (response.status < 200 || response.status >= 300) {
        throw new Error(getSafeAlibabaErrorMessage({ response }))
    }

    const parsedResponse = parseMaybeJson(response.data)
    if (parsedResponse && typeof parsedResponse === 'object') {
        const record = parsedResponse as Record<string, unknown>
        if (record.output && typeof record.output === 'object') {
            return record as IAlibabaImageResponse
        }

        const nestedData = parseMaybeJson(record.data)
        if (nestedData && typeof nestedData === 'object' && (nestedData as Record<string, unknown>).output) {
            return nestedData as IAlibabaImageResponse
        }
    }

    const errorMessage = getSafeAlibabaErrorMessage({ response })
    if (errorMessage !== 'Alibaba DashScope request failed') {
        throw new Error(errorMessage)
    }

    throw new Error('Alibaba DashScope image generation returned no images')
}

const getArtifactTypeFromContent = (contentType?: string, resourceUrl?: string): string => {
    const normalizedContentType = contentType?.split(';')[0]?.trim().toLowerCase()
    const extensionFromMimeType = normalizedContentType ? mapMimeTypeToExt(normalizedContentType) : ''
    if (IMAGE_ARTIFACT_TYPES.has(extensionFromMimeType)) {
        return extensionFromMimeType === 'jpg' ? 'jpeg' : extensionFromMimeType
    }

    const normalizedResourceUrl = resourceUrl?.split('?')[0]?.trim().toLowerCase()
    const extensionMatch = normalizedResourceUrl?.match(/\.([a-z0-9]+)$/i)
    const extension = extensionMatch?.[1]
    if (extension && IMAGE_ARTIFACT_TYPES.has(extension)) {
        return extension === 'jpg' ? 'jpeg' : extension
    }

    return 'png'
}

const getMimeTypeForArtifactType = (artifactType: string): string => {
    switch (artifactType) {
        case 'jpeg':
        case 'jpg':
            return 'image/jpeg'
        case 'gif':
            return 'image/gif'
        case 'webp':
            return 'image/webp'
        case 'bmp':
            return 'image/bmp'
        case 'tiff':
            return 'image/tiff'
        case 'avif':
            return 'image/avif'
        case 'png':
        default:
            return 'image/png'
    }
}

const buildImageSizeFromUsage = (usage?: Record<string, unknown>): string | undefined => {
    const width = Number(usage?.width)
    const height = Number(usage?.height)
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return undefined
    }

    return `${width}*${height}`
}

const getSummaryPayload = (
    response: IAlibabaImageResponse,
    effectiveArgs: IAlibabaImageGenerationArgs,
    images: IMediaImageSummary[],
    partialFailureCount: number
): IMediaGenerationMetadata => ({
    provider: ALIBABA_IMAGE_PROVIDER,
    model: effectiveArgs.model,
    prompt: effectiveArgs.prompt,
    source: 'media_generation',
    mediaType: 'image',
    imageCount: images.length,
    images,
    usage: response.usage ?? null,
    ...(partialFailureCount > 0 ? { partialFailureCount } : {})
})

const buildGenerationText = (metadata: IMediaGenerationMetadata): string => {
    const imageCount = metadata.imageCount ?? 0
    const partialFailureCount = metadata.partialFailureCount ?? 0
    const partialFailureSummary =
        partialFailureCount > 0
            ? ` ${partialFailureCount} additional image${partialFailureCount === 1 ? '' : 's'} could not be processed.`
            : ''

    return `Generated ${imageCount} image${imageCount === 1 ? '' : 's'} with ${metadata.provider}.${partialFailureSummary}`.trim()
}

const hasStorageContext = (storageContext: IStorageContext): storageContext is Required<IStorageContext> => {
    return Boolean(storageContext.chatflowid && storageContext.orgId && storageContext.chatId)
}

const normalizeReferenceImageUrl = (value: string): string => {
    const normalizedValue = value.trim()
    if (!normalizedValue) {
        throw new Error('Alibaba image reference image URL is missing')
    }

    if (normalizedValue.startsWith('data:image/')) {
        return normalizedValue
    }

    let parsedUrl: URL
    try {
        parsedUrl = new URL(normalizedValue)
    } catch {
        throw new Error('Alibaba image reference image URL must be a valid absolute http(s) URL')
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        throw new Error('Alibaba image reference image URL must use http or https')
    }

    return parsedUrl.toString()
}

const resolveStorageContext = (config: IAlibabaImageGenerationConfig, options?: ICommonObject): IStorageContext => {
    const chatflowid = typeof options?.chatflowid === 'string' ? options.chatflowid : config.chatflowid
    const orgId = typeof options?.orgId === 'string' ? options.orgId : config.orgId
    const chatId = typeof options?.chatId === 'string' ? options.chatId : undefined

    return {
        chatflowid,
        orgId,
        chatId
    }
}

const resolveSingleReferenceImagePayload = async (referenceImage: IFileUpload, storageContext: IStorageContext): Promise<string> => {
    if (referenceImage.type === 'stored-file') {
        if (!hasStorageContext(storageContext)) {
            throw new Error('Alibaba image editing requires chat storage context for uploaded reference images')
        }

        const fileName = referenceImage.name.replace(/^FILE-STORAGE::/, '').trim()
        if (!fileName) {
            throw new Error('Alibaba image reference image file name is missing')
        }

        const fileBuffer = await getFileFromStorage(fileName, storageContext.orgId, storageContext.chatflowid, storageContext.chatId)
        const base64Payload = fileBuffer.toString('base64')
        const mimeType = referenceImage.mime?.trim() || 'image/png'
        return `data:${mimeType};base64,${base64Payload}`
    }

    if (referenceImage.type === 'url') {
        return normalizeReferenceImageUrl(referenceImage.data || '')
    }

    const rawData = referenceImage.data?.trim()
    if (!rawData) {
        throw new Error(`Alibaba image does not support reference image type: ${referenceImage.type}`)
    }

    if (rawData.startsWith('data:image/')) {
        return rawData
    }

    const mimeType = referenceImage.mime?.trim()
    if (mimeType?.startsWith('image/')) {
        return `data:${mimeType};base64,${rawData}`
    }

    return rawData
}

const resolveReferenceImagePayloads = async (
    referenceImages: IFileUpload[] | undefined,
    storageContext: IStorageContext
): Promise<string[]> => {
    if (!referenceImages?.length) return []

    if (referenceImages.length > MAX_ALIBABA_REFERENCE_IMAGES) {
        throw new Error(`Alibaba image editing supports up to ${MAX_ALIBABA_REFERENCE_IMAGES} reference images`)
    }

    const resolvedPayloads: string[] = []
    for (const referenceImage of referenceImages) {
        resolvedPayloads.push(await resolveSingleReferenceImagePayload(referenceImage, storageContext))
    }

    return resolvedPayloads
}

const buildAlibabaImageRequestPayload = (
    effectiveArgs: IAlibabaImageGenerationArgs,
    referenceImages: string[] = []
): IAlibabaImageRequest => {
    const content: IAlibabaImageMessageContent[] = [...referenceImages.map((image) => ({ image })), { text: effectiveArgs.prompt }]

    return {
        model: effectiveArgs.model,
        input: {
            messages: [
                {
                    role: 'user',
                    content
                }
            ]
        },
        parameters: {
            n: effectiveArgs.imageCount,
            prompt_extend: effectiveArgs.promptExtend,
            watermark: effectiveArgs.watermark,
            ...(effectiveArgs.negativePrompt ? { negative_prompt: effectiveArgs.negativePrompt } : {}),
            ...(effectiveArgs.size ? { size: effectiveArgs.size } : {}),
            ...(effectiveArgs.seed !== undefined ? { seed: effectiveArgs.seed } : {})
        }
    }
}

const extractImageUrlsFromResponse = (response: IAlibabaImageResponse): string[] => {
    const choices = Array.isArray(response.output?.choices) ? response.output?.choices : []

    return choices.flatMap((choice) => {
        const contents = Array.isArray(choice?.message?.content) ? choice.message.content : []
        return contents
            .map((content) => (typeof content?.image === 'string' ? content.image.trim() : ''))
            .filter((imageUrl): imageUrl is string => Boolean(imageUrl))
    })
}

export class AlibabaImageModel extends BaseMediaModel {
    readonly provider = ALIBABA_IMAGE_PROVIDER
    readonly capabilities = {
        textToImage: true,
        imageToImage: true
    }

    readonly modelName: string

    private readonly apiKey: string
    private readonly baseUrl: string
    private readonly defaultSize?: string
    private readonly defaultImageCount: number
    private readonly defaultNegativePrompt?: string
    private readonly defaultPromptExtend: boolean
    private readonly defaultWatermark: boolean
    private readonly defaultSeed?: number
    private readonly credentialId?: string
    private readonly chatflowid?: string
    private readonly orgId?: string

    constructor(config: IAlibabaImageGenerationConfig) {
        super()
        this.apiKey = config.apiKey
        this.credentialId = config.credentialId
        this.baseUrl = normalizeAlibabaBaseUrl(config.baseUrl)
        this.modelName = config.model?.trim() || DEFAULT_ALIBABA_IMAGE_MODEL
        this.defaultSize = normalizeAlibabaImageSize(config.size)
        this.defaultImageCount = normalizeAlibabaImageCount(config.imageCount)
        this.defaultNegativePrompt = trimOptionalString(config.negativePrompt)
        this.defaultPromptExtend = normalizeAlibabaPromptExtend(config.promptExtend)
        this.defaultWatermark = normalizeAlibabaWatermark(config.watermark)
        this.defaultSeed = normalizeAlibabaSeed(config.seed)
        this.chatflowid = config.chatflowid
        this.orgId = config.orgId
    }

    async invoke(input: IMediaGenerationInput, options?: ICommonObject): Promise<IMediaGenerationResult> {
        if (!this.apiKey?.trim()) {
            throw new Error('Alibaba DashScope API key is required')
        }

        const storageContext = resolveStorageContext(
            {
                apiKey: this.apiKey,
                baseUrl: this.baseUrl,
                model: this.modelName,
                size: this.defaultSize,
                imageCount: this.defaultImageCount,
                negativePrompt: this.defaultNegativePrompt,
                promptExtend: this.defaultPromptExtend,
                watermark: this.defaultWatermark,
                seed: this.defaultSeed,
                chatflowid: this.chatflowid,
                orgId: this.orgId
            },
            options
        )

        const effectiveArgs = resolveAlibabaImageGenerationArgs(input, {
            model: this.modelName,
            size: this.defaultSize,
            imageCount: this.defaultImageCount,
            negativePrompt: this.defaultNegativePrompt,
            promptExtend: this.defaultPromptExtend,
            watermark: this.defaultWatermark,
            seed: this.defaultSeed
        })
        const resolvedReferenceImages = await resolveReferenceImagePayloads(input.referenceImages, storageContext)

        const response = await secureAxiosRequest({
            method: 'POST',
            url: `${this.baseUrl}/services/aigc/multimodal-generation/generation`,
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.apiKey}`
            },
            data: buildAlibabaImageRequestPayload(effectiveArgs, resolvedReferenceImages),
            responseType: 'json'
        })

        if (response.status < 200 || response.status >= 300) {
            throw new Error(getSafeAlibabaErrorMessage({ response }))
        }

        const responseData = normalizeAlibabaImageResponse(response)
        const imageUrls = extractImageUrlsFromResponse(responseData)
        if (!imageUrls.length) {
            throw new Error('Alibaba DashScope image generation returned no images')
        }

        const artifacts: IMediaArtifact[] = []
        const images: IMediaImageSummary[] = []
        let partialFailureCount = 0
        const outputSize = buildImageSizeFromUsage(responseData.usage)

        for (let index = 0; index < imageUrls.length; index += 1) {
            const imageUrl = imageUrls[index]

            try {
                if (hasStorageContext(storageContext)) {
                    const downloadResponse: any = await secureFetch(imageUrl, { method: 'GET' })
                    if (!downloadResponse.ok) {
                        throw new Error(`Image download failed with status ${downloadResponse.status}`)
                    }

                    const contentType = downloadResponse.headers?.get?.('content-type') || undefined
                    const artifactType = getArtifactTypeFromContent(contentType, imageUrl)
                    const fileName = `alibaba_generated_image_${Date.now()}_${index + 1}.${artifactType}`
                    const arrayBuffer = await downloadResponse.arrayBuffer()
                    const imageBuffer = Buffer.from(arrayBuffer)

                    const { path } = await addSingleFileToStorage(
                        getMimeTypeForArtifactType(artifactType),
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
                        ...(outputSize ? { size: outputSize } : {})
                    })
                } else {
                    const artifactType = getArtifactTypeFromContent(undefined, imageUrl)
                    artifacts.push({
                        type: artifactType,
                        data: imageUrl
                    })

                    images.push({
                        url: imageUrl,
                        ...(outputSize ? { size: outputSize } : {})
                    })
                }
            } catch {
                partialFailureCount += 1
            }
        }

        if (!artifacts.length) {
            if (hasStorageContext(storageContext)) {
                throw new Error('Alibaba DashScope image generation succeeded but no images could be stored')
            }

            throw new Error('Alibaba DashScope image generation succeeded but no images could be processed')
        }

        const metadata = getSummaryPayload(responseData, effectiveArgs, images, partialFailureCount)
        const generatedImages = Number(responseData.usage?.image_count)
        const normalizedGeneratedImages = Number.isFinite(generatedImages) && generatedImages >= 0 ? generatedImages : artifacts.length

        return {
            text: buildGenerationText(metadata),
            artifacts,
            input: effectiveArgs,
            metadata,
            mediaBilling: {
                provider: ALIBABA_IMAGE_PROVIDER,
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
