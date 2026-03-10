import { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { BaseMessage } from '@langchain/core/messages'
import { ChatPromptTemplate, HumanMessagePromptTemplate, MessagesPlaceholder, SystemMessagePromptTemplate } from '@langchain/core/prompts'
import { RunnableLambda } from '@langchain/core/runnables'
import { ConsoleCallbackHandler as LCConsoleCallbackHandler } from '@langchain/core/tracers/console'
import { BaseMediaModel, IMediaGenerationInput, IMediaGenerationResult } from '../../../src/mediaModels'
import { FlowiseMemory, ICommonObject, INode, INodeData, INodeParams, IServerSideEventStreamer } from '../../../src/Interface'
import { additionalCallbacks, ConsoleCallbackHandler } from '../../../src/handler'
import { extractOutputFromArray, getBaseClasses, parseJsonBody, transformBracesWithColon } from '../../../src/utils'
import { checkInputs, Moderation, streamResponse } from '../../moderation/Moderation'
import { formatResponse } from '../../outputparsers/OutputParserHelpers'

const DEFAULT_PROMPT_REFINER_SYSTEM_MESSAGE =
    'You convert a multi-turn conversation into a structured request for an image generation model.'

const FOLLOW_UP_PROMPT_REGEX =
    /\b(make|change|modify|turn|add|remove|keep|same|variation|version|based on|using the previous|previous image)\b|改成|换成|修改|调整|再来|上一张|上一个|保留|基于/i

const PROMPT_MEMORY_MARKER = 'Prompt:'

const stripCodeFence = (value: string): string =>
    value
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim()

const normalizePromptRefinerOutput = (value: string): Partial<IMediaGenerationInput> | null => {
    const normalizedValue = stripCodeFence(value)
    if (!normalizedValue) return null

    try {
        const parsedValue = parseJsonBody(normalizedValue)
        if (typeof parsedValue !== 'object' || parsedValue === null) return null

        const prompt = typeof parsedValue.prompt === 'string' ? parsedValue.prompt.trim() : ''
        const size = typeof parsedValue.size === 'string' ? parsedValue.size.trim() : undefined
        const outputFormat =
            typeof parsedValue.outputFormat === 'string' && ['png', 'jpeg', 'jpg'].includes(parsedValue.outputFormat.trim().toLowerCase())
                ? (parsedValue.outputFormat.trim().toLowerCase() as 'png' | 'jpeg' | 'jpg')
                : undefined
        const watermark =
            typeof parsedValue.watermark === 'boolean'
                ? parsedValue.watermark
                : typeof parsedValue.watermark === 'string'
                ? parsedValue.watermark.toLowerCase() === 'true'
                    ? true
                    : parsedValue.watermark.toLowerCase() === 'false'
                    ? false
                    : undefined
                : undefined

        if (!prompt) return null

        return {
            prompt,
            ...(size ? { size } : {}),
            ...(outputFormat ? { outputFormat } : {}),
            ...(typeof watermark === 'boolean' ? { watermark } : {})
        }
    } catch (error) {
        return {
            prompt: normalizedValue
        }
    }
}

const extractPromptFromHistory = (history: BaseMessage[]): string | undefined => {
    for (let index = history.length - 1; index >= 0; index -= 1) {
        const message = history[index]
        const content = extractOutputFromArray((message as any).content)
        if (!content || typeof content !== 'string') continue

        const promptIndex = content.lastIndexOf(PROMPT_MEMORY_MARKER)
        if (promptIndex === -1) continue

        const prompt = content
            .slice(promptIndex + PROMPT_MEMORY_MARKER.length)
            .trim()
            .replace(/\.$/, '')

        if (prompt) {
            return prompt
        }
    }

    return undefined
}

const buildHeuristicMediaInput = (history: BaseMessage[], input: string): IMediaGenerationInput => {
    const normalizedInput = input.trim()
    const previousPrompt = extractPromptFromHistory(history)

    if (previousPrompt && FOLLOW_UP_PROMPT_REGEX.test(normalizedInput)) {
        return {
            prompt: `${previousPrompt}\n\nFollow-up instructions: ${normalizedInput}`
        }
    }

    return {
        prompt: normalizedInput
    }
}

const buildMemorySummary = (resolvedInput: IMediaGenerationInput, result: IMediaGenerationResult): string => {
    const imageCount = result.artifacts?.length ?? 0
    return `Generated ${imageCount} image${imageCount === 1 ? '' : 's'}. Prompt: ${resolvedInput.prompt}`
}

const resolveMediaInput = async (
    nodeData: INodeData,
    input: string,
    history: BaseMessage[],
    callbacks: any[]
): Promise<IMediaGenerationInput> => {
    const promptRefinerModel = nodeData.inputs?.promptRefinerModel as BaseChatModel | undefined
    if (!promptRefinerModel) {
        return buildHeuristicMediaInput(history, input)
    }

    const systemMessagePrompt = (nodeData.inputs?.systemMessagePrompt as string)?.trim() || DEFAULT_PROMPT_REFINER_SYSTEM_MESSAGE
    const memory = nodeData.inputs?.memory as FlowiseMemory
    const memoryKey = memory.memoryKey ?? 'chat_history'

    const prompt = ChatPromptTemplate.fromMessages([
        SystemMessagePromptTemplate.fromTemplate(transformBracesWithColon(systemMessagePrompt)),
        new MessagesPlaceholder(memoryKey),
        HumanMessagePromptTemplate.fromTemplate(
            [
                'Latest user request:',
                '{input}',
                '',
                'Return JSON only with keys prompt, size, outputFormat, watermark.',
                'Use null for values you cannot infer.',
                'The prompt must be detailed, production-ready, and preserve relevant context from prior messages.'
            ].join('\n')
        )
    ])

    const formattedMessages = await prompt.formatMessages({
        input,
        [memoryKey]: history
    })
    const response = await promptRefinerModel.invoke(formattedMessages, { callbacks })
    const refinedOutput = normalizePromptRefinerOutput(extractOutputFromArray(response.content))

    if (refinedOutput?.prompt) {
        return refinedOutput as IMediaGenerationInput
    }

    return buildHeuristicMediaInput(history, input)
}

const executeMediaConversation = async (
    nodeData: INodeData,
    input: string,
    options: ICommonObject,
    sessionId?: string,
    callbacks: any[] = []
): Promise<{ resolvedInput: IMediaGenerationInput; result: IMediaGenerationResult }> => {
    const mediaModel = nodeData.inputs?.mediaModel as BaseMediaModel
    const memory = nodeData.inputs?.memory as FlowiseMemory
    const prependMessages = options?.prependMessages
    const history = memory ? ((await memory.getChatMessages(sessionId, true, prependMessages)) as BaseMessage[]) ?? [] : []

    const resolvedInput = await resolveMediaInput(nodeData, input, history, callbacks)
    const result = await mediaModel.invoke(
        {
            ...resolvedInput,
            conversationContext: history
        },
        options
    )

    return {
        resolvedInput,
        result
    }
}

const prepareMediaRunnable = (nodeData: INodeData, options: ICommonObject, sessionId?: string) =>
    RunnableLambda.from(async (input: { input: string }) => {
        const execution = await executeMediaConversation(nodeData, input.input, options, sessionId)
        return execution.result
    })

class MediaConversationChain_Chains implements INode {
    label: string
    name: string
    version: number
    type: string
    icon: string
    category: string
    baseClasses: string[]
    description: string
    inputs: INodeParams[]
    sessionId?: string

    constructor(fields?: { sessionId?: string }) {
        this.label = 'Media Conversation Chain'
        this.name = 'mediaConversationChain'
        this.version = 1.0
        this.type = 'MediaConversationChain'
        this.icon = 'conv.svg'
        this.category = 'Chains'
        this.description = 'Conversational chain for media models that returns text and image artifacts'
        this.baseClasses = Array.from(new Set([this.type, 'BaseChain', ...getBaseClasses(RunnableLambda)]))
        this.inputs = [
            {
                label: 'Media Model',
                name: 'mediaModel',
                type: 'BaseMediaModel'
            },
            {
                label: 'Memory',
                name: 'memory',
                type: 'BaseMemory'
            },
            {
                label: 'Prompt Refiner Model',
                name: 'promptRefinerModel',
                type: 'BaseChatModel',
                optional: true
            },
            {
                label: 'Prompt Refiner System Message',
                name: 'systemMessagePrompt',
                type: 'string',
                rows: 4,
                optional: true,
                additionalParams: true,
                default: DEFAULT_PROMPT_REFINER_SYSTEM_MESSAGE,
                show: {
                    promptRefinerModel: '.+'
                }
            },
            {
                label: 'Input Moderation',
                description: 'Detect text that could generate harmful output and prevent it from being sent to the media model',
                name: 'inputModeration',
                type: 'Moderation',
                optional: true,
                list: true
            }
        ]
        this.sessionId = fields?.sessionId
    }

    async init(nodeData: INodeData, _: string, options: ICommonObject): Promise<any> {
        return prepareMediaRunnable(nodeData, options, this.sessionId)
    }

    async run(nodeData: INodeData, input: string, options: ICommonObject): Promise<string | object> {
        const memory = nodeData.inputs?.memory as FlowiseMemory
        const promptRefinerModel = nodeData.inputs?.promptRefinerModel as BaseChatModel | undefined
        const moderations = nodeData.inputs?.inputModeration as Moderation[]

        const shouldStreamResponse = options.shouldStreamResponse
        const sseStreamer: IServerSideEventStreamer = options.sseStreamer as IServerSideEventStreamer
        const chatId = options.chatId

        if (moderations && moderations.length > 0) {
            try {
                input = await checkInputs(moderations, input)
            } catch (e) {
                await new Promise((resolve) => setTimeout(resolve, 500))
                if (options.shouldStreamResponse) {
                    streamResponse(options.sseStreamer, options.chatId, e.message)
                }
                return formatResponse(e.message)
            }
        }

        let callbacks: any[] = []
        if (promptRefinerModel) {
            const additionalCallback = await additionalCallbacks(nodeData, options)
            callbacks = options.logger
                ? [new ConsoleCallbackHandler(options.logger, options?.orgId), ...additionalCallback]
                : [...additionalCallback]

            if (process.env.DEBUG === 'true') {
                callbacks.push(new LCConsoleCallbackHandler())
            }
        }

        const { resolvedInput, result } = await executeMediaConversation(nodeData, input, options, this.sessionId, callbacks)
        const responsePayload = {
            text: result.text,
            artifacts: result.artifacts,
            metadata: result.metadata,
            mediaBilling: result.mediaBilling
        }

        if (shouldStreamResponse && result.text) {
            streamResponse(sseStreamer, chatId, result.text)
        }
        if (shouldStreamResponse && result.artifacts?.length) {
            sseStreamer.streamArtifactsEvent(chatId, result.artifacts)
        }

        if (memory?.addChatMessages) {
            await memory.addChatMessages(
                [
                    {
                        text: input,
                        type: 'userMessage'
                    },
                    {
                        text: buildMemorySummary(resolvedInput, result),
                        type: 'apiMessage'
                    }
                ],
                this.sessionId
            )
        }

        return responsePayload
    }
}

module.exports = { nodeClass: MediaConversationChain_Chains }
