import { INode, INodeParams } from '../../../src/Interface'

class Alibaba_SpeechToText implements INode {
    label: string
    name: string
    version: number
    description: string
    type: string
    icon: string
    category: string
    baseClasses: string[]
    inputs?: INodeParams[]
    credential: INodeParams

    constructor() {
        this.label = 'Alibaba STT'
        this.name = 'alibabaSTT'
        this.version = 1.0
        this.type = 'AlibabaSTT'
        this.icon = 'alibaba-svgrepo-com.svg'
        this.category = 'SpeechToText'
        this.baseClasses = [this.type]
        this.inputs = [
            {
                label: 'Model',
                name: 'model',
                type: 'string',
                description: 'Alibaba ASR model name.',
                default: 'qwen3-asr-flash',
                optional: true
            },
            {
                label: 'Base URL',
                name: 'baseUrl',
                type: 'string',
                description:
                    'DashScope OpenAI-compatible endpoint. For Singapore region, use https://dashscope-intl.aliyuncs.com/compatible-mode/v1.',
                default: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
                optional: true
            },
            {
                label: 'Language',
                name: 'language',
                type: 'string',
                description: 'Optional language hint for ASR.',
                placeholder: 'zh',
                optional: true
            },
            {
                label: 'Enable ITN',
                name: 'enableItn',
                type: 'boolean',
                description: 'Enable inverse text normalization in Alibaba ASR options.',
                default: false,
                optional: true
            }
        ]
        this.credential = {
            label: 'Connect Credential',
            name: 'credential',
            type: 'credential',
            credentialNames: ['alibabaSTTApi']
        }
    }
}

module.exports = { nodeClass: Alibaba_SpeechToText }
