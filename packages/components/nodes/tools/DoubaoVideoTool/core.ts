import path from 'path'
import { z } from 'zod'
import { FILE_ANNOTATIONS_PREFIX, MEDIA_BILLING_PREFIX, TOOL_ARGS_PREFIX, formatToolError } from '../../../src/agents'
import { ICommonObject, IFileUpload } from '../../../src/Interface'
import { IMediaGenerationResult, IMediaVideoSummary } from '../../../src/mediaModels'
import { parseJsonBody } from '../../../src/utils'
import { DoubaoVideoModel, normalizeDoubaoVideoRatio, normalizeDoubaoVideoResolution } from '../../mediamodels/DoubaoVideo/core'
import { DynamicStructuredTool } from '../OpenAPIToolkit/core'

export const DoubaoVideoRequestSchema = z.object({
    prompt: z.string().min(1).describe('Video prompt used to generate the clip'),
    ratio: z.string().optional().describe('Optional aspect ratio override, for example 16:9'),
    resolution: z.string().optional().describe('Optional resolution override, for example 720p'),
    duration: z.number().int().min(2).max(12).optional().describe('Video duration in seconds'),
    seed: z.number().int().optional().describe('Optional seed override'),
    cameraFixed: z.boolean().optional().describe('Whether the camera should remain fixed'),
    watermark: z.boolean().optional().describe('Whether to keep the provider watermark'),
    referenceImageFileNames: z
        .array(z.string())
        .max(2)
        .optional()
        .describe('Optional uploaded file names used as first-frame and last-frame references')
})

export const GenerateDoubaoVideosSchema = z.object({
    prompt: z.string().optional().describe('Simple single video prompt when videoRequests is not provided'),
    videoRequests: z
        .union([z.string(), z.array(DoubaoVideoRequestSchema), z.record(z.unknown())])
        .optional()
        .describe('Batch video requests as a JSON string/object, preferably {"requests":[...]}'),
    ratio: z.string().optional().describe('Default aspect ratio override for all requests'),
    resolution: z.string().optional().describe('Default resolution override for all requests'),
    duration: z.number().int().min(2).max(12).optional().describe('Default duration override in seconds'),
    seed: z.number().int().optional().describe('Default seed override'),
    cameraFixed: z.boolean().optional().describe('Default camera-fixed override'),
    watermark: z.boolean().optional().describe('Default watermark override'),
    referenceImageFileNames: z
        .array(z.string())
        .max(2)
        .optional()
        .describe('Optional uploaded file names for a simple single prompt request'),
    continueOnGenerationFailure: z
        .boolean()
        .optional()
        .default(true)
        .describe('Whether to continue and return successful generations when some requests fail')
})

export interface IDoubaoVideoRequest extends z.infer<typeof DoubaoVideoRequestSchema> {}

export interface IGenerateDoubaoVideosInput extends z.infer<typeof GenerateDoubaoVideosSchema> {}

export interface IRequestParameters {
    defaultParams?: ICommonObject
    mediaModel: DoubaoVideoModel
}

interface IGeneratedVideoResult {
    fileAnnotations: Array<{ fileName: string; filePath: string }>
    request: IDoubaoVideoRequest
    videos: IMediaVideoSummary[]
}

const getMimeTypeFromFilename = (fileName: string): string => {
    switch (path.extname(fileName).toLowerCase()) {
        case '.jpg':
        case '.jpeg':
            return 'image/jpeg'
        case '.webp':
            return 'image/webp'
        case '.gif':
            return 'image/gif'
        case '.svg':
            return 'image/svg+xml'
        case '.png':
        default:
            return 'image/png'
    }
}

const sanitizeJsonLikeString = (value: string): string => {
    let cleanedValue = value.trim()

    const fencedMatch = cleanedValue.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
    if (fencedMatch?.[1]) {
        cleanedValue = fencedMatch[1].trim()
    }

    cleanedValue = cleanedValue
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')

    if (cleanedValue.includes('<')) {
        cleanedValue = cleanedValue.replace(/<[^>]+>/g, '').trim()
    }

    return cleanedValue
}

const parseJsonLikeValue = (value: unknown): unknown => {
    if (typeof value !== 'string') {
        return value
    }

    return parseJsonBody(sanitizeJsonLikeString(value))
}

const normalizeVideoRequests = (params: IGenerateDoubaoVideosInput): IDoubaoVideoRequest[] => {
    if (!params.videoRequests) {
        return params.prompt
            ? [
                  {
                      prompt: params.prompt,
                      ...(params.ratio ? { ratio: params.ratio } : {}),
                      ...(params.resolution ? { resolution: params.resolution } : {}),
                      ...(typeof params.duration === 'number' ? { duration: params.duration } : {}),
                      ...(typeof params.seed === 'number' ? { seed: params.seed } : {}),
                      ...(typeof params.cameraFixed === 'boolean' ? { cameraFixed: params.cameraFixed } : {}),
                      ...(typeof params.watermark === 'boolean' ? { watermark: params.watermark } : {}),
                      ...(params.referenceImageFileNames?.length ? { referenceImageFileNames: params.referenceImageFileNames } : {})
                  }
              ]
            : []
    }

    const parsedVideoRequests = parseJsonLikeValue(params.videoRequests)

    if (Array.isArray(parsedVideoRequests)) {
        return z.array(DoubaoVideoRequestSchema).parse(parsedVideoRequests)
    }

    if (parsedVideoRequests && typeof parsedVideoRequests === 'object') {
        if (Array.isArray((parsedVideoRequests as Record<string, unknown>).requests)) {
            return z.array(DoubaoVideoRequestSchema).parse((parsedVideoRequests as Record<string, unknown>).requests)
        }

        if ('prompt' in (parsedVideoRequests as Record<string, unknown>)) {
            return [DoubaoVideoRequestSchema.parse(parsedVideoRequests)]
        }
    }

    throw new Error('videoRequests must be an array, an object with requests[], or a single request object')
}

const buildReferenceImages = (fileNames?: string[]): IFileUpload[] | undefined => {
    if (!fileNames?.length) return undefined

    return fileNames.map((fileName) => {
        const normalizedFileName = fileName.replace(/^FILE-STORAGE::/, '').trim()
        return {
            type: 'stored-file',
            name: `FILE-STORAGE::${normalizedFileName}`,
            mime: getMimeTypeFromFilename(normalizedFileName),
            data: ''
        }
    })
}

const extractFileAnnotations = (result: IMediaGenerationResult): Array<{ fileName: string; filePath: string }> => {
    const videoSummaries = result.metadata?.videos || []
    const annotations: Array<{ fileName: string; filePath: string }> = []

    result.artifacts.forEach((artifact, index) => {
        if (typeof artifact.data !== 'string' || !artifact.data.startsWith('FILE-STORAGE::')) {
            return
        }

        const filePath = artifact.data
        const fallbackFileName = filePath.replace(/^FILE-STORAGE::/, '')
        const metadataFileName = videoSummaries[index]?.fileName?.trim()

        annotations.push({
            filePath,
            fileName: metadataFileName || fallbackFileName
        })
    })

    return annotations
}

const extractVideoSummaries = (result: IMediaGenerationResult): IMediaVideoSummary[] => {
    const metadataVideos = result.metadata?.videos || []

    if (metadataVideos.length) {
        return metadataVideos
    }

    return result.artifacts
        .map((artifact) => {
            if (typeof artifact.data !== 'string') {
                return undefined
            }

            if (artifact.data.startsWith('FILE-STORAGE::')) {
                return {
                    fileName: artifact.data.replace(/^FILE-STORAGE::/, '')
                }
            }

            return {
                url: artifact.data
            }
        })
        .filter(Boolean) as IMediaVideoSummary[]
}

class GenerateDoubaoVideosTool extends DynamicStructuredTool<typeof GenerateDoubaoVideosSchema> {
    private defaultParams: ICommonObject

    private mediaModel: DoubaoVideoModel

    constructor(args: IRequestParameters) {
        super({
            name: 'generate_doubao_videos',
            description: 'Generate one or more videos with Doubao Ark. Supports optional first-frame and last-frame guidance images.',
            schema: GenerateDoubaoVideosSchema,
            baseUrl: '',
            method: 'POST',
            headers: {}
        })

        this.defaultParams = args.defaultParams || {}
        this.mediaModel = args.mediaModel
    }

    protected async _call(
        arg: z.output<typeof GenerateDoubaoVideosSchema>,
        _: unknown,
        flowConfig?: { sessionId?: string; chatId?: string; chatflowId?: string; orgId?: string; state?: ICommonObject }
    ): Promise<string> {
        const params = {
            ...this.defaultParams,
            ...arg
        } as IGenerateDoubaoVideosInput

        try {
            if (!params.prompt && !params.videoRequests) {
                throw new Error('Either prompt or videoRequests is required')
            }

            const requests = normalizeVideoRequests(params)

            if (!requests.length) {
                return 'No video requests were provided.'
            }

            const generatedVideos: IGeneratedVideoResult[] = []
            const warnings: string[] = []
            const mediaBillings: ICommonObject[] = []

            for (const request of requests) {
                try {
                    const result = await this.mediaModel.invoke(
                        {
                            prompt: request.prompt,
                            ...(request.ratio || params.ratio ? { ratio: normalizeDoubaoVideoRatio(request.ratio || params.ratio) } : {}),
                            ...(request.resolution || params.resolution
                                ? { resolution: normalizeDoubaoVideoResolution(request.resolution || params.resolution) }
                                : {}),
                            ...(typeof request.duration === 'number' || typeof params.duration === 'number'
                                ? { duration: request.duration ?? params.duration }
                                : {}),
                            ...(typeof request.seed === 'number' || typeof params.seed === 'number'
                                ? { seed: request.seed ?? params.seed }
                                : {}),
                            ...(typeof request.cameraFixed === 'boolean' || typeof params.cameraFixed === 'boolean'
                                ? { cameraFixed: request.cameraFixed ?? params.cameraFixed }
                                : {}),
                            ...(typeof request.watermark === 'boolean' || typeof params.watermark === 'boolean'
                                ? { watermark: request.watermark ?? params.watermark }
                                : {}),
                            ...(request.referenceImageFileNames?.length || params.referenceImageFileNames?.length
                                ? {
                                      referenceImages: buildReferenceImages(
                                          request.referenceImageFileNames || params.referenceImageFileNames
                                      )
                                  }
                                : {})
                        },
                        {
                            chatflowid: flowConfig?.chatflowId,
                            chatId: flowConfig?.chatId,
                            orgId: flowConfig?.orgId
                        }
                    )

                    const fileAnnotations = extractFileAnnotations(result)
                    const videos = extractVideoSummaries(result)

                    if (!fileAnnotations.length && !videos.length) {
                        throw new Error('No stored video file or video URL was returned by Doubao video generation')
                    }

                    generatedVideos.push({
                        request,
                        fileAnnotations,
                        videos
                    })

                    if (result.mediaBilling && typeof result.mediaBilling === 'object') {
                        mediaBillings.push(result.mediaBilling as ICommonObject)
                    }
                } catch (error) {
                    if (!params.continueOnGenerationFailure) {
                        throw error
                    }

                    warnings.push(`Failed to generate video for prompt: ${request.prompt}`)
                }
            }

            const toolOutput = {
                generatedVideos: generatedVideos.map((generatedVideo) => ({
                    prompt: generatedVideo.request.prompt,
                    fileNames: generatedVideo.fileAnnotations.map((annotation) => annotation.fileName),
                    urls: generatedVideo.videos.map((video) => video.url).filter(Boolean),
                    ratio: generatedVideo.videos[0]?.ratio,
                    resolution: generatedVideo.videos[0]?.resolution,
                    duration: generatedVideo.videos[0]?.duration,
                    referenceImageFileNames: generatedVideo.request.referenceImageFileNames || []
                })),
                warnings
            }

            const allFileAnnotations = generatedVideos.flatMap((generatedVideo) => generatedVideo.fileAnnotations)

            return (
                JSON.stringify(toolOutput, null, 2) +
                FILE_ANNOTATIONS_PREFIX +
                JSON.stringify(allFileAnnotations) +
                MEDIA_BILLING_PREFIX +
                JSON.stringify(mediaBillings) +
                TOOL_ARGS_PREFIX +
                JSON.stringify(toolOutput)
            )
        } catch (error) {
            return formatToolError(`Error generating Doubao videos: ${error}`, params)
        }
    }
}

export const createDoubaoVideoTools = (args: IRequestParameters): DynamicStructuredTool[] => {
    return [new GenerateDoubaoVideosTool(args)]
}
