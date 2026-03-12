import { ICommonObject, INode, INodeData, INodeOptionsValue, INodeParams } from '../../../src/Interface'
import { getModels, MODEL_TYPE } from '../../../src/modelLoader'
import { getBaseClasses, getCredentialData, getCredentialParam } from '../../../src/utils'
import {
    DEFAULT_DOUBAO_ARK_BASE_URL,
    DEFAULT_DOUBAO_IMAGE_MODEL,
    DEFAULT_DOUBAO_IMAGE_OUTPUT_FORMAT,
    DEFAULT_DOUBAO_IMAGE_SEQUENTIAL_IMAGE_GENERATION,
    DEFAULT_DOUBAO_IMAGE_SEQUENTIAL_IMAGE_GENERATION_MAX_IMAGES,
    DEFAULT_DOUBAO_IMAGE_SIZE,
    DEFAULT_DOUBAO_IMAGE_WATERMARK,
    DOUBAO_IMAGE_SIZE_OPTIONS,
    MAX_DOUBAO_IMAGE_SEQUENTIAL_IMAGE_GENERATION_MAX_IMAGES,
    MIN_DOUBAO_IMAGE_SEQUENTIAL_IMAGE_GENERATION_MAX_IMAGES,
    DoubaoImageModel,
    normalizeDoubaoImageSize,
    normalizeDoubaoOutputFormat,
    normalizeDoubaoSequentialImageGeneration,
    normalizeDoubaoSequentialImageGenerationMaxImages
} from './core'

class DoubaoImage_MediaModels implements INode {
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
        this.label = 'Doubao Image'
        this.name = 'doubaoImage'
        this.version = 1.0
        this.type = 'DoubaoImage'
        this.icon = 'doubao.svg'
        this.category = 'Media Models'
        this.description = 'Generate or edit images with Doubao Ark from conversational prompts and reference images'
        this.baseClasses = Array.from(new Set([this.type, ...getBaseClasses(DoubaoImageModel), 'Runnable']))
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
                default: DEFAULT_DOUBAO_IMAGE_MODEL
            },
            {
                label: 'Default Size',
                name: 'size',
                type: 'options',
                options: DOUBAO_IMAGE_SIZE_OPTIONS,
                default: DEFAULT_DOUBAO_IMAGE_SIZE,
                optional: true,
                additionalParams: true,
                description: 'Pass pixel size to Doubao Ark, for example 2048x1536'
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
                additionalParams: true,
                description: 'Group image generation mode. Only doubao-seedream-5.0-lite/4.5/4.0 models officially support this parameter.'
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
            }
        ]
    }

    loadMethods = {
        async listModels(): Promise<INodeOptionsValue[]> {
            return await getModels(MODEL_TYPE.MEDIA, 'doubaoImage')
        }
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

        const credentialData = await getCredentialData(nodeData.credential ?? '', options)
        const arkApiKey = getCredentialParam('arkApiKey', credentialData, nodeData)
        const baseUrl = getCredentialParam('baseUrl', credentialData, nodeData, DEFAULT_DOUBAO_ARK_BASE_URL)

        return new DoubaoImageModel({
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
    }
}

module.exports = { nodeClass: DoubaoImage_MediaModels }
