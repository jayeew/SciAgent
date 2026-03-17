import { BaseCache } from '@langchain/core/caches'
import { ChatOpenAI as LangchainChatOpenAI, ChatOpenAIFields } from '@langchain/openai'
import { ICommonObject, IMultiModalOption, INode, INodeData, INodeOptionsValue, INodeParams } from '../../../src/Interface'
import { getModels, MODEL_TYPE } from '../../../src/modelLoader'
import { getBaseClasses, getCredentialData, getCredentialParam } from '../../../src/utils'
import { ChatKimi } from './FlowiseChatKimi'

const KIMI_VISION_MODEL_REGEX = /^(kimi-k2\.5|moonshot-v1-(8k|32k|128k)-vision-preview)$/

const isKimiVisionModel = (modelName: string) => KIMI_VISION_MODEL_REGEX.test(modelName)
const isKimiK25Model = (modelName: string) => modelName.startsWith('kimi-k2.5')

class ChatKimi_ChatModels implements INode {
    readonly baseURL: string = 'https://api.moonshot.cn/v1'
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
        this.label = 'ChatKimi'
        this.name = 'chatKimi'
        this.version = 1.0
        this.type = 'ChatKimi'
        this.icon = 'moonshot.svg'
        this.category = 'Chat Models'
        this.description = 'Wrapper around Moonshot Kimi chat models'
        this.baseClasses = [this.type, ...getBaseClasses(LangchainChatOpenAI)]
        this.credential = {
            label: 'Connect Credential',
            name: 'credential',
            type: 'credential',
            credentialNames: ['moonshotApi']
        }
        this.inputs = [
            {
                label: 'Cache',
                name: 'cache',
                type: 'BaseCache',
                optional: true
            },
            {
                label: 'Model Name',
                name: 'modelName',
                type: 'asyncOptions',
                loadMethod: 'listModels',
                default: 'kimi-k2.5'
            },
            {
                label: 'Temperature',
                name: 'temperature',
                type: 'number',
                step: 0.1,
                default: 0.6,
                optional: true,
                hide: {
                    modelName: '^kimi-k2\\.5$'
                }
            },
            {
                label: 'Streaming',
                name: 'streaming',
                type: 'boolean',
                default: true,
                optional: true,
                additionalParams: true
            },
            {
                label: 'Max Tokens',
                name: 'maxTokens',
                type: 'number',
                step: 1,
                optional: true,
                additionalParams: true
            },
            {
                label: 'Top Probability',
                name: 'topP',
                type: 'number',
                step: 0.1,
                optional: true,
                additionalParams: true,
                hide: {
                    modelName: '^kimi-k2\\.5$'
                }
            },
            {
                label: 'Frequency Penalty',
                name: 'frequencyPenalty',
                type: 'number',
                step: 0.1,
                optional: true,
                additionalParams: true,
                hide: {
                    modelName: '^kimi-k2\\.5$'
                }
            },
            {
                label: 'Presence Penalty',
                name: 'presencePenalty',
                type: 'number',
                step: 0.1,
                optional: true,
                additionalParams: true,
                hide: {
                    modelName: '^kimi-k2\\.5$'
                }
            },
            {
                label: 'Timeout',
                name: 'timeout',
                type: 'number',
                step: 1,
                optional: true,
                additionalParams: true
            },
            {
                label: 'Stop Sequence',
                name: 'stopSequence',
                type: 'string',
                rows: 4,
                optional: true,
                description: 'List of stop words to use when generating. Use comma to separate multiple stop words.',
                additionalParams: true
            },
            {
                label: 'Base Options',
                name: 'baseOptions',
                type: 'json',
                optional: true,
                additionalParams: true,
                description: 'Additional options to pass to the Moonshot client. This should be a JSON object.'
            },
            {
                label: 'Allow Image Uploads',
                name: 'allowImageUploads',
                type: 'boolean',
                description:
                    'Allow image input. Refer to the <a href="https://docs.flowiseai.com/using-flowise/uploads#image" target="_blank">docs</a> for more details.',
                default: false,
                optional: true,
                show: {
                    modelName: '^(kimi-k2\\.5|moonshot-v1-(8k|32k|128k)-vision-preview)$'
                }
            }
        ]
    }

    loadMethods = {
        async listModels(): Promise<INodeOptionsValue[]> {
            return await getModels(MODEL_TYPE.CHAT, 'chatKimi')
        }
    }

    async init(nodeData: INodeData, _: string, options: ICommonObject): Promise<any> {
        const cache = nodeData.inputs?.cache as BaseCache
        const temperature = nodeData.inputs?.temperature as string
        const modelName = nodeData.inputs?.modelName as string
        const maxTokens = nodeData.inputs?.maxTokens as string
        const topP = nodeData.inputs?.topP as string
        const frequencyPenalty = nodeData.inputs?.frequencyPenalty as string
        const presencePenalty = nodeData.inputs?.presencePenalty as string
        const timeout = nodeData.inputs?.timeout as string
        const stopSequence = nodeData.inputs?.stopSequence as string
        const streaming = nodeData.inputs?.streaming as boolean
        const allowImageUploads = nodeData.inputs?.allowImageUploads as boolean
        const baseOptions = nodeData.inputs?.baseOptions

        if (nodeData.inputs?.credentialId) {
            nodeData.credential = nodeData.inputs?.credentialId
        }

        const credentialData = await getCredentialData(nodeData.credential ?? '', options)
        const moonshotApiKey = getCredentialParam('moonshotApiKey', credentialData, nodeData)

        const obj: ChatOpenAIFields = {
            modelName,
            openAIApiKey: moonshotApiKey,
            apiKey: moonshotApiKey,
            streaming: streaming ?? true,
            configuration: {
                baseURL: this.baseURL
            }
        }

        if (!isKimiK25Model(modelName) && temperature) obj.temperature = parseFloat(temperature)
        if (maxTokens) obj.maxCompletionTokens = parseInt(maxTokens, 10)
        if (!isKimiK25Model(modelName) && topP) obj.topP = parseFloat(topP)
        if (!isKimiK25Model(modelName) && frequencyPenalty) obj.frequencyPenalty = parseFloat(frequencyPenalty)
        if (!isKimiK25Model(modelName) && presencePenalty) obj.presencePenalty = parseFloat(presencePenalty)
        if (timeout) obj.timeout = parseInt(timeout, 10)
        if (cache) obj.cache = cache
        if (stopSequence) {
            obj.stop = stopSequence.split(',').map((item) => item.trim())
        }

        let parsedBaseOptions: Record<string, any> | undefined = undefined

        if (baseOptions) {
            try {
                const resolvedBaseOptions =
                    typeof baseOptions === 'object' && baseOptions !== null ? (baseOptions as Record<string, any>) : JSON.parse(baseOptions)

                if (resolvedBaseOptions.baseURL) {
                    console.warn("The 'baseURL' parameter is not allowed when using the ChatKimi node.")
                    resolvedBaseOptions.baseURL = undefined
                }

                parsedBaseOptions = resolvedBaseOptions
            } catch (exception) {
                throw new Error('Invalid JSON in the ChatKimi Base Options: ' + exception)
            }
        }

        if (parsedBaseOptions) {
            obj.configuration = {
                baseURL: this.baseURL,
                ...parsedBaseOptions
            }
        }

        const multiModalOption: IMultiModalOption = {
            image: {
                allowImageUploads: isKimiVisionModel(modelName) ? allowImageUploads ?? false : false,
                provider: this.name,
                modelName
            }
        }

        const model = new ChatKimi(nodeData.id, obj)
        model.setMultiModalOption(multiModalOption)
        return model
    }
}

module.exports = { nodeClass: ChatKimi_ChatModels }
