import { ICommonObject, INode, INodeData, INodeOptionsValue, INodeParams } from '../../../src/Interface'
import { getModels, MODEL_TYPE } from '../../../src/modelLoader'
import { getCredentialData, getCredentialParam } from '../../../src/utils'
import {
    DEFAULT_DOUBAO_ARK_BASE_URL,
    DEFAULT_DOUBAO_IMAGE_MODEL,
    DEFAULT_DOUBAO_IMAGE_OUTPUT_FORMAT,
    DEFAULT_DOUBAO_IMAGE_SEQUENTIAL_IMAGE_GENERATION,
    DEFAULT_DOUBAO_IMAGE_SEQUENTIAL_IMAGE_GENERATION_MAX_IMAGES,
    DEFAULT_DOUBAO_IMAGE_SIZE,
    DEFAULT_DOUBAO_IMAGE_WATERMARK,
    DOUBAO_IMAGE_SIZE_OPTIONS,
    DoubaoImageModel,
    MAX_DOUBAO_IMAGE_SEQUENTIAL_IMAGE_GENERATION_MAX_IMAGES,
    MIN_DOUBAO_IMAGE_SEQUENTIAL_IMAGE_GENERATION_MAX_IMAGES,
    normalizeDoubaoImageSize,
    normalizeDoubaoOutputFormat,
    normalizeDoubaoSequentialImageGeneration,
    normalizeDoubaoSequentialImageGenerationMaxImages
} from '../../mediamodels/DoubaoImage/core'
import { createDoubaoImageTools } from './core'

class DoubaoImageTool_Tools implements INode {
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
        this.label = 'Doubao Image Tool'
        this.name = 'doubaoImageTool'
        this.version = 1.0
        this.type = 'DoubaoImageTool'
        this.icon = 'doubao.svg'
        this.category = 'Tools'
        this.description = 'Generate Doubao images inside Tool/Agentflow pipelines and optionally inject them into a presentationSpec'
        this.baseClasses = [this.type, 'Tool']
        this.credential = {
            label: 'Connect Credential',
            name: 'credential',
            type: 'credential',
            credentialNames: ['doubaoArkApi']
        }
        this.inputs = [
            {
                label: 'Model',
                name: 'model',
                type: 'asyncOptions',
                loadMethod: 'listModels',
                default: DEFAULT_DOUBAO_IMAGE_MODEL,
                optional: true,
                additionalParams: true
            },
            {
                label: 'Default Size',
                name: 'size',
                type: 'options',
                options: DOUBAO_IMAGE_SIZE_OPTIONS,
                default: DEFAULT_DOUBAO_IMAGE_SIZE,
                optional: true,
                additionalParams: true
            },
            {
                label: 'Default Output Format',
                name: 'outputFormat',
                type: 'options',
                options: [
                    {
                        label: 'PNG',
                        name: 'png'
                    },
                    {
                        label: 'JPEG',
                        name: 'jpeg'
                    }
                ],
                default: DEFAULT_DOUBAO_IMAGE_OUTPUT_FORMAT,
                optional: true,
                additionalParams: true
            },
            {
                label: 'Default Watermark',
                name: 'watermark',
                type: 'boolean',
                default: DEFAULT_DOUBAO_IMAGE_WATERMARK,
                optional: true,
                additionalParams: true
            },
            {
                label: 'Sequential Image Generation',
                name: 'sequentialImageGeneration',
                type: 'options',
                options: [
                    {
                        label: 'Disabled',
                        name: 'disabled'
                    },
                    {
                        label: 'Auto',
                        name: 'auto'
                    }
                ],
                default: DEFAULT_DOUBAO_IMAGE_SEQUENTIAL_IMAGE_GENERATION,
                optional: true,
                additionalParams: true
            },
            {
                label: 'Sequential Max Images',
                name: 'sequentialImageGenerationMaxImages',
                type: 'number',
                default: DEFAULT_DOUBAO_IMAGE_SEQUENTIAL_IMAGE_GENERATION_MAX_IMAGES,
                optional: true,
                additionalParams: true,
                show: {
                    sequentialImageGeneration: 'auto'
                },
                description: `Maximum generated images for sequential mode. Effective only when Sequential Image Generation is auto. Range: ${MIN_DOUBAO_IMAGE_SEQUENTIAL_IMAGE_GENERATION_MAX_IMAGES}-${MAX_DOUBAO_IMAGE_SEQUENTIAL_IMAGE_GENERATION_MAX_IMAGES}.`
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
            return await getModels(MODEL_TYPE.MEDIA, 'doubaoImage')
        }
    }

    transformNodeInputsToToolArgs(nodeData: INodeData): Record<string, any> {
        const nodeInputs: Record<string, any> = {}

        if (nodeData.inputs?.size) nodeInputs.size = nodeData.inputs.size
        if (nodeData.inputs?.outputFormat) nodeInputs.outputFormat = nodeData.inputs.outputFormat
        if (nodeData.inputs?.sequentialImageGeneration) nodeInputs.sequentialImageGeneration = nodeData.inputs.sequentialImageGeneration
        if (nodeData.inputs?.sequentialImageGenerationMaxImages !== undefined) {
            nodeInputs.sequentialImageGenerationMaxImages = nodeData.inputs.sequentialImageGenerationMaxImages
        }
        if (nodeData.inputs?.watermark !== undefined) nodeInputs.watermark = nodeData.inputs.watermark
        if (nodeData.inputs?.referenceImageSource) nodeInputs.referenceImageSource = nodeData.inputs.referenceImageSource
        if (nodeData.inputs?.referenceImageStateKey) nodeInputs.referenceImageStateKey = nodeData.inputs.referenceImageStateKey
        if (nodeData.inputs?.referenceImageSelection) nodeInputs.referenceImageSelection = nodeData.inputs.referenceImageSelection

        return nodeInputs
    }

    async init(nodeData: INodeData, _: string, options: ICommonObject): Promise<any> {
        const model = (nodeData.inputs?.model as string)?.trim() || DEFAULT_DOUBAO_IMAGE_MODEL
        const size = normalizeDoubaoImageSize(nodeData.inputs?.size as string) || DEFAULT_DOUBAO_IMAGE_SIZE
        const outputFormat = normalizeDoubaoOutputFormat(nodeData.inputs?.outputFormat as string)
        const watermark =
            typeof nodeData.inputs?.watermark === 'boolean' ? (nodeData.inputs?.watermark as boolean) : DEFAULT_DOUBAO_IMAGE_WATERMARK
        const sequentialImageGeneration = normalizeDoubaoSequentialImageGeneration(nodeData.inputs?.sequentialImageGeneration as string)
        const sequentialImageGenerationMaxImages =
            normalizeDoubaoSequentialImageGenerationMaxImages(Number(nodeData.inputs?.sequentialImageGenerationMaxImages)) ??
            DEFAULT_DOUBAO_IMAGE_SEQUENTIAL_IMAGE_GENERATION_MAX_IMAGES

        const credentialData = await getCredentialData(nodeData.credential ?? '', { ...options, tokenAuditContext: undefined })
        const arkApiKey = getCredentialParam('arkApiKey', credentialData, nodeData)
        const baseUrl = getCredentialParam('baseUrl', credentialData, nodeData, DEFAULT_DOUBAO_ARK_BASE_URL)

        const defaultParams = this.transformNodeInputsToToolArgs(nodeData)
        const mediaModel = new DoubaoImageModel({
            apiKey: arkApiKey,
            credentialId: nodeData.credential,
            baseUrl,
            model,
            size,
            outputFormat,
            watermark,
            sequentialImageGeneration,
            sequentialImageGenerationMaxImages,
            chatflowid: options.chatflowid,
            orgId: options.orgId
        })

        return createDoubaoImageTools({
            defaultParams,
            mediaModel
        })
    }
}

module.exports = { nodeClass: DoubaoImageTool_Tools }
