import { ICommonObject, INode, INodeData, INodeOptionsValue, INodeParams } from '../../../src/Interface'
import { getModels, MODEL_TYPE } from '../../../src/modelLoader'
import { getBaseClasses, getCredentialData, getCredentialParam } from '../../../src/utils'
import {
    ALIBABA_IMAGE_SIZE_OPTIONS,
    AlibabaImageModel,
    DEFAULT_ALIBABA_IMAGE_BASE_URL,
    DEFAULT_ALIBABA_IMAGE_COUNT,
    DEFAULT_ALIBABA_IMAGE_MODEL,
    DEFAULT_ALIBABA_IMAGE_PROMPT_EXTEND,
    DEFAULT_ALIBABA_IMAGE_WATERMARK,
    normalizeAlibabaImageCount,
    normalizeAlibabaImageSize,
    normalizeAlibabaPromptExtend,
    normalizeAlibabaSeed,
    normalizeAlibabaWatermark
} from './core'

class AlibabaImage_MediaModels implements INode {
    label: string
    name: string
    version: number
    type: string
    icon: string
    category: string
    description: string
    baseClasses: string[]
    credential: INodeParams
    inputs: INodeParams[]

    constructor() {
        this.label = 'Alibaba Image'
        this.name = 'alibabaImage'
        this.version = 1.0
        this.type = 'AlibabaImage'
        this.icon = 'alibaba-svgrepo-com.svg'
        this.category = 'Media Models'
        this.description = 'Generate or edit images with Alibaba DashScope Qwen Image 2.0 models'
        this.baseClasses = Array.from(new Set([this.type, ...getBaseClasses(AlibabaImageModel), 'Runnable']))
        this.credential = {
            label: 'Connect Credential',
            name: 'credential',
            type: 'credential',
            credentialNames: ['AlibabaApi']
        }
        this.inputs = [
            {
                label: 'Model',
                name: 'model',
                type: 'asyncOptions',
                loadMethod: 'listModels',
                default: DEFAULT_ALIBABA_IMAGE_MODEL
            },
            {
                label: 'Default Size',
                name: 'size',
                type: 'options',
                options: ALIBABA_IMAGE_SIZE_OPTIONS,
                optional: true,
                additionalParams: true,
                description:
                    'Recommended Qwen Image 2.0 resolutions. Official default resolution is 2048*2048 when size is not explicitly set.'
            },
            {
                label: 'Default Image Count',
                name: 'imageCount',
                type: 'number',
                default: DEFAULT_ALIBABA_IMAGE_COUNT,
                optional: true,
                additionalParams: true,
                description: 'Default generated image count for each request. Range: 1-6.'
            },
            {
                label: 'Default Negative Prompt',
                name: 'negativePrompt',
                type: 'string',
                optional: true,
                additionalParams: true
            },
            {
                label: 'Default Prompt Extend',
                name: 'promptExtend',
                type: 'boolean',
                default: DEFAULT_ALIBABA_IMAGE_PROMPT_EXTEND,
                optional: true,
                additionalParams: true
            },
            {
                label: 'Default Watermark',
                name: 'watermark',
                type: 'boolean',
                default: DEFAULT_ALIBABA_IMAGE_WATERMARK,
                optional: true,
                additionalParams: true
            },
            {
                label: 'Default Seed',
                name: 'seed',
                type: 'number',
                optional: true,
                additionalParams: true,
                description: 'Optional seed for more stable outputs. Range: 0-2147483647.'
            }
        ]
    }

    loadMethods = {
        async listModels(): Promise<INodeOptionsValue[]> {
            return await getModels(MODEL_TYPE.MEDIA, 'alibabaImage')
        }
    }

    async init(nodeData: INodeData, _: string, options: ICommonObject): Promise<any> {
        const model = (nodeData.inputs?.model as string)?.trim() || DEFAULT_ALIBABA_IMAGE_MODEL
        const size = normalizeAlibabaImageSize(nodeData.inputs?.size as string)
        const imageCount =
            nodeData.inputs?.imageCount !== undefined
                ? normalizeAlibabaImageCount(Number(nodeData.inputs?.imageCount))
                : DEFAULT_ALIBABA_IMAGE_COUNT
        const negativePrompt = (nodeData.inputs?.negativePrompt as string)?.trim() || undefined
        const promptExtend =
            nodeData.inputs?.promptExtend !== undefined
                ? normalizeAlibabaPromptExtend(nodeData.inputs?.promptExtend as boolean)
                : DEFAULT_ALIBABA_IMAGE_PROMPT_EXTEND
        const watermark =
            nodeData.inputs?.watermark !== undefined
                ? normalizeAlibabaWatermark(nodeData.inputs?.watermark as boolean)
                : DEFAULT_ALIBABA_IMAGE_WATERMARK
        const seed =
            nodeData.inputs?.seed !== undefined && nodeData.inputs?.seed !== ''
                ? normalizeAlibabaSeed(Number(nodeData.inputs?.seed))
                : undefined

        const credentialData = await getCredentialData(nodeData.credential ?? '', { ...options, tokenAuditContext: undefined })
        const alibabaApiKey = getCredentialParam('alibabaApiKey', credentialData, nodeData)

        return new AlibabaImageModel({
            apiKey: alibabaApiKey,
            credentialId: nodeData.credential,
            baseUrl: DEFAULT_ALIBABA_IMAGE_BASE_URL,
            model,
            size,
            imageCount,
            negativePrompt,
            promptExtend,
            watermark,
            seed,
            chatflowid: options.chatflowid,
            orgId: options.orgId
        })
    }
}

module.exports = { nodeClass: AlibabaImage_MediaModels }
