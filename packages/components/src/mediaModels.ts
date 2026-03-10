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
    watermark?: boolean
    conversationContext?: BaseMessage[]
    referenceImages?: IFileUpload[]
}

export interface IMediaImageSummary {
    fileName?: string
    size?: string
    url?: string
}

export interface IMediaGenerationMetadata {
    provider: string
    model: string
    prompt: string
    revisedPrompt?: string
    imageCount?: number
    images?: IMediaImageSummary[]
    usage?: Record<string, unknown> | null
    created?: number | null
    partialFailureCount?: number
}

export interface IMediaGenerationResult {
    text: string
    artifacts: IMediaArtifact[]
    input?: ICommonObject
    metadata?: IMediaGenerationMetadata
    mediaBilling?: {
        provider: string
        credentialId?: string
        model: string
        generatedImages: number
        inputRmbPerImage: number
    }
}

export interface IMediaCapabilities {
    textToImage: boolean
    imageToImage?: boolean
    multiTurnPrompting?: boolean
}

export abstract class BaseMediaModel {
    abstract readonly provider: string
    abstract readonly modelName: string
    abstract readonly capabilities: IMediaCapabilities

    abstract invoke(input: IMediaGenerationInput, options?: ICommonObject): Promise<IMediaGenerationResult>
}
