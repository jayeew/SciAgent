import { ICommonObject, INode, INodeData, INodeOptionsValue, INodeParams } from '../../../src/Interface'
import { getModels, MODEL_TYPE } from '../../../src/modelLoader'
import { getCredentialData, getCredentialParam } from '../../../src/utils'
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
} from '../../mediamodels/AlibabaImage/core'
import { createAlibabaImageTools } from './core'

class AlibabaImageTool_Tools implements INode {
    label: string
    name: string
    version: number
    description: string
    type: string
    icon: string
    category: string
    baseClasses: string[]
    credential: INodeParams
    inputs: INodeParams[]

    constructor() {
        this.label = 'Alibaba Image Tool'
        this.name = 'alibabaImageTool'
        this.version = 1.0
        this.type = 'AlibabaImageTool'
        this.icon = 'alibaba-svgrepo-com.svg'
        this.category = 'Tools'
        this.description =
            'Generate or edit Alibaba DashScope Qwen images inside Tool/Agentflow pipelines and optionally inject them into a presentationSpec'
        this.baseClasses = [this.type, 'Tool']
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
                default: DEFAULT_ALIBABA_IMAGE_MODEL,
                optional: true,
                additionalParams: true
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
            },
            {
                label: 'Reference Image Source',
                name: 'referenceImageSource',
                type: 'options',
                options: [
                    {
                        label: 'Disabled',
                        name: 'disabled'
                    },
                    {
                        label: 'Flow State',
                        name: 'flowState'
                    },
                    {
                        label: 'Current Uploads',
                        name: 'currentUploads'
                    },
                    {
                        label: 'Flow State Then Uploads',
                        name: 'flowStateThenUploads'
                    }
                ],
                default: 'disabled',
                optional: true,
                additionalParams: true
            },
            {
                label: 'Reference State Key',
                name: 'referenceImageStateKey',
                type: 'string',
                optional: true,
                additionalParams: true,
                show: {
                    referenceImageSource: 'flowState|flowStateThenUploads'
                },
                description: 'Top-level flow state key used to auto-resolve one reference image from an earlier node result.'
            },
            {
                label: 'Reference Image Selection',
                name: 'referenceImageSelection',
                type: 'options',
                options: [
                    {
                        label: 'First',
                        name: 'first'
                    },
                    {
                        label: 'Last',
                        name: 'last'
                    }
                ],
                default: 'first',
                optional: true,
                additionalParams: true,
                show: {
                    referenceImageSource: 'flowState|currentUploads|flowStateThenUploads'
                },
                description: 'Choose whether automatic reference image resolution uses the first or last available candidate.'
            }
        ]
    }

    loadMethods = {
        async listModels(): Promise<INodeOptionsValue[]> {
            return await getModels(MODEL_TYPE.MEDIA, 'alibabaImage')
        }
    }

    transformNodeInputsToToolArgs(nodeData: INodeData): Record<string, any> {
        const nodeInputs: Record<string, any> = {}

        if (nodeData.inputs?.size) nodeInputs.size = nodeData.inputs.size
        if (nodeData.inputs?.imageCount !== undefined) nodeInputs.imageCount = nodeData.inputs.imageCount
        if (nodeData.inputs?.negativePrompt) nodeInputs.negativePrompt = nodeData.inputs.negativePrompt
        if (nodeData.inputs?.promptExtend !== undefined) nodeInputs.promptExtend = nodeData.inputs.promptExtend
        if (nodeData.inputs?.watermark !== undefined) nodeInputs.watermark = nodeData.inputs.watermark
        if (nodeData.inputs?.seed !== undefined && nodeData.inputs?.seed !== '') nodeInputs.seed = nodeData.inputs.seed
        if (nodeData.inputs?.referenceImageSource) nodeInputs.referenceImageSource = nodeData.inputs.referenceImageSource
        if (nodeData.inputs?.referenceImageStateKey) nodeInputs.referenceImageStateKey = nodeData.inputs.referenceImageStateKey
        if (nodeData.inputs?.referenceImageSelection) nodeInputs.referenceImageSelection = nodeData.inputs.referenceImageSelection

        return nodeInputs
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

        const defaultParams = this.transformNodeInputsToToolArgs(nodeData)
        const mediaModel = new AlibabaImageModel({
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

        return createAlibabaImageTools({
            defaultParams,
            mediaModel
        })
    }
}

module.exports = { nodeClass: AlibabaImageTool_Tools }
