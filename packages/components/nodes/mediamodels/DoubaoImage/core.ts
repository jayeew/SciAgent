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
export const DOUBAO_IMAGE_PROVIDER = 'doubao-ark'
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
}

export interface IDoubaoImageGenerationConfig {
    apiKey: string
    credentialId?: string
    baseUrl?: string
    model?: string
    size?: string
    outputFormat?: string
    watermark?: boolean
    inputRmbPerImage?: number
    chatflowid?: string
    orgId?: string
}

export interface IDoubaoImageGenerationArgs {
    prompt: string
    model: string
    size: string
    outputFormat: 'png' | 'jpeg'
    watermark: boolean
}

interface IDoubaoArkImageRequest {
    model: string
    prompt: string
    size: string
    output_format: 'png' | 'jpeg'
    watermark: boolean
    image?: string
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

const LEGACY_DOUBAO_IMAGE_SIZE_MAP: Record<string, string> = {
    '1k': '1024x1024',
    '2k': '2048x2048',
    '3k': '3072x3072'
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

    return {
        prompt,
        model: config.model?.trim() || DEFAULT_DOUBAO_IMAGE_MODEL,
        size: normalizeDoubaoImageSize(input.size) || normalizeDoubaoImageSize(config.size) || DEFAULT_DOUBAO_IMAGE_SIZE,
        outputFormat: normalizeDoubaoOutputFormat(input.outputFormat || config.outputFormat),
        watermark: typeof input.watermark === 'boolean' ? input.watermark : config.watermark ?? DEFAULT_DOUBAO_IMAGE_WATERMARK
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

const resolveReferenceImagePayload = async (
    referenceImages: IFileUpload[] | undefined,
    storageContext: IStorageContext
): Promise<IResolvedReferenceImage | undefined> => {
    if (!referenceImages?.length) return undefined

    if (referenceImages.length > 1) {
        throw new Error('Doubao image-to-image supports exactly one reference image')
    }

    const referenceImage = referenceImages[0]

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
        const resourceUrl = referenceImage.data?.trim()
        if (!resourceUrl) {
            throw new Error('Doubao image-to-image reference image URL is missing')
        }

        return { primary: resourceUrl }
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

const buildDoubaoRequestPayload = (effectiveArgs: IDoubaoImageGenerationArgs, referenceImage?: string): IDoubaoArkImageRequest => {
    return {
        model: effectiveArgs.model,
        prompt: effectiveArgs.prompt,
        size: effectiveArgs.size,
        output_format: effectiveArgs.outputFormat,
        watermark: effectiveArgs.watermark,
        ...(referenceImage ? { image: referenceImage } : {})
    }
}

const shouldRetryWithFallbackReferenceImage = (response: AxiosResponse | undefined, hasFallbackVariant: boolean): boolean => {
    return Boolean(hasFallbackVariant && response && response.status >= 500)
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
    private readonly credentialId?: string
    private readonly inputRmbPerImage: number
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
        const inputRmbPerImage = Number(config.inputRmbPerImage)
        this.inputRmbPerImage = Number.isFinite(inputRmbPerImage) && inputRmbPerImage >= 0 ? inputRmbPerImage : 0
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
                chatflowid: this.chatflowid,
                orgId: this.orgId
            },
            options
        )

        const effectiveArgs = resolveDoubaoImageGenerationArgs(input, {
            model: this.modelName,
            size: this.defaultSize,
            outputFormat: this.defaultOutputFormat,
            watermark: this.defaultWatermark
        })
        const resolvedReferenceImage = await resolveReferenceImagePayload(input.referenceImages, storageContext)
        const payloads = resolvedReferenceImage?.fallback
            ? [
                  buildDoubaoRequestPayload(effectiveArgs, resolvedReferenceImage.primary),
                  buildDoubaoRequestPayload(effectiveArgs, resolvedReferenceImage.fallback)
              ]
            : [buildDoubaoRequestPayload(effectiveArgs, resolvedReferenceImage?.primary)]

        let response: AxiosResponse<IDoubaoArkImageResponse> | undefined
        let lastError: unknown
        for (let index = 0; index < payloads.length; index += 1) {
            const payload = payloads[index]
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

                if (!shouldRetryWithFallbackReferenceImage(response, index === 0 && payloads.length > 1)) {
                    break
                }
            } catch (error) {
                lastError = error
                if (index === payloads.length - 1) {
                    throw new Error(getSafeDoubaoErrorMessage(error))
                }
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
                generatedImages: normalizedGeneratedImages,
                inputRmbPerImage: this.inputRmbPerImage
            }
        }
    }
}
