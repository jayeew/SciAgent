import { ICommonObject, IFileUpload } from './Interface'
import { getCredentialData } from './utils'
import { type ClientOptions, OpenAIClient, toFile } from '@langchain/openai'
import { AssemblyAI } from 'assemblyai'
import { getFileFromStorage } from './storageUtils'
import axios from 'axios'
import Groq from 'groq-sdk'
import OpenAI from 'openai'

const SpeechToTextType = {
    OPENAI_WHISPER: 'openAIWhisper',
    ASSEMBLYAI_TRANSCRIBE: 'assemblyAiTranscribe',
    LOCALAI_STT: 'localAISTT',
    AZURE_COGNITIVE: 'azureCognitive',
    GROQ_WHISPER: 'groqWhisper',
    ALIBABA_STT: 'alibabaSTT'
}

const ASSEMBLYAI_SPEECH_MODELS = ['universal-3-pro', 'universal-2'] as const
type AssemblyAISpeechModel = (typeof ASSEMBLYAI_SPEECH_MODELS)[number]

const parseAssemblyAISpeechModel = (value: unknown): AssemblyAISpeechModel | undefined => {
    if (Array.isArray(value)) {
        const firstModel = value.find((model) => typeof model === 'string' && model.trim())
        if (typeof firstModel === 'string') {
            return parseAssemblyAISpeechModel(firstModel)
        }
        return undefined
    }

    if (typeof value !== 'string') {
        return undefined
    }

    const candidates = value
        .split(',')
        .map((model) => model.trim())
        .filter(Boolean)
    const validModel = candidates.find((model) => ASSEMBLYAI_SPEECH_MODELS.includes(model as AssemblyAISpeechModel))
    return validModel as AssemblyAISpeechModel | undefined
}

const parseAlibabaSpeechContent = (content: unknown): string => {
    if (typeof content === 'string') {
        return content.trim()
    }

    if (Array.isArray(content)) {
        const text = content
            .map((part) => {
                if (typeof part === 'string') return part
                if (!part || typeof part !== 'object') return ''

                if (typeof (part as { text?: unknown }).text === 'string') {
                    return (part as { text: string }).text
                }
                return ''
            })
            .join('')
            .trim()

        return text
    }

    return ''
}

const appendTokenUsagePayload = (tokenAuditContext: ICommonObject | undefined, payload: ICommonObject) => {
    if (!tokenAuditContext) return

    if (!Array.isArray(tokenAuditContext.tokenUsagePayloads)) {
        tokenAuditContext.tokenUsagePayloads = []
    }
    tokenAuditContext.tokenUsagePayloads.push(payload)
}

export interface ISpeechToTextResult {
    text: string
    provider: string
    credentialId?: string
    model?: string
    usage?: {
        seconds?: number
    }
}

export const convertSpeechToText = async (
    upload: IFileUpload,
    speechToTextConfig: ICommonObject,
    options: ICommonObject
): Promise<ISpeechToTextResult | undefined> => {
    if (speechToTextConfig) {
        const credentialId = speechToTextConfig.credentialId as string
        const credentialData = await getCredentialData(credentialId ?? '', options)
        const tokenAuditContext = options.tokenAuditContext as ICommonObject | undefined
        const audio_file = await getFileFromStorage(upload.name, options.orgId, options.chatflowid, options.chatId)

        switch (speechToTextConfig.name) {
            case SpeechToTextType.OPENAI_WHISPER: {
                const openAIClientOptions: ClientOptions = {
                    apiKey: credentialData.openAIApiKey
                }
                const openAIClient = new OpenAIClient(openAIClientOptions)
                const file = await toFile(audio_file, upload.name)
                const openAITranscription = await openAIClient.audio.transcriptions.create({
                    file: file,
                    model: 'whisper-1',
                    language: speechToTextConfig?.language,
                    temperature: speechToTextConfig?.temperature ? parseFloat(speechToTextConfig.temperature) : undefined,
                    prompt: speechToTextConfig?.prompt
                })
                if (openAITranscription?.text) {
                    return {
                        text: openAITranscription.text,
                        provider: SpeechToTextType.OPENAI_WHISPER,
                        credentialId,
                        model: 'whisper-1'
                    }
                }
                break
            }
            case SpeechToTextType.ASSEMBLYAI_TRANSCRIBE: {
                const assemblyAIClient = new AssemblyAI({
                    apiKey: credentialData.assemblyAIApiKey
                })

                const speechModel =
                    parseAssemblyAISpeechModel(speechToTextConfig?.speechModels) ??
                    parseAssemblyAISpeechModel(credentialData?.assemblyAISpeechModels) ??
                    'universal-3-pro'

                const params = {
                    audio: audio_file,
                    speaker_labels: false,
                    language_detection: true,
                    speech_models: [speechModel]
                }

                const assemblyAITranscription = await assemblyAIClient.transcripts.transcribe(params)
                if (assemblyAITranscription?.text) {
                    return {
                        text: assemblyAITranscription.text,
                        provider: SpeechToTextType.ASSEMBLYAI_TRANSCRIBE,
                        credentialId,
                        model: speechModel
                    }
                }
                break
            }
            case SpeechToTextType.LOCALAI_STT: {
                const LocalAIClientOptions: ClientOptions = {
                    apiKey: credentialData.localAIApiKey,
                    baseURL: speechToTextConfig?.baseUrl
                }
                const localAIClient = new OpenAIClient(LocalAIClientOptions)
                const file = await toFile(audio_file, upload.name)
                const modelName = speechToTextConfig?.model || 'whisper-1'
                const localAITranscription = await localAIClient.audio.transcriptions.create({
                    file: file,
                    model: modelName,
                    language: speechToTextConfig?.language,
                    temperature: speechToTextConfig?.temperature ? parseFloat(speechToTextConfig.temperature) : undefined,
                    prompt: speechToTextConfig?.prompt
                })
                if (localAITranscription?.text) {
                    return {
                        text: localAITranscription.text,
                        provider: SpeechToTextType.LOCALAI_STT,
                        credentialId,
                        model: modelName
                    }
                }
                break
            }
            case SpeechToTextType.AZURE_COGNITIVE: {
                try {
                    const baseUrl = `https://${credentialData.serviceRegion}.cognitiveservices.azure.com/speechtotext/transcriptions:transcribe`
                    const apiVersion = credentialData.apiVersion || '2024-05-15-preview'

                    const formData = new FormData()
                    const audioBlob = new Blob([audio_file], { type: upload.type })
                    formData.append('audio', audioBlob, upload.name)

                    const channelsStr = speechToTextConfig.channels || '0,1'
                    const channels = channelsStr.split(',').map(Number)

                    const definition = {
                        locales: [speechToTextConfig.language || 'en-US'],
                        profanityFilterMode: speechToTextConfig.profanityFilterMode || 'Masked',
                        channels
                    }
                    formData.append('definition', JSON.stringify(definition))

                    const response = await axios.post(`${baseUrl}?api-version=${apiVersion}`, formData, {
                        headers: {
                            'Ocp-Apim-Subscription-Key': credentialData.azureSubscriptionKey,
                            Accept: 'application/json'
                        }
                    })

                    if (response.data && response.data.combinedPhrases.length > 0) {
                        return {
                            text: response.data.combinedPhrases[0]?.text || '',
                            provider: SpeechToTextType.AZURE_COGNITIVE,
                            credentialId,
                            model: 'azure-cognitive-stt'
                        }
                    }
                    return {
                        text: '',
                        provider: SpeechToTextType.AZURE_COGNITIVE,
                        credentialId,
                        model: 'azure-cognitive-stt'
                    }
                } catch (error) {
                    throw error.response?.data || error
                }
            }
            case SpeechToTextType.GROQ_WHISPER: {
                const groqClient = new Groq({
                    apiKey: credentialData.groqApiKey
                })
                const file = await toFile(audio_file, upload.name)
                const modelName = speechToTextConfig?.model || 'whisper-large-v3'
                const groqTranscription = await groqClient.audio.transcriptions.create({
                    file,
                    model: modelName,
                    language: speechToTextConfig?.language,
                    temperature: speechToTextConfig?.temperature ? parseFloat(speechToTextConfig.temperature) : undefined,
                    response_format: 'verbose_json'
                })
                if (groqTranscription?.text) {
                    return {
                        text: groqTranscription.text,
                        provider: SpeechToTextType.GROQ_WHISPER,
                        credentialId,
                        model: modelName
                    }
                }
                break
            }
            case SpeechToTextType.ALIBABA_STT: {
                const baseURL = speechToTextConfig?.baseUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1'
                const alibabaClient = new OpenAI({
                    apiKey: credentialData.alibabaApiKey,
                    baseURL
                })

                const mimeType = upload.mime || 'audio/mpeg'
                const dataUri = `data:${mimeType};base64,${audio_file.toString('base64')}`
                const modelName = speechToTextConfig?.model || 'qwen3-asr-flash'

                const asrOptions: ICommonObject = {
                    enable_itn: speechToTextConfig?.enableItn ?? false
                }
                if (speechToTextConfig?.language) {
                    asrOptions.language = speechToTextConfig.language
                }

                const completion = await alibabaClient.chat.completions.create({
                    model: modelName,
                    messages: [
                        {
                            role: 'user',
                            content: [
                                {
                                    type: 'input_audio',
                                    input_audio: {
                                        data: dataUri
                                    }
                                }
                            ]
                        }
                    ],
                    stream: false,
                    extra_body: {
                        asr_options: asrOptions
                    }
                } as any)

                const content = completion?.choices?.[0]?.message?.content
                const transcript = parseAlibabaSpeechContent(content)
                if (transcript) {
                    const usageSeconds = Number((completion as ICommonObject)?.usage?.seconds)
                    const normalizedUsageSeconds = Number.isFinite(usageSeconds) && usageSeconds >= 0 ? usageSeconds : 0
                    const promptTokens = Number((completion as ICommonObject)?.usage?.prompt_tokens) || 0
                    const completionTokens = Number((completion as ICommonObject)?.usage?.completion_tokens) || 0
                    const totalTokens = Number((completion as ICommonObject)?.usage?.total_tokens) || 0

                    appendTokenUsagePayload(tokenAuditContext, {
                        usage: {
                            ...(completion as ICommonObject)?.usage,
                            seconds: normalizedUsageSeconds
                        },
                        model: modelName,
                        provider: SpeechToTextType.ALIBABA_STT,
                        source: 'speech_to_text'
                    })
                    if (Array.isArray(tokenAuditContext?.credentialAccesses)) {
                        const matchedAccess = [...tokenAuditContext.credentialAccesses]
                            .reverse()
                            .find((access: ICommonObject) => access?.credentialId === credentialId)
                        if (matchedAccess && !matchedAccess.model) {
                            matchedAccess.model = modelName
                        }
                    }

                    console.info(
                        `[speech-to-text][alibaba] completionId=${
                            (completion as ICommonObject)?.id || '-'
                        } model=${modelName} seconds=${normalizedUsageSeconds} promptTokens=${promptTokens} completionTokens=${completionTokens} totalTokens=${totalTokens} transcriptLength=${
                            transcript.length
                        }`
                    )

                    return {
                        text: transcript,
                        provider: SpeechToTextType.ALIBABA_STT,
                        credentialId,
                        model: modelName,
                        usage: {
                            seconds: normalizedUsageSeconds
                        }
                    }
                }
                break
            }
        }
    } else {
        throw new Error('Speech to text is not selected, but found a recorded audio file. Please fix the chain.')
    }
    return undefined
}
