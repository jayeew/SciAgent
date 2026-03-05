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
        input: inputPayload,
        stream: false
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
            return [{ id: 'Cherry', name: 'Cherry' }]

        default:
            throw new Error(`Unsupported TTS provider: ${provider}`)
    }
}
