import { CallbackManagerForToolRun, CallbackManager, Callbacks, parseCallbackConfigArg } from '@langchain/core/callbacks/manager'
import { RunnableConfig } from '@langchain/core/runnables'
import { StructuredTool } from '@langchain/core/tools'
import { AxiosResponse } from 'axios'
import { z } from 'zod'
import { ARTIFACTS_PREFIX, TOOL_ARGS_PREFIX } from '../../../src/agents'
import { ICommonObject } from '../../../src/Interface'
import { secureAxiosRequest, secureFetch } from '../../../src/httpSecurity'
import { addSingleFileToStorage } from '../../../src/storageUtils'
import { parseWithTypeConversion } from '../../../src/utils'

export const DEFAULT_DOUBAO_ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'
export const DEFAULT_DOUBAO_IMAGE_MODEL = 'doubao-seedream-5-0-260128'
export const DEFAULT_DOUBAO_IMAGE_SIZE = '2K'
export const DEFAULT_DOUBAO_IMAGE_OUTPUT_FORMAT = 'png'
export const DEFAULT_DOUBAO_IMAGE_WATERMARK = false
export const DEFAULT_DOUBAO_IMAGE_TOOL_NAME = 'doubao_image_generation'
export const DOUBAO_IMAGE_PROVIDER = 'doubao-ark'

export const DEFAULT_DOUBAO_IMAGE_TOOL_DESCRIPTION =
    'Generate images from a text prompt with Doubao Ark. Use this tool only when the user explicitly asks to create, draw, design, or generate an image, poster, illustration, cover, avatar, or artwork. Do not use it for search, OCR, or image analysis.'

export interface IDoubaoImageGenerationSchema {
    prompt: string
    size?: string
    outputFormat?: 'png' | 'jpeg' | 'jpg'
    watermark?: boolean
}

export interface IDoubaoImageGenerationConfig {
    name: string
    description: string
    apiKey: string
    baseUrl?: string
    model?: string
    size?: string
    outputFormat?: string
    watermark?: boolean
    returnDirect?: boolean
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

interface IStoredArtifact {
    type: 'png' | 'jpeg'
    data: string
}

interface IStoredImageSummary {
    fileName: string
    size?: string
}

class DoubaoToolInputParsingException extends Error {
    output?: string

    constructor(message: string, output?: string) {
        super(message)
        this.output = output
    }
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
        size: input.size?.trim() || config.size?.trim() || DEFAULT_DOUBAO_IMAGE_SIZE,
        outputFormat: normalizeDoubaoOutputFormat(input.outputFormat || config.outputFormat),
        watermark: typeof input.watermark === 'boolean' ? input.watermark : config.watermark ?? DEFAULT_DOUBAO_IMAGE_WATERMARK
    }
}

const getSafeDoubaoErrorMessage = (error: any): string => {
    const responseData = error?.response?.data
    const candidates = [responseData?.message, responseData?.error?.message, responseData?.error, responseData?.detail, error?.message]

    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim()) {
            return candidate.trim()
        }
    }

    if (error?.response?.status) {
        return `Doubao Ark request failed with status ${error.response.status}`
    }

    return 'Doubao Ark request failed'
}

const getMimeTypeForFormat = (outputFormat: 'png' | 'jpeg'): string => {
    return outputFormat === 'png' ? 'image/png' : 'image/jpeg'
}

const getOutputFormatFromContentType = (contentType?: string, fallback?: string): 'png' | 'jpeg' => {
    const normalizedContentType = contentType?.split(';')[0]?.trim().toLowerCase()

    if (normalizedContentType === 'image/png') return 'png'
    if (normalizedContentType === 'image/jpeg' || normalizedContentType === 'image/jpg') return 'jpeg'

    return normalizeDoubaoOutputFormat(fallback)
}

const getSummaryPayload = (
    response: IDoubaoArkImageResponse,
    effectiveArgs: IDoubaoImageGenerationArgs,
    images: IStoredImageSummary[],
    partialFailureCount: number
) => {
    return {
        provider: DOUBAO_IMAGE_PROVIDER,
        model: response.model || effectiveArgs.model,
        imageCount: images.length,
        images,
        usage: response.usage ?? null,
        created: response.created ?? null,
        ...(partialFailureCount > 0 ? { partialFailureCount } : {})
    }
}

export class DoubaoImageGenerationTool extends StructuredTool {
    name: string

    description: string

    returnDirect = false

    schema = z.object({
        prompt: z.string().min(1).describe('Detailed text prompt describing the image to generate'),
        size: z.string().optional().describe('Optional image size override, for example 2K'),
        outputFormat: z.enum(['png', 'jpeg', 'jpg']).optional().describe('Optional output format override: png or jpeg'),
        watermark: z.boolean().optional().describe('Whether to keep the watermark on the generated image')
    })

    private readonly apiKey: string
    private readonly baseUrl: string
    private readonly model: string
    private readonly defaultSize: string
    private readonly defaultOutputFormat: 'png' | 'jpeg'
    private readonly defaultWatermark: boolean
    private readonly chatflowid?: string
    private readonly orgId?: string

    constructor(config: IDoubaoImageGenerationConfig) {
        super()
        this.name = config.name
        this.description = config.description
        this.returnDirect = config.returnDirect ?? false
        this.apiKey = config.apiKey
        this.baseUrl = normalizeDoubaoBaseUrl(config.baseUrl)
        this.model = config.model?.trim() || DEFAULT_DOUBAO_IMAGE_MODEL
        this.defaultSize = config.size?.trim() || DEFAULT_DOUBAO_IMAGE_SIZE
        this.defaultOutputFormat = normalizeDoubaoOutputFormat(config.outputFormat)
        this.defaultWatermark = config.watermark ?? DEFAULT_DOUBAO_IMAGE_WATERMARK
        this.chatflowid = config.chatflowid
        this.orgId = config.orgId
    }

    get lc_secrets(): { [key: string]: string } | undefined {
        return {
            apiKey: 'DOUBAO_ARK_API_KEY'
        }
    }

    async call(
        arg: z.infer<typeof this.schema>,
        configArg?: RunnableConfig | Callbacks,
        tags?: string[],
        flowConfig?: { sessionId?: string; chatId?: string; input?: string; state?: ICommonObject }
    ): Promise<string> {
        const config = parseCallbackConfigArg(configArg)
        if (config.runName === undefined) {
            config.runName = this.name
        }

        let parsed
        try {
            parsed = await parseWithTypeConversion(this.schema, arg)
        } catch (error) {
            throw new DoubaoToolInputParsingException('Received tool input did not match expected schema', JSON.stringify(arg))
        }

        const callbackManager_ = await CallbackManager.configure(
            config.callbacks,
            this.callbacks,
            config.tags || tags,
            this.tags,
            config.metadata,
            this.metadata,
            { verbose: this.verbose }
        )

        const runManager = await callbackManager_?.handleToolStart(
            this.toJSON(),
            typeof parsed === 'string' ? parsed : JSON.stringify(parsed),
            undefined,
            undefined,
            undefined,
            undefined,
            config.runName
        )

        let result
        try {
            result = await this._call(parsed, runManager, flowConfig)
        } catch (error) {
            await runManager?.handleToolError(error)
            throw error
        }

        if (result && typeof result !== 'string') {
            result = JSON.stringify(result)
        }

        await runManager?.handleToolEnd(result)
        return result
    }

    protected async _call(input: z.infer<typeof this.schema>, _?: CallbackManagerForToolRun, flowConfig?: any): Promise<string> {
        if (!this.apiKey?.trim()) {
            throw new Error('Doubao Ark API key is required')
        }
        if (!this.chatflowid) {
            throw new Error('Chatflow ID is required to store generated images')
        }
        if (!this.orgId) {
            throw new Error('Organization ID is required to store generated images')
        }

        const resolvedFlowConfig = (flowConfig || {}) as { sessionId?: string; chatId?: string; input?: string; state?: ICommonObject }
        if (!resolvedFlowConfig.chatId) {
            throw new Error('Chat ID is required to store generated images')
        }

        const effectiveArgs = resolveDoubaoImageGenerationArgs(input, {
            model: this.model,
            size: this.defaultSize,
            outputFormat: this.defaultOutputFormat,
            watermark: this.defaultWatermark
        })

        const payload = {
            model: effectiveArgs.model,
            prompt: effectiveArgs.prompt,
            size: effectiveArgs.size,
            output_format: effectiveArgs.outputFormat,
            watermark: effectiveArgs.watermark
        }

        let response: AxiosResponse<IDoubaoArkImageResponse>
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
        } catch (error) {
            throw new Error(getSafeDoubaoErrorMessage(error))
        }

        const responseData = response.data
        if (!responseData?.data || !Array.isArray(responseData.data) || responseData.data.length === 0) {
            throw new Error('Doubao Ark image generation returned no images')
        }

        const artifacts: IStoredArtifact[] = []
        const images: IStoredImageSummary[] = []
        let partialFailureCount = 0

        for (let index = 0; index < responseData.data.length; index += 1) {
            const image = responseData.data[index]
            if (!image?.url) {
                partialFailureCount += 1
                continue
            }

            try {
                const downloadResponse: any = await secureFetch(image.url, { method: 'GET' })
                if (!downloadResponse.ok) {
                    throw new Error(`Image download failed with status ${downloadResponse.status}`)
                }

                const contentType = downloadResponse.headers?.get?.('content-type') || getMimeTypeForFormat(effectiveArgs.outputFormat)
                const artifactType = getOutputFormatFromContentType(contentType, effectiveArgs.outputFormat)
                const fileName = `doubao_generated_image_${Date.now()}_${index + 1}.${artifactType}`
                const arrayBuffer = await downloadResponse.arrayBuffer()
                const imageBuffer = Buffer.from(arrayBuffer)

                const { path } = await addSingleFileToStorage(
                    getMimeTypeForFormat(artifactType),
                    imageBuffer,
                    fileName,
                    this.orgId,
                    this.chatflowid,
                    resolvedFlowConfig.chatId
                )

                artifacts.push({
                    type: artifactType,
                    data: path
                })

                images.push({
                    fileName,
                    size: image.size
                })
            } catch (error) {
                partialFailureCount += 1
            }
        }

        if (artifacts.length === 0) {
            throw new Error('Doubao Ark image generation succeeded but no images could be stored')
        }

        const summary = getSummaryPayload(responseData, effectiveArgs, images, partialFailureCount)
        return JSON.stringify(summary) + ARTIFACTS_PREFIX + JSON.stringify(artifacts) + TOOL_ARGS_PREFIX + JSON.stringify(effectiveArgs)
    }
}
