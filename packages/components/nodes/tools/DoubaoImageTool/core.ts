import path from 'path'
import { z } from 'zod'
import { ARTIFACTS_PREFIX, FILE_ANNOTATIONS_PREFIX, MEDIA_BILLING_PREFIX, TOOL_ARGS_PREFIX, formatToolError } from '../../../src/agents'
import { ICommonObject, IFileUpload } from '../../../src/Interface'
import { IMediaGenerationResult } from '../../../src/mediaModels'
import { parseJsonBody } from '../../../src/utils'
import {
    DEFAULT_DOUBAO_IMAGE_OUTPUT_FORMAT,
    DEFAULT_DOUBAO_IMAGE_SIZE,
    DEFAULT_DOUBAO_IMAGE_WATERMARK,
    DoubaoImageModel,
    normalizeDoubaoOutputFormat,
    normalizeDoubaoSequentialImageGeneration,
    normalizeDoubaoSequentialImageGenerationMaxImages
} from '../../mediamodels/DoubaoImage/core'
import { DynamicStructuredTool } from '../OpenAPIToolkit/core'
import { normalizePresentationSpec } from '../PPTXPresentation/core'

const OUTPUT_FORMAT_OPTIONS = ['png', 'jpeg', 'jpg'] as const
const SEQUENTIAL_OPTIONS = ['disabled', 'auto'] as const

export const DoubaoImageRequestSchema = z.object({
    prompt: z.string().min(1).describe('Image prompt used to generate the illustration'),
    slideIndex: z.number().int().min(0).optional().describe('Zero-based slide index to inject the generated file into'),
    size: z.string().optional().describe('Optional Doubao size override, for example 2848x1600'),
    outputFormat: z.enum(OUTPUT_FORMAT_OPTIONS).optional().describe('Optional output format override'),
    watermark: z.boolean().optional().describe('Optional watermark override'),
    referenceImageFileNames: z.array(z.string()).optional().describe('Optional uploaded file names used as reference images')
})

export const GenerateDoubaoImagesSchema = z.object({
    prompt: z.string().optional().describe('Simple single image prompt when imageRequests is not provided'),
    imageRequests: z
        .union([z.string(), z.array(DoubaoImageRequestSchema), z.record(z.any())])
        .optional()
        .describe('Batch image requests as a JSON string/object, preferably {"requests":[...]}'),
    presentationSpec: z
        .union([z.string(), z.record(z.any())])
        .optional()
        .describe('Optional presentationSpec. When slideIndex is provided, generated image file names are injected back into this JSON'),
    size: z.string().optional().describe('Default size override for all requests'),
    outputFormat: z.enum(OUTPUT_FORMAT_OPTIONS).optional().describe('Default output format override for all requests'),
    watermark: z.boolean().optional().describe('Default watermark override for all requests'),
    sequentialImageGeneration: z.enum(SEQUENTIAL_OPTIONS).optional().describe('Sequential image generation mode'),
    sequentialImageGenerationMaxImages: z.number().int().min(1).max(15).optional().describe('Max images for sequential mode'),
    overwriteExistingImages: z
        .boolean()
        .optional()
        .default(false)
        .describe('Whether generated file names should replace existing imageFileNames on the target slide'),
    continueOnGenerationFailure: z
        .boolean()
        .optional()
        .default(true)
        .describe('Whether to continue and return the original/partially updated presentationSpec when some generations fail')
})

export interface IDoubaoImageRequest extends z.infer<typeof DoubaoImageRequestSchema> {}

export interface IGenerateDoubaoImagesInput extends z.infer<typeof GenerateDoubaoImagesSchema> {}

export interface IRequestParameters {
    defaultParams?: ICommonObject
    mediaModel: DoubaoImageModel
}

interface IGeneratedImageResult {
    artifacts: IMediaGenerationResult['artifacts']
    fileAnnotations: Array<{ fileName: string; filePath: string }>
    request: IDoubaoImageRequest
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

const normalizeImageRequests = (params: IGenerateDoubaoImagesInput): IDoubaoImageRequest[] => {
    if (!params.imageRequests) {
        return params.prompt
            ? [
                  {
                      prompt: params.prompt,
                      ...(params.size ? { size: params.size } : {}),
                      ...(params.outputFormat ? { outputFormat: params.outputFormat } : {}),
                      ...(typeof params.watermark === 'boolean' ? { watermark: params.watermark } : {})
                  }
              ]
            : []
    }

    const parsedImageRequests = parseJsonLikeValue(params.imageRequests)

    if (Array.isArray(parsedImageRequests)) {
        return z.array(DoubaoImageRequestSchema).parse(parsedImageRequests)
    }

    if (parsedImageRequests && typeof parsedImageRequests === 'object') {
        if (Array.isArray((parsedImageRequests as Record<string, unknown>).requests)) {
            return z.array(DoubaoImageRequestSchema).parse((parsedImageRequests as Record<string, unknown>).requests)
        }

        if ('prompt' in (parsedImageRequests as Record<string, unknown>)) {
            return [DoubaoImageRequestSchema.parse(parsedImageRequests)]
        }
    }

    throw new Error('imageRequests must be an array, an object with requests[], or a single request object')
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
    const imageSummaries = result.metadata?.images || []
    const annotations: Array<{ fileName: string; filePath: string }> = []

    result.artifacts.forEach((artifact, index) => {
        if (typeof artifact.data !== 'string' || !artifact.data.startsWith('FILE-STORAGE::')) {
            return
        }

        const filePath = artifact.data
        const fallbackFileName = filePath.replace(/^FILE-STORAGE::/, '')
        const metadataFileName = imageSummaries[index]?.fileName?.trim()

        annotations.push({
            filePath,
            fileName: metadataFileName || fallbackFileName
        })
    })

    return annotations
}

const applyGeneratedImagesToPresentationSpec = (
    presentationSpec: ReturnType<typeof normalizePresentationSpec>,
    generatedImages: IGeneratedImageResult[],
    overwriteExistingImages: boolean
) => {
    for (const generatedImage of generatedImages) {
        const slideIndex = generatedImage.request.slideIndex
        if (slideIndex === undefined) {
            continue
        }

        if (slideIndex < 0 || slideIndex >= presentationSpec.slides.length) {
            throw new Error(`slideIndex ${slideIndex} is out of range for presentationSpec.slides`)
        }

        const targetSlide = presentationSpec.slides[slideIndex]
        const generatedFileNames = generatedImage.fileAnnotations.map((annotation) => annotation.fileName)
        if (!generatedFileNames.length) {
            continue
        }

        if (overwriteExistingImages) {
            targetSlide.imageFileNames = generatedFileNames
            continue
        }

        if (targetSlide.imageFileNames?.length) {
            continue
        }

        targetSlide.imageFileNames = generatedFileNames
    }
}

class GenerateDoubaoImagesTool extends DynamicStructuredTool<typeof GenerateDoubaoImagesSchema> {
    private defaultParams: ICommonObject

    private mediaModel: DoubaoImageModel

    constructor(args: IRequestParameters) {
        super({
            name: 'generate_doubao_images',
            description:
                'Generate one or more images with Doubao Ark. When presentationSpec and slideIndex are provided, this tool returns an updated presentationSpec JSON string with generated imageFileNames injected into the target slides.',
            schema: GenerateDoubaoImagesSchema,
            baseUrl: '',
            method: 'POST',
            headers: {}
        })

        this.defaultParams = args.defaultParams || {}
        this.mediaModel = args.mediaModel
    }

    protected async _call(
        arg: z.output<typeof GenerateDoubaoImagesSchema>,
        _: unknown,
        flowConfig?: { sessionId?: string; chatId?: string; chatflowId?: string; orgId?: string; state?: ICommonObject }
    ): Promise<string> {
        const params = {
            ...this.defaultParams,
            ...arg
        } as IGenerateDoubaoImagesInput

        try {
            if (!params.prompt && !params.imageRequests) {
                throw new Error('Either prompt or imageRequests is required')
            }

            if (!flowConfig?.chatflowId || !flowConfig?.chatId) {
                throw new Error('chatflowId and chatId are required to store generated images')
            }

            const requests = normalizeImageRequests(params)
            const normalizedPresentationSpec = params.presentationSpec ? normalizePresentationSpec(params.presentationSpec, {}) : undefined

            if (!requests.length) {
                if (normalizedPresentationSpec) {
                    return JSON.stringify(normalizedPresentationSpec, null, 2)
                }

                return 'No image requests were provided.'
            }

            const generatedImages: IGeneratedImageResult[] = []
            const warnings: string[] = []
            const mediaBillings: ICommonObject[] = []

            for (const request of requests) {
                try {
                    const result = await this.mediaModel.invoke(
                        {
                            prompt: request.prompt,
                            ...(request.size || params.size ? { size: request.size || params.size || DEFAULT_DOUBAO_IMAGE_SIZE } : {}),
                            ...(request.outputFormat || params.outputFormat
                                ? {
                                      outputFormat: normalizeDoubaoOutputFormat(
                                          request.outputFormat || params.outputFormat || DEFAULT_DOUBAO_IMAGE_OUTPUT_FORMAT
                                      )
                                  }
                                : {}),
                            ...(typeof request.watermark === 'boolean' || typeof params.watermark === 'boolean'
                                ? { watermark: request.watermark ?? params.watermark ?? DEFAULT_DOUBAO_IMAGE_WATERMARK }
                                : {}),
                            ...(params.sequentialImageGeneration
                                ? {
                                      sequentialImageGeneration: normalizeDoubaoSequentialImageGeneration(params.sequentialImageGeneration)
                                  }
                                : {}),
                            ...(params.sequentialImageGenerationMaxImages
                                ? {
                                      sequentialImageGenerationMaxImages: normalizeDoubaoSequentialImageGenerationMaxImages(
                                          params.sequentialImageGenerationMaxImages
                                      )
                                  }
                                : {}),
                            ...(request.referenceImageFileNames?.length
                                ? { referenceImages: buildReferenceImages(request.referenceImageFileNames) }
                                : {})
                        },
                        {
                            chatflowid: flowConfig.chatflowId,
                            chatId: flowConfig.chatId,
                            orgId: flowConfig.orgId
                        }
                    )

                    const fileAnnotations = extractFileAnnotations(result)
                    if (!fileAnnotations.length) {
                        throw new Error('No stored image file was returned by Doubao image generation')
                    }

                    generatedImages.push({
                        artifacts: result.artifacts,
                        request,
                        fileAnnotations
                    })

                    if (result.mediaBilling && typeof result.mediaBilling === 'object') {
                        mediaBillings.push(result.mediaBilling as ICommonObject)
                    }
                } catch (error) {
                    if (!params.continueOnGenerationFailure) {
                        throw error
                    }

                    warnings.push(`Failed to generate image for prompt: ${request.prompt}`)
                }
            }

            if (normalizedPresentationSpec) {
                applyGeneratedImagesToPresentationSpec(normalizedPresentationSpec, generatedImages, params.overwriteExistingImages ?? false)
            }

            const allArtifacts = generatedImages.flatMap((generatedImage) => generatedImage.artifacts)
            const allFileAnnotations = generatedImages.flatMap((generatedImage) => generatedImage.fileAnnotations)
            const output =
                normalizedPresentationSpec && params.presentationSpec
                    ? JSON.stringify(normalizedPresentationSpec, null, 2)
                    : JSON.stringify(
                          {
                              generatedImages: generatedImages.map((generatedImage) => ({
                                  slideIndex: generatedImage.request.slideIndex,
                                  prompt: generatedImage.request.prompt,
                                  fileNames: generatedImage.fileAnnotations.map((annotation) => annotation.fileName)
                              })),
                              warnings
                          },
                          null,
                          2
                      )

            return (
                output +
                ARTIFACTS_PREFIX +
                JSON.stringify(allArtifacts) +
                FILE_ANNOTATIONS_PREFIX +
                JSON.stringify(allFileAnnotations) +
                MEDIA_BILLING_PREFIX +
                JSON.stringify(mediaBillings) +
                TOOL_ARGS_PREFIX +
                JSON.stringify({
                    warnings,
                    generatedImages: generatedImages.map((generatedImage) => ({
                        slideIndex: generatedImage.request.slideIndex,
                        prompt: generatedImage.request.prompt,
                        fileNames: generatedImage.fileAnnotations.map((annotation) => annotation.fileName)
                    }))
                })
            )
        } catch (error) {
            return formatToolError(`Error generating Doubao images: ${error}`, params)
        }
    }
}

export const createDoubaoImageTools = (args: IRequestParameters): DynamicStructuredTool[] => {
    return [new GenerateDoubaoImagesTool(args)]
}
