import { BaseCache } from '@langchain/core/caches'
import { ChatOpenAI, ChatOpenAIFields } from '@langchain/openai'
import { ICommonObject, INode, INodeData, INodeOptionsValue, INodeParams } from '../../../src/Interface'
import { getModels, MODEL_TYPE } from '../../../src/modelLoader'
import { getBaseClasses, getCredentialData, getCredentialParam } from '../../../src/utils'

class ChatAlibabaTongyi_ChatModels implements INode {
    readonly baseURL: string = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
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
        this.label = 'ChatAlibabaTongyi'
        this.name = 'chatAlibabaTongyi'
        this.version = 2.0
        this.type = 'ChatAlibabaTongyi'
        this.icon = 'alibaba-svgrepo-com.svg'
        this.category = 'Chat Models'
        this.description = 'Wrapper around Alibaba Tongyi Chat Endpoints'
        this.baseClasses = [this.type, ...getBaseClasses(ChatOpenAI)]
        this.credential = {
            label: 'Connect Credential',
            name: 'credential',
            type: 'credential',
            credentialNames: ['AlibabaApi']
        }
        this.inputs = [
            {
                label: 'Cache',
                name: 'cache',
                type: 'BaseCache',
                optional: true
            },
            {
                label: 'Model',
                name: 'modelName',
                type: 'asyncOptions',
                loadMethod: 'listModels',
                default: 'qwen-plus'
            },
            {
                label: 'Temperature',
                name: 'temperature',
                type: 'number',
                step: 0.1,
                default: 0.9,
                optional: true
            },
            {
                label: 'Streaming',
                name: 'streaming',
                type: 'boolean',
                default: true,
                optional: true
            }
        ]
    }

    loadMethods = {
        async listModels(): Promise<INodeOptionsValue[]> {
            return await getModels(MODEL_TYPE.CHAT, 'chatAlibabaTongyi')
        }
    }

    async init(nodeData: INodeData, _: string, options: ICommonObject): Promise<any> {
        const cache = nodeData.inputs?.cache as BaseCache
        const temperature = nodeData.inputs?.temperature as string
        const modelName = nodeData.inputs?.modelName as string
        const streaming = nodeData.inputs?.streaming as boolean

        const credentialData = await getCredentialData(nodeData.credential ?? '', options)
        const alibabaApiKey = getCredentialParam('alibabaApiKey', credentialData, nodeData)

        const obj: ChatOpenAIFields = {
            streaming: streaming ?? true,
            modelName,
            openAIApiKey: alibabaApiKey,
            apiKey: alibabaApiKey,
            temperature: temperature ? parseFloat(temperature) : undefined,
            configuration: {
                baseURL: this.baseURL
            }
        }
        if (cache) obj.cache = cache

        return new ChatOpenAI(obj)
    }
}

module.exports = { nodeClass: ChatAlibabaTongyi_ChatModels }
