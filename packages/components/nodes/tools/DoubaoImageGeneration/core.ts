import { CallbackManagerForToolRun, CallbackManager, Callbacks, parseCallbackConfigArg } from '@langchain/core/callbacks/manager'
import { RunnableConfig } from '@langchain/core/runnables'
import { StructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import { ARTIFACTS_PREFIX, TOOL_ARGS_PREFIX } from '../../../src/agents'
import { ICommonObject } from '../../../src/Interface'
import { parseWithTypeConversion } from '../../../src/utils'
import {
    DoubaoImageModel,
    IDoubaoImageGenerationArgs,
    IDoubaoImageGenerationConfig,
    resolveDoubaoImageGenerationArgs
} from '../../mediamodels/DoubaoImage/core'

export {
    DEFAULT_DOUBAO_ARK_BASE_URL,
    DEFAULT_DOUBAO_IMAGE_MODEL,
    DEFAULT_DOUBAO_IMAGE_OUTPUT_FORMAT,
    DEFAULT_DOUBAO_IMAGE_SIZE,
    DEFAULT_DOUBAO_IMAGE_WATERMARK,
    DOUBAO_IMAGE_SIZE_OPTIONS,
    normalizeDoubaoImageSize,
    normalizeDoubaoOutputFormat,
    resolveDoubaoImageGenerationArgs
} from '../../mediamodels/DoubaoImage/core'

export const DEFAULT_DOUBAO_IMAGE_TOOL_NAME = 'doubao_image_generation'

export const DEFAULT_DOUBAO_IMAGE_TOOL_DESCRIPTION =
    'Generate images from a text prompt with Doubao Ark. Use this tool only when the user explicitly asks to create, draw, design, or generate an image, poster, illustration, cover, avatar, or artwork. Do not use it for search, OCR, or image analysis.'

interface IDoubaoImageGenerationToolConfig extends IDoubaoImageGenerationConfig {
    name: string
    description: string
    returnDirect?: boolean
    tokenAuditContext?: ICommonObject
}

class DoubaoToolInputParsingException extends Error {
    output?: string

    constructor(message: string, output?: string) {
        super(message)
        this.output = output
    }
}

const buildToolSummary = (result: { metadata?: ICommonObject }) => {
    const metadata = result.metadata || {}

    return {
        provider: metadata.provider,
        model: metadata.model,
        imageCount: metadata.imageCount ?? 0,
        images: metadata.images ?? [],
        usage: metadata.usage ?? null,
        created: metadata.created ?? null,
        ...(metadata.partialFailureCount ? { partialFailureCount: metadata.partialFailureCount } : {})
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

    private readonly chatflowid?: string
    private readonly orgId?: string
    private readonly tokenAuditContext?: ICommonObject
    private readonly mediaModel: DoubaoImageModel
    private readonly defaultArgsConfig: Partial<IDoubaoImageGenerationConfig>

    constructor(config: IDoubaoImageGenerationToolConfig) {
        super()
        this.name = config.name
        this.description = config.description
        this.returnDirect = config.returnDirect ?? false
        this.chatflowid = config.chatflowid
        this.orgId = config.orgId
        this.tokenAuditContext = config.tokenAuditContext
        this.mediaModel = new DoubaoImageModel(config)
        this.defaultArgsConfig = {
            model: config.model,
            size: config.size,
            outputFormat: config.outputFormat,
            watermark: config.watermark
        }
    }

    private recordUsageArtifacts(result: { metadata?: ICommonObject; mediaBilling?: ICommonObject }) {
        if (!this.tokenAuditContext) return

        if (result.metadata) {
            if (!Array.isArray(this.tokenAuditContext.tokenUsagePayloads)) {
                this.tokenAuditContext.tokenUsagePayloads = []
            }

            this.tokenAuditContext.tokenUsagePayloads.push({
                metadata: result.metadata
            })
        }

        if (result.mediaBilling) {
            if (!Array.isArray(this.tokenAuditContext.mediaGenerationBillings)) {
                this.tokenAuditContext.mediaGenerationBillings = []
            }

            this.tokenAuditContext.mediaGenerationBillings.push(result.mediaBilling)
        }
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

        const effectiveArgs = resolveDoubaoImageGenerationArgs(input, this.defaultArgsConfig)
        const result = await this.mediaModel.invoke(input, {
            ...resolvedFlowConfig,
            chatflowid: this.chatflowid,
            orgId: this.orgId
        })
        this.recordUsageArtifacts(result as unknown as { metadata?: ICommonObject; mediaBilling?: ICommonObject })

        const args = (result.input as IDoubaoImageGenerationArgs | undefined) ?? effectiveArgs
        const summary = buildToolSummary(result)

        return JSON.stringify(summary) + ARTIFACTS_PREFIX + JSON.stringify(result.artifacts) + TOOL_ARGS_PREFIX + JSON.stringify(args)
    }
}
