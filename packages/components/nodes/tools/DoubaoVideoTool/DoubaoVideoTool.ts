import { ICommonObject, INode, INodeData, INodeOptionsValue, INodeParams } from '../../../src/Interface'
import { getModels, MODEL_TYPE } from '../../../src/modelLoader'
import { getCredentialData, getCredentialParam } from '../../../src/utils'
import {
    DEFAULT_DOUBAO_ARK_BASE_URL,
    DEFAULT_DOUBAO_VIDEO_CAMERA_FIXED,
    DEFAULT_DOUBAO_VIDEO_DURATION,
    DEFAULT_DOUBAO_VIDEO_MODEL,
    DEFAULT_DOUBAO_VIDEO_RATIO,
    DEFAULT_DOUBAO_VIDEO_RESOLUTION,
    DEFAULT_DOUBAO_VIDEO_WATERMARK,
    DoubaoVideoModel,
    normalizeDoubaoVideoRatio,
    normalizeDoubaoVideoResolution
} from '../../mediamodels/DoubaoVideo/core'
import { createDoubaoVideoTools } from './core'

class DoubaoVideoTool_Tools implements INode {
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
        this.label = 'Doubao Video Tool'
        this.name = 'doubaoVideoTool'
        this.version = 1.0
        this.type = 'DoubaoVideoTool'
        this.icon = 'doubao.svg'
        this.category = 'Tools'
        this.description = 'Generate Doubao videos inside Tool/Agentflow pipelines with optional first and last frame guidance'
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
                default: DEFAULT_DOUBAO_VIDEO_MODEL,
                optional: true,
                additionalParams: true
            },
            {
                label: 'Default Resolution',
                name: 'resolution',
                type: 'options',
                options: [
                    {
                        label: '480p',
                        name: '480p'
                    },
                    {
                        label: '720p',
                        name: '720p'
                    },
                    {
                        label: '1080p',
                        name: '1080p'
                    }
                ],
                default: DEFAULT_DOUBAO_VIDEO_RESOLUTION,
                optional: true,
                additionalParams: true
            },
            {
                label: 'Default Ratio',
                name: 'ratio',
                type: 'options',
                options: [
                    {
                        label: '16:9',
                        name: '16:9'
                    },
                    {
                        label: '4:3',
                        name: '4:3'
                    },
                    {
                        label: '1:1',
                        name: '1:1'
                    },
                    {
                        label: '3:4',
                        name: '3:4'
                    },
                    {
                        label: '9:16',
                        name: '9:16'
                    },
                    {
                        label: '21:9',
                        name: '21:9'
                    },
                    {
                        label: 'adaptive',
                        name: 'adaptive'
                    }
                ],
                default: DEFAULT_DOUBAO_VIDEO_RATIO,
                optional: true,
                additionalParams: true
            },
            {
                label: 'Default Duration',
                name: 'duration',
                type: 'number',
                default: DEFAULT_DOUBAO_VIDEO_DURATION,
                optional: true,
                additionalParams: true
            },
            {
                label: 'Default Seed',
                name: 'seed',
                type: 'number',
                optional: true,
                additionalParams: true
            },
            {
                label: 'Default Camera Fixed',
                name: 'cameraFixed',
                type: 'boolean',
                default: DEFAULT_DOUBAO_VIDEO_CAMERA_FIXED,
                optional: true,
                additionalParams: true
            },
            {
                label: 'Default Watermark',
                name: 'watermark',
                type: 'boolean',
                default: DEFAULT_DOUBAO_VIDEO_WATERMARK,
                optional: true,
                additionalParams: true
            }
        ]
    }

    loadMethods = {
        async listModels(): Promise<INodeOptionsValue[]> {
            return await getModels(MODEL_TYPE.MEDIA, 'doubaoVideo')
        }
    }

    transformNodeInputsToToolArgs(nodeData: INodeData): Record<string, unknown> {
        const nodeInputs: Record<string, unknown> = {}

        if (nodeData.inputs?.resolution) nodeInputs.resolution = nodeData.inputs.resolution
        if (nodeData.inputs?.ratio) nodeInputs.ratio = nodeData.inputs.ratio
        if (nodeData.inputs?.duration !== undefined) nodeInputs.duration = nodeData.inputs.duration
        if (nodeData.inputs?.seed !== undefined) nodeInputs.seed = nodeData.inputs.seed
        if (nodeData.inputs?.cameraFixed !== undefined) nodeInputs.cameraFixed = nodeData.inputs.cameraFixed
        if (nodeData.inputs?.watermark !== undefined) nodeInputs.watermark = nodeData.inputs.watermark

        return nodeInputs
    }

    async init(nodeData: INodeData, _: string, options: ICommonObject): Promise<any> {
        const model = (nodeData.inputs?.model as string)?.trim() || DEFAULT_DOUBAO_VIDEO_MODEL
        const ratio = normalizeDoubaoVideoRatio(nodeData.inputs?.ratio as string) || DEFAULT_DOUBAO_VIDEO_RATIO
        const resolution = normalizeDoubaoVideoResolution(nodeData.inputs?.resolution as string) || DEFAULT_DOUBAO_VIDEO_RESOLUTION
        const duration =
            typeof nodeData.inputs?.duration === 'number'
                ? (nodeData.inputs?.duration as number)
                : Number(nodeData.inputs?.duration) || DEFAULT_DOUBAO_VIDEO_DURATION
        const seed =
            typeof nodeData.inputs?.seed === 'number'
                ? (nodeData.inputs?.seed as number)
                : nodeData.inputs?.seed !== undefined && nodeData.inputs?.seed !== null && `${nodeData.inputs?.seed}`.trim()
                ? Number(nodeData.inputs?.seed)
                : undefined
        const cameraFixed =
            typeof nodeData.inputs?.cameraFixed === 'boolean'
                ? (nodeData.inputs?.cameraFixed as boolean)
                : DEFAULT_DOUBAO_VIDEO_CAMERA_FIXED
        const watermark =
            typeof nodeData.inputs?.watermark === 'boolean' ? (nodeData.inputs?.watermark as boolean) : DEFAULT_DOUBAO_VIDEO_WATERMARK

        const credentialData = await getCredentialData(nodeData.credential ?? '', { ...options, tokenAuditContext: undefined })
        const arkApiKey = getCredentialParam('arkApiKey', credentialData, nodeData)
        const baseUrl = getCredentialParam('baseUrl', credentialData, nodeData, DEFAULT_DOUBAO_ARK_BASE_URL)

        const defaultParams = this.transformNodeInputsToToolArgs(nodeData)
        const mediaModel = new DoubaoVideoModel({
            apiKey: arkApiKey,
            credentialId: nodeData.credential,
            baseUrl,
            model,
            ratio,
            resolution,
            duration,
            ...(typeof seed === 'number' && Number.isFinite(seed) ? { seed } : {}),
            cameraFixed,
            watermark,
            chatflowid: options.chatflowid,
            orgId: options.orgId
        })

        return createDoubaoVideoTools({
            defaultParams,
            mediaModel
        })
    }
}

module.exports = { nodeClass: DoubaoVideoTool_Tools }
