import { ICommonObject } from './Interface'
import { getCredentialData } from './utils'
import OpenAI from 'openai'
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js'
import { Readable } from 'node:stream'
import type { ReadableStream } from 'node:stream/web'
import axios from 'axios'

const TextToSpeechType = {
    OPENAI_TTS: 'openai',
    ELEVEN_LABS_TTS: 'elevenlabs',
    ALIBABA_TTS: 'alibaba'
}

export interface ITextToSpeechBillingResult {
    provider: string
    credentialId?: string
    model?: string
    usage?: {
        characters?: number
    }
}

interface ITextToSpeechVoiceOption {
    id: string
    name: string
    description?: string
}

const ALIBABA_TTS_VOICES: ITextToSpeechVoiceOption[] = [
    { id: 'Cherry', name: 'Cherry', description: '阳光积极、亲切自然小姐姐（女性）' },
    { id: 'Ethan', name: 'Ethan', description: '沉稳大气、温暖治愈男声（男性）' },
    { id: 'Chelsie', name: 'Chelsie', description: '甜美活泼元气少女（女性）' },
    { id: 'Serena', name: 'Serena', description: '知性温柔、亲和女声（女性）' },
    { id: 'Dylan', name: 'Dylan', description: '温柔知性青年音（男性）' },
    { id: 'Jada', name: 'Jada', description: '活力甜美小姐姐（女性）' },
    { id: 'Sunny', name: 'Sunny', description: '活泼可爱童声（儿童）' },
    { id: 'Jessie', name: 'Jessie', description: '成熟知性的御姐音（女性）' },
    { id: 'Vincent', name: 'Vincent', description: '阳光清新的少年音（男性）' },
    { id: 'Steffi', name: 'Steffi', description: '温柔甜美、情感细腻女声（女性）' },
    { id: 'Mia', name: 'Mia', description: '温柔可人的邻家女孩（女性）' },
    { id: 'Silas', name: 'Silas', description: '沉稳知性的男青年（男性）' },
    { id: 'Fiona', name: 'Fiona', description: '轻快活泼女声（女性）' },
    { id: 'Mandy', name: 'Mandy', description: '沉稳温柔的小姐姐（女性）' },
    { id: 'Cody', name: 'Cody', description: '亲和自然小哥（男性）' },
    { id: 'Cora', name: 'Cora', description: '知性优雅小姐姐（女性）' },
    { id: 'Camilla', name: 'Camilla', description: '温柔知性女声（女性）' },
    { id: 'Brian', name: 'Brian', description: '开朗阳光男声（男性）' },
    { id: 'Anna', name: 'Anna', description: '温柔知性的姐姐（女性）' },
    { id: 'Alex', name: 'Alex', description: '阳光积极小哥（男性）' },
    { id: 'Alyssa', name: 'Alyssa', description: '成熟知性温柔姐姐（女性）' },
    { id: 'Bella', name: 'Bella', description: '甜美可爱女孩（女性）' },
    { id: 'Ben', name: 'Ben', description: '沉稳大气男声（男性）' },
    { id: 'Jonna', name: 'Jonna', description: '温暖亲切女声（女性）' },
    { id: 'Nora', name: 'Nora', description: '深情讲述女声（女性）' },
    { id: 'Aaron', name: 'Aaron', description: '磁性男声（男性）' },
    { id: 'Rana', name: 'Rana', description: '松弛自然女声（女性）' },
    { id: 'Zoe', name: 'Zoe', description: '松弛自然女声（女性）' },
    { id: 'Nova', name: 'Nova', description: '轻快活泼女声（女性）' },
    { id: 'Ellie', name: 'Ellie', description: '温柔疗愈女声（女性）' },
    { id: 'Claire', name: 'Claire', description: '清新自然女声（女性）' },
    { id: 'Luna', name: 'Luna', description: '活力元气女声（女性）' },
    { id: 'Lina', name: 'Lina', description: '知性优雅女声（女性）' },
    { id: 'Vera', name: 'Vera', description: '温暖亲和女声（女性）' },
    { id: 'Celia', name: 'Celia', description: '甜美可爱女声（女性）' },
    { id: 'Eli', name: 'Eli', description: '温和稳重青年男声（男性）' },
    { id: 'Vivienne', name: 'Vivienne', description: '温柔甜美女声（女性）' },
    { id: 'Iris', name: 'Iris', description: '沉静温柔女声（女性）' },
    { id: 'Milo', name: 'Milo', description: '俏皮可爱的男童声（儿童）' },
    { id: 'Edwin', name: 'Edwin', description: '稚嫩可爱女童声（儿童）' },
    { id: 'Adeline', name: 'Adeline', description: '优雅从容女声（女性）' },
    { id: 'Liam', name: 'Liam', description: '沉着冷静男声（男性）' },
    { id: 'Mia_v2', name: 'Mia_v2', description: '灵动活泼甜美女声（女性）' },
    { id: 'Noelle', name: 'Noelle', description: '柔和治愈女声（女性）' },
    { id: 'Sam', name: 'Sam', description: '亲切自然男声（男性）' },
    { id: 'Mona', name: 'Mona', description: '甜雅温柔女声（女性）' },
    { id: 'Mina', name: 'Mina', description: '细腻温柔女声（女性）' },
    { id: 'Sofie', name: 'Sofie', description: '温婉柔和女声（女性）' },
    { id: 'Isla', name: 'Isla', description: '清甜灵动女声（女性）' },
    { id: 'Julian', name: 'Julian', description: '稳重磁性男声（男性）' },
    { id: 'Ryan', name: 'Ryan', description: '自然轻快活泼男声（男性）' },
    { id: 'Ava', name: 'Ava', description: '自然柔美女声（女性）' },
    { id: 'Samantha', name: 'Samantha', description: '温和知性女声（女性）' },
    { id: 'Ethan_v2', name: 'Ethan_v2', description: '醇厚沉稳男声（男性）' },
    { id: 'Andrew', name: 'Andrew', description: '低沉磁性男声（男性）' },
    { id: 'Emma', name: 'Emma', description: '甜润自然女声（女性）' },
    { id: 'Lily', name: 'Lily', description: '清亮甜美女声（女性）' },
    { id: 'Harper', name: 'Harper', description: '从容沉稳女声（女性）' },
    { id: 'Keith', name: 'Keith', description: '从容稳重男声（男性）' },
    { id: 'Elara', name: 'Elara', description: '轻柔温暖女声（女性）' },
    { id: 'Orion', name: 'Orion', description: '醇厚稳重男声（男性）' },
    { id: 'Mabelle', name: 'Mabelle', description: '甜柔俏皮女声（女性）' },
    { id: 'Zane', name: 'Zane', description: '沉静平和男声（男性）' },
    { id: 'Kyra', name: 'Kyra', description: '清脆悦耳女声（女性）' },
    { id: 'Haven', name: 'Haven', description: '温柔甜美男童声（儿童）' },
    { id: 'Nia', name: 'Nia', description: '俏皮灵动女童声（儿童）' },
    { id: 'Elysia', name: 'Elysia', description: '成熟知性女声（女性）' },
    { id: 'Atlas', name: 'Atlas', description: '低沉磁性男中音（男性）' },
    { id: 'Aster', name: 'Aster', description: '萌甜柔美女童声（儿童）' },
    { id: 'Phoenix', name: 'Phoenix', description: '稳健磁性男声（男性）' },
    { id: 'Leah', name: 'Leah', description: '清柔温和女声（女性）' },
    { id: 'Mila', name: 'Mila', description: '甜美温柔女声（女性）' },
    { id: 'Elliot', name: 'Elliot', description: '柔和细腻男声（男性）' },
    { id: 'Eldric Sage', name: 'Eldric Sage', description: '睿智沉稳、温柔治愈男声（男性）' },
    { id: 'Celeste', name: 'Celeste', description: '悠然优雅、自然轻快女声（女性）' },
    { id: 'Jing', name: 'Jing', description: '灵动甜美、自然亲和女声（女性）' }
]

const DEFAULT_ALIBABA_TTS_BASE_URL = 'https://dashscope.aliyuncs.com/api/v1'
const ALIBABA_TTS_ENDPOINT_SUFFIX = '/services/aigc/multimodal-generation/generation'

const resolveAlibabaTTSEndpoint = (baseUrl?: string) => {
    const normalizedBaseUrl = (baseUrl || DEFAULT_ALIBABA_TTS_BASE_URL).replace(/\/+$/, '')
    if (normalizedBaseUrl.endsWith(ALIBABA_TTS_ENDPOINT_SUFFIX)) {
        return normalizedBaseUrl
    }
    return `${normalizedBaseUrl}${ALIBABA_TTS_ENDPOINT_SUFFIX}`
}

const buildAlibabaTTSPayload = (text: string, textToSpeechConfig: ICommonObject) => {
    const model = (textToSpeechConfig.model as string) || 'qwen3-tts-flash'
    const voice = (textToSpeechConfig.voice as string) || 'Cherry'
    const languageType = (textToSpeechConfig.languageType as string) || 'Chinese'
    const instructions = (textToSpeechConfig.instructions as string | undefined)?.trim()
    const optimizeInstructions = textToSpeechConfig.optimizeInstructions as boolean | undefined
    const isInstructModel = model.includes('instruct')

    const inputPayload: ICommonObject = {
        text,
        voice,
        language_type: languageType
    }

    if (instructions) {
        inputPayload.instructions = instructions
        if (isInstructModel && typeof optimizeInstructions === 'boolean') {
            inputPayload.optimize_instructions = optimizeInstructions
        }
    }

    return {
        model,
        input: inputPayload
    }
}

const countTextToSpeechCharacters = (text: string): number => {
    return Array.from(text || '').length
}

export const getTextToSpeechBillingDetails = async (
    text: string,
    textToSpeechConfig: ICommonObject,
    _options: ICommonObject
): Promise<ITextToSpeechBillingResult | undefined> => {
    if (!textToSpeechConfig || textToSpeechConfig.name !== TextToSpeechType.ALIBABA_TTS) {
        return undefined
    }

    const credentialId = textToSpeechConfig.credentialId as string
    const model = (textToSpeechConfig.model as string) || 'qwen3-tts-flash'

    return {
        provider: TextToSpeechType.ALIBABA_TTS,
        credentialId,
        model,
        usage: {
            characters: countTextToSpeechCharacters(text)
        }
    }
}

const streamAlibabaSSEAudio = async (
    endpoint: string,
    payload: ICommonObject,
    apiKey: string,
    abortController: AbortController,
    onChunk: (chunk: Buffer) => void
) => {
    const sseResponse = await axios.post(endpoint, payload, {
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
            'X-DashScope-SSE': 'enable'
        },
        responseType: 'stream',
        signal: abortController.signal
    })

    const stream = sseResponse.data as Readable
    if (!stream) {
        throw new Error('Failed to get Alibaba TTS SSE stream')
    }

    await new Promise<void>((resolve, reject) => {
        let settled = false
        let buffer = ''
        let hasAudioChunk = false

        const cleanup = () => {
            abortController.signal.removeEventListener('abort', onAbort)
        }

        const fail = (error: Error) => {
            if (settled) return
            settled = true
            cleanup()
            reject(error)
        }

        const done = () => {
            if (settled) return
            settled = true
            cleanup()
            resolve()
        }

        const processEventBlock = (eventBlock: string) => {
            const dataLines = eventBlock
                .split('\n')
                .map((line) => line.trim())
                .filter((line) => line.startsWith('data:'))
                .map((line) => line.substring(5).trim())

            if (!dataLines.length) return
            const dataStr = dataLines.join('\n')
            if (!dataStr || dataStr === '[DONE]') return

            try {
                const parsed = JSON.parse(dataStr)
                const audioData = parsed?.output?.audio?.data
                if (audioData && typeof audioData === 'string') {
                    hasAudioChunk = true
                    onChunk(Buffer.from(audioData, 'base64'))
                }
            } catch (error) {
                // Ignore malformed SSE lines and continue parsing
            }
        }

        const onAbort = () => {
            if (!stream.destroyed) {
                stream.destroy()
            }
            fail(new Error('TTS generation aborted'))
        }

        abortController.signal.addEventListener('abort', onAbort)

        stream.on('data', (chunk: Buffer) => {
            if (settled || abortController.signal.aborted) return

            buffer += chunk.toString('utf8')
            const blocks = buffer.split('\n\n')
            buffer = blocks.pop() || ''

            for (const block of blocks) {
                processEventBlock(block)
            }
        })

        stream.on('end', () => {
            if (buffer.trim()) {
                processEventBlock(buffer)
            }
            if (hasAudioChunk) {
                done()
            } else {
                fail(new Error('Alibaba TTS SSE ended without audio data'))
            }
        })

        stream.on('error', (error: Error) => {
            fail(error)
        })
    })
}

const fetchAlibabaAudioStream = async (audioUrl: string, abortController: AbortController): Promise<Readable> => {
    const candidateUrls = [audioUrl]
    if (audioUrl.startsWith('http://')) {
        candidateUrls.push(`https://${audioUrl.substring('http://'.length)}`)
    }

    let lastError: unknown
    for (const candidate of candidateUrls) {
        try {
            const audioResponse = await axios.get(candidate, {
                responseType: 'stream',
                signal: abortController.signal
            })

            const stream = audioResponse.data as Readable
            if (!stream) {
                throw new Error('Failed to get Alibaba TTS audio stream')
            }
            return stream
        } catch (error) {
            lastError = error
        }
    }

    throw lastError
}

export const convertTextToSpeechStream = async (
    text: string,
    textToSpeechConfig: ICommonObject,
    options: ICommonObject,
    abortController: AbortController,
    onStart: (format: string) => void,
    onChunk: (chunk: Buffer) => void,
    onEnd: () => void
): Promise<void> => {
    return new Promise<void>((resolve, reject) => {
        let streamDestroyed = false

        // Handle abort signal early
        if (abortController.signal.aborted) {
            reject(new Error('TTS generation aborted'))
            return
        }
        const processStream = async () => {
            try {
                if (textToSpeechConfig) {
                    const credentialId = textToSpeechConfig.credentialId as string
                    const credentialData = await getCredentialData(credentialId ?? '', options)

                    switch (textToSpeechConfig.name) {
                        case TextToSpeechType.OPENAI_TTS: {
                            onStart('mp3')

                            const openai = new OpenAI({
                                apiKey: credentialData.openAIApiKey
                            })

                            const response = await openai.audio.speech.create(
                                {
                                    model: 'gpt-4o-mini-tts',
                                    voice: (textToSpeechConfig.voice || 'alloy') as
                                        | 'alloy'
                                        | 'ash'
                                        | 'ballad'
                                        | 'coral'
                                        | 'echo'
                                        | 'fable'
                                        | 'nova'
                                        | 'onyx'
                                        | 'sage'
                                        | 'shimmer',
                                    input: text,
                                    response_format: 'mp3'
                                },
                                {
                                    signal: abortController.signal
                                }
                            )

                            const stream = response.body as unknown as Readable
                            if (!stream) {
                                throw new Error('Failed to get response stream')
                            }

                            await processStreamWithRateLimit(stream, onChunk, onEnd, resolve, reject, 640, 20, abortController, () => {
                                streamDestroyed = true
                            })
                            break
                        }

                        case TextToSpeechType.ELEVEN_LABS_TTS: {
                            onStart('mp3')

                            const client = new ElevenLabsClient({
                                apiKey: credentialData.elevenLabsApiKey
                            })

                            const response = await client.textToSpeech.stream(
                                textToSpeechConfig.voice || '21m00Tcm4TlvDq8ikWAM',
                                {
                                    text: text,
                                    modelId: 'eleven_multilingual_v2'
                                },
                                { abortSignal: abortController.signal }
                            )

                            const stream = Readable.fromWeb(response as unknown as ReadableStream)
                            if (!stream) {
                                throw new Error('Failed to get response stream')
                            }

                            await processStreamWithRateLimit(stream, onChunk, onEnd, resolve, reject, 640, 40, abortController, () => {
                                streamDestroyed = true
                            })
                            break
                        }

                        case TextToSpeechType.ALIBABA_TTS: {
                            onStart('wav')

                            const endpoint = resolveAlibabaTTSEndpoint(textToSpeechConfig.baseUrl as string | undefined)
                            const payload = buildAlibabaTTSPayload(text, textToSpeechConfig)

                            let response: ICommonObject
                            try {
                                response = await axios.post(endpoint, payload, {
                                    headers: {
                                        Authorization: `Bearer ${credentialData.alibabaApiKey}`,
                                        'Content-Type': 'application/json'
                                    },
                                    signal: abortController.signal
                                })
                            } catch (postError) {
                                await streamAlibabaSSEAudio(endpoint, payload, credentialData.alibabaApiKey, abortController, onChunk)
                                onEnd()
                                resolve()
                                break
                            }

                            const audioData = response.data?.output?.audio?.data
                            if (audioData) {
                                onChunk(Buffer.from(audioData, 'base64'))
                                onEnd()
                                resolve()
                                break
                            }

                            const audioUrl = response.data?.output?.audio?.url
                            if (!audioUrl) {
                                await streamAlibabaSSEAudio(endpoint, payload, credentialData.alibabaApiKey, abortController, onChunk)
                                onEnd()
                                resolve()
                                break
                            }

                            try {
                                const stream = await fetchAlibabaAudioStream(audioUrl, abortController)
                                await processStreamWithRateLimit(stream, onChunk, onEnd, resolve, reject, 640, 20, abortController, () => {
                                    streamDestroyed = true
                                })
                                break
                            } catch (audioUrlError) {
                                await streamAlibabaSSEAudio(endpoint, payload, credentialData.alibabaApiKey, abortController, onChunk)
                                onEnd()
                                resolve()
                                break
                            }
                        }
                    }
                } else {
                    reject(new Error('Text to speech is not selected. Please configure TTS in the chatflow.'))
                }
            } catch (error) {
                reject(error)
            }
        }

        // Handle abort signal
        abortController.signal.addEventListener('abort', () => {
            if (!streamDestroyed) {
                reject(new Error('TTS generation aborted'))
            }
        })

        processStream()
    })
}

const processStreamWithRateLimit = async (
    stream: Readable,
    onChunk: (chunk: Buffer) => void,
    onEnd: () => void,
    resolve: () => void,
    reject: (error: any) => void,
    targetChunkSize: number = 640,
    rateLimitMs: number = 20,
    abortController: AbortController,
    onStreamDestroy?: () => void
) => {
    const TARGET_CHUNK_SIZE = targetChunkSize
    const RATE_LIMIT_MS = rateLimitMs

    let buffer: Buffer = Buffer.alloc(0)
    let isEnded = false

    const processChunks = async () => {
        while (!isEnded || buffer.length > 0) {
            // Check if aborted
            if (abortController.signal.aborted) {
                if (!stream.destroyed) {
                    stream.destroy()
                }
                onStreamDestroy?.()
                reject(new Error('TTS generation aborted'))
                return
            }

            if (buffer.length >= TARGET_CHUNK_SIZE) {
                const chunk = buffer.subarray(0, TARGET_CHUNK_SIZE)
                buffer = buffer.subarray(TARGET_CHUNK_SIZE)
                onChunk(chunk)
                await sleep(RATE_LIMIT_MS)
            } else if (isEnded && buffer.length > 0) {
                onChunk(buffer)
                buffer = Buffer.alloc(0)
            } else if (!isEnded) {
                await sleep(RATE_LIMIT_MS)
            } else {
                break
            }
        }

        onEnd()
        resolve()
    }

    stream.on('data', (chunk) => {
        if (!abortController.signal.aborted) {
            buffer = Buffer.concat([buffer, Buffer.from(chunk)])
        }
    })

    stream.on('end', () => {
        isEnded = true
    })

    stream.on('error', (error) => {
        reject(error)
    })

    // Handle abort signal
    abortController.signal.addEventListener('abort', () => {
        if (!stream.destroyed) {
            stream.destroy()
        }
        onStreamDestroy?.()
        reject(new Error('TTS generation aborted'))
    })

    processChunks().catch(reject)
}

const sleep = (ms: number): Promise<void> => {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

export const getVoices = async (provider: string, credentialId: string, options: ICommonObject) => {
    const credentialData = await getCredentialData(credentialId ?? '', options)

    switch (provider) {
        case TextToSpeechType.OPENAI_TTS:
            return [
                { id: 'alloy', name: 'Alloy' },
                { id: 'ash', name: 'Ash' },
                { id: 'ballad', name: 'Ballad' },
                { id: 'coral', name: 'Coral' },
                { id: 'echo', name: 'Echo' },
                { id: 'fable', name: 'Fable' },
                { id: 'nova', name: 'Nova' },
                { id: 'onyx', name: 'Onyx' },
                { id: 'sage', name: 'Sage' },
                { id: 'shimmer', name: 'Shimmer' }
            ]

        case TextToSpeechType.ELEVEN_LABS_TTS: {
            const client = new ElevenLabsClient({
                apiKey: credentialData.elevenLabsApiKey
            })

            const voices = await client.voices.search({
                pageSize: 100,
                voiceType: 'default',
                category: 'premade'
            })

            return voices.voices.map((voice) => ({
                id: voice.voiceId,
                name: voice.name,
                category: voice.category
            }))
        }

        case TextToSpeechType.ALIBABA_TTS:
            return ALIBABA_TTS_VOICES

        default:
            throw new Error(`Unsupported TTS provider: ${provider}`)
    }
}
