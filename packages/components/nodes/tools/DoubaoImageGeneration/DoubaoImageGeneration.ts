import { ICommonObject, INode, INodeData, INodeParams } from '../../../src/Interface'
import { getBaseClasses, getCredentialData, getCredentialParam } from '../../../src/utils'
import {
    DEFAULT_DOUBAO_ARK_BASE_URL,
    DEFAULT_DOUBAO_IMAGE_MODEL,
    DEFAULT_DOUBAO_IMAGE_OUTPUT_FORMAT,
    DEFAULT_DOUBAO_IMAGE_SIZE,
    DEFAULT_DOUBAO_IMAGE_TOOL_DESCRIPTION,
    DEFAULT_DOUBAO_IMAGE_TOOL_NAME,
    DEFAULT_DOUBAO_IMAGE_WATERMARK,
    DoubaoImageGenerationTool,
    normalizeDoubaoOutputFormat
} from './core'

class DoubaoImageGeneration_Tools implements INode {
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
        this.label = 'Doubao Image Generation'
        this.name = 'doubaoImageGeneration'
        this.version = 1.0
        this.type = 'DoubaoImageGeneration'
        this.icon = 'doubao.svg'
        this.category = 'Tools'
        this.description =
            'Generate images with Doubao Ark from text prompts. Use only when the user explicitly asks to create or design an image.'
        this.baseClasses = Array.from(new Set([this.type, ...getBaseClasses(DoubaoImageGenerationTool), 'Tool']))
        this.credential = {
            label: 'Connect Credential',
            name: 'credential',
            type: 'credential',
            credentialNames: ['doubaoArkApi']
        }
        this.inputs = [
            {
                label: 'Tool Name',
                name: 'toolName',
                type: 'string',
                default: DEFAULT_DOUBAO_IMAGE_TOOL_NAME
            },
            {
                label: 'Description',
                name: 'description',
                type: 'string',
                rows: 4,
                default: DEFAULT_DOUBAO_IMAGE_TOOL_DESCRIPTION,
                description: 'Describe clearly when the LLM should use this tool'
            },
            {
                label: 'Model',
                name: 'model',
                type: 'string',
                default: DEFAULT_DOUBAO_IMAGE_MODEL
            },
            {
                label: 'Default Size',
                name: 'size',
                type: 'string',
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
                label: 'Return Direct',
                name: 'returnDirect',
                type: 'boolean',
                optional: true,
                additionalParams: true
            }
        ]
    }

    async init(nodeData: INodeData, _: string, options: ICommonObject): Promise<any> {
        const toolName = (nodeData.inputs?.toolName as string)?.trim() || DEFAULT_DOUBAO_IMAGE_TOOL_NAME
        const description = (nodeData.inputs?.description as string)?.trim() || DEFAULT_DOUBAO_IMAGE_TOOL_DESCRIPTION
        const model = (nodeData.inputs?.model as string)?.trim() || DEFAULT_DOUBAO_IMAGE_MODEL
        const size = (nodeData.inputs?.size as string)?.trim() || DEFAULT_DOUBAO_IMAGE_SIZE
        const outputFormat = normalizeDoubaoOutputFormat(nodeData.inputs?.outputFormat as string)
        const watermark =
            typeof nodeData.inputs?.watermark === 'boolean' ? (nodeData.inputs?.watermark as boolean) : DEFAULT_DOUBAO_IMAGE_WATERMARK
        const returnDirect = (nodeData.inputs?.returnDirect as boolean) ?? false
        const normalizedToolName =
            toolName
                .toLowerCase()
                .replace(/ /g, '_')
                .replace(/[^a-z0-9_-]/g, '') || DEFAULT_DOUBAO_IMAGE_TOOL_NAME

        const credentialData = await getCredentialData(nodeData.credential ?? '', options)
        const arkApiKey = getCredentialParam('arkApiKey', credentialData, nodeData)
        const baseUrl = getCredentialParam('baseUrl', credentialData, nodeData, DEFAULT_DOUBAO_ARK_BASE_URL)

        return new DoubaoImageGenerationTool({
            name: normalizedToolName,
            description,
            apiKey: arkApiKey,
            baseUrl,
            model,
            size,
            outputFormat,
            watermark,
            returnDirect,
            chatflowid: options.chatflowid,
            orgId: options.orgId
        })
    }
}

module.exports = { nodeClass: DoubaoImageGeneration_Tools }
