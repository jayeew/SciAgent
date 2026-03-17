import { ChatOpenAI as LangchainChatOpenAI, ChatOpenAIFields } from '@langchain/openai'
import { IMultiModalOption, IVisionChatModal } from '../../../src'

export class ChatKimi extends LangchainChatOpenAI implements IVisionChatModal {
    configuredModel: string
    configuredMaxToken?: number
    multiModalOption: IMultiModalOption
    builtInTools: Record<string, any>[] = []
    id: string

    constructor(id: string, fields?: ChatOpenAIFields) {
        super(fields)
        this.id = id
        this.configuredModel = fields?.modelName ?? ''
        this.configuredMaxToken = fields?.maxCompletionTokens ?? fields?.maxTokens
    }

    revertToOriginalModel(): void {
        this.model = this.configuredModel
        this.maxTokens = this.configuredMaxToken
    }

    setMultiModalOption(multiModalOption: IMultiModalOption): void {
        this.multiModalOption = multiModalOption
    }

    setVisionModel(): void {
        // pass
    }

    addBuiltInTools(builtInTool: Record<string, any>): void {
        this.builtInTools.push(builtInTool)
    }

    invocationParams(options?: this['ParsedCallOptions']): ReturnType<LangchainChatOpenAI['invocationParams']> {
        const params = super.invocationParams(options) as ReturnType<LangchainChatOpenAI['invocationParams']> & Record<string, any>

        delete params.max_tokens
        if (this.configuredMaxToken !== undefined) {
            params.max_completion_tokens = this.configuredMaxToken === -1 ? undefined : this.configuredMaxToken
        }
        if (this.configuredModel.startsWith('kimi-k2.5')) {
            delete params.temperature
            delete params.top_p
            delete params.frequency_penalty
            delete params.presence_penalty
            delete params.n
        }

        return params
    }
}
