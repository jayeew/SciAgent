import { BaseMessage } from '@langchain/core/messages'
import { ICommonObject, IFileUpload } from './Interface'

export interface IMediaArtifact {
    type: string
    data: string
}

export interface IMediaGenerationInput {
    prompt: string
    size?: string
    outputFormat?: 'png' | 'jpeg' | 'jpg'
    ratio?: string
    resolution?: string
    duration?: number
    frames?: number
    seed?: number
    cameraFixed?: boolean
    watermark?: boolean
    conversationContext?: BaseMessage[]
    referenceImages?: IFileUpload[]
}

export interface IMediaImageSummary {
    fileName?: string
    size?: string
    url?: string
}

export interface IMediaVideoSummary {
    fileName?: string
    url?: string
    resolution?: string
    ratio?: string
    duration?: number
}

export interface IMediaGenerationMetadata {
    provider: string
    model: string
    prompt: string
    source?: string
    mediaType?: 'image' | 'video'
    revisedPrompt?: string
    imageCount?: number
    images?: IMediaImageSummary[]
    videoCount?: number
    videos?: IMediaVideoSummary[]
    taskId?: string | null
    status?: string | null
    updated?: number | null
    ratio?: string
    resolution?: string
    duration?: number | null
    frames?: number | null
    seed?: number | null
    usage?: Record<string, unknown> | null
    created?: number | null
    partialFailureCount?: number
}

export type MediaBillingMode = 'token' | 'image_count' | 'video_count' | 'seconds' | 'characters'

export interface IMediaBillingUsage {
    provider: string
    credentialId?: string
    model?: string
    source?: string
    billingMode: MediaBillingMode
    usage: {
        inputTokens?: number
        outputTokens?: number
        totalTokens?: number
        units?: number
        seconds?: number
        characters?: number
    }
}

export interface IMediaGenerationResult {
    text: string
    artifacts: IMediaArtifact[]
    input?: ICommonObject
    metadata?: IMediaGenerationMetadata
    mediaBilling?: IMediaBillingUsage
}

export interface IMediaCapabilities {
    textToImage?: boolean
    imageToImage?: boolean
    textToVideo?: boolean
    imageToVideo?: boolean
    multiTurnPrompting?: boolean
}

export abstract class BaseMediaModel {
    abstract readonly provider: string
    abstract readonly modelName: string
    abstract readonly capabilities: IMediaCapabilities

    abstract invoke(input: IMediaGenerationInput, options?: ICommonObject): Promise<IMediaGenerationResult>
}
