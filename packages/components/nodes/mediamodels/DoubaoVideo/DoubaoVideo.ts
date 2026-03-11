import { ICommonObject, INode, INodeData, INodeOptionsValue, INodeParams } from '../../../src/Interface'
import { getModels, MODEL_TYPE } from '../../../src/modelLoader'
import { getBaseClasses, getCredentialData, getCredentialParam } from '../../../src/utils'
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
} from './core'

class DoubaoVideo_MediaModels implements INode {
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
        this.label = 'Doubao Video'
        this.name = 'doubaoVideo'
        this.version = 1.0
        this.type = 'DoubaoVideo'
        this.icon = 'doubao.svg'
        this.category = 'Media Models'
        this.description = 'Generate videos with Doubao Ark from conversational prompts'
        this.baseClasses = Array.from(new Set([this.type, ...getBaseClasses(DoubaoVideoModel), 'Runnable']))
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
                default: DEFAULT_DOUBAO_VIDEO_MODEL
            },
            {
                label: 'Default Ratio',
                name: 'ratio',
                type: 'string',
                default: DEFAULT_DOUBAO_VIDEO_RATIO,
                optional: true,
                additionalParams: true,
                description: 'Pass aspect ratio to Doubao Ark, for example 16:9'
            },
            {
                label: 'Default Resolution',
                name: 'resolution',
                type: 'string',
                default: DEFAULT_DOUBAO_VIDEO_RESOLUTION,
                optional: true,
                additionalParams: true,
                description: 'Pass resolution to Doubao Ark, for example 720p'
            },
            {
                label: 'Default Duration',
                name: 'duration',
                type: 'number',
                default: DEFAULT_DOUBAO_VIDEO_DURATION,
                optional: true,
                additionalParams: true,
                description: 'Video duration in seconds. Either duration or frames is required by Doubao Ark.'
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

        const credentialData = await getCredentialData(nodeData.credential ?? '', options)
        const arkApiKey = getCredentialParam('arkApiKey', credentialData, nodeData)
        const baseUrl = getCredentialParam('baseUrl', credentialData, nodeData, DEFAULT_DOUBAO_ARK_BASE_URL)

        return new DoubaoVideoModel({
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
    }
}

module.exports = { nodeClass: DoubaoVideo_MediaModels }
