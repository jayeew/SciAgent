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
import { DynamicStructuredTool, IToolFlowConfig } from '../OpenAPIToolkit/core'
import { normalizePresentationSpec } from '../PPTXPresentation/core'

const OUTPUT_FORMAT_OPTIONS = ['png', 'jpeg', 'jpg'] as const
const SEQUENTIAL_OPTIONS = ['disabled', 'auto'] as const
const REFERENCE_IMAGE_SOURCE_OPTIONS = ['disabled', 'flowState', 'currentUploads', 'flowStateThenUploads'] as const
const REFERENCE_IMAGE_SELECTION_OPTIONS = ['first', 'last'] as const

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
    referenceImageSource: z
        .enum(REFERENCE_IMAGE_SOURCE_OPTIONS)
        .optional()
        .describe('Automatically resolve a single reference image from flowState or currentUploads when a request does not provide one'),
    referenceImageStateKey: z.string().optional().describe('Top-level flow state key used when referenceImageSource reads from flowState'),
    referenceImageSelection: z
        .enum(REFERENCE_IMAGE_SELECTION_OPTIONS)
        .optional()
        .describe('Whether automatic reference image resolution should use the first or last available candidate'),
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

interface IResolvedReferenceImages {
    referenceImageFileNames: string[]
    referenceImages?: IFileUpload[]
    resolvedReferenceSource: 'manual' | 'flowState' | 'currentUploads' | 'none'
    referenceResolutionWarnings: string[]
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

const parseJsonLikeValueOrRaw = (value: unknown): unknown => {
    if (typeof value !== 'string') {
        return value
    }

    try {
        return parseJsonLikeValue(value)
    } catch {
        return sanitizeJsonLikeString(value)
    }
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

const normalizeReferenceImageFileNames = (fileNames?: string[]): string[] => {
    if (!fileNames?.length) return []

    return [...new Set(fileNames.map((fileName) => fileName.replace(/^FILE-STORAGE::/, '').trim()).filter(Boolean))]
}

const normalizeReferenceUpload = (upload: IFileUpload): IFileUpload | undefined => {
    if (!upload?.mime?.startsWith('image/')) return undefined

    if (upload.type === 'stored-file') {
        const normalizedFileName = upload.name.replace(/^FILE-STORAGE::/, '').trim()
        if (!normalizedFileName) return undefined

        return {
            type: 'stored-file',
            name: `FILE-STORAGE::${normalizedFileName}`,
            mime: upload.mime || getMimeTypeFromFilename(normalizedFileName),
            data: upload.data || ''
        }
    }

    if (upload.type === 'url') {
        if (!upload.data?.trim()) return undefined

        return {
            type: 'url',
            name: upload.name,
            mime: upload.mime,
            data: upload.data
        }
    }

    return {
        ...upload
    }
}

const getReferenceImageDisplayName = (upload: IFileUpload): string => {
    if (upload.type === 'stored-file') {
        return upload.name.replace(/^FILE-STORAGE::/, '').trim()
    }

    return upload.name?.trim() || 'reference-image'
}

const selectReferenceItem = <T>(items: T[], selection?: IGenerateDoubaoImagesInput['referenceImageSelection']): T | undefined => {
    if (!items.length) return undefined

    return selection === 'last' ? items[items.length - 1] : items[0]
}

const extractReferenceFileNamesFromValue = (value: unknown): string[] => {
    const parsedValue = parseJsonLikeValueOrRaw(value)

    if (typeof parsedValue === 'string') {
        return normalizeReferenceImageFileNames([parsedValue])
    }

    if (Array.isArray(parsedValue)) {
        if (parsedValue.every((item) => typeof item === 'string')) {
            return normalizeReferenceImageFileNames(parsedValue as string[])
        }

        return normalizeReferenceImageFileNames(
            parsedValue.flatMap((item) => {
                if (!item || typeof item !== 'object') return []

                const objectItem = item as Record<string, unknown>
                if (typeof objectItem.fileName === 'string') {
                    return [objectItem.fileName]
                }

                if (typeof objectItem.filePath === 'string') {
                    return [objectItem.filePath]
                }

                if (Array.isArray(objectItem.fileNames)) {
                    return objectItem.fileNames.filter((fileName): fileName is string => typeof fileName === 'string')
                }

                return []
            })
        )
    }

    if (!parsedValue || typeof parsedValue !== 'object') {
        return []
    }

    const objectValue = parsedValue as Record<string, unknown>

    if (Array.isArray(objectValue.generatedImages)) {
        const generatedImageFileNames = objectValue.generatedImages.flatMap((generatedImage) => {
            if (!generatedImage || typeof generatedImage !== 'object') return []

            const imageRecord = generatedImage as Record<string, unknown>
            if (Array.isArray(imageRecord.fileNames)) {
                return imageRecord.fileNames.filter((fileName): fileName is string => typeof fileName === 'string')
            }

            return []
        })

        if (generatedImageFileNames.length) {
            return normalizeReferenceImageFileNames(generatedImageFileNames)
        }
    }

    if (Array.isArray(objectValue.fileAnnotations)) {
        const fileAnnotationFileNames = objectValue.fileAnnotations.flatMap((annotation) => {
            if (!annotation || typeof annotation !== 'object') return []

            const annotationRecord = annotation as Record<string, unknown>
            if (typeof annotationRecord.fileName === 'string') {
                return [annotationRecord.fileName]
            }

            if (typeof annotationRecord.filePath === 'string') {
                return [annotationRecord.filePath]
            }

            return []
        })

        if (fileAnnotationFileNames.length) {
            return normalizeReferenceImageFileNames(fileAnnotationFileNames)
        }
    }

    if (Array.isArray(objectValue.fileNames)) {
        return normalizeReferenceImageFileNames(
            objectValue.fileNames.filter((fileName): fileName is string => typeof fileName === 'string')
        )
    }

    if (typeof objectValue.fileName === 'string') {
        return normalizeReferenceImageFileNames([objectValue.fileName])
    }

    if (typeof objectValue.filePath === 'string') {
        return normalizeReferenceImageFileNames([objectValue.filePath])
    }

    return []
}

const resolveReferenceImagesFromFlowState = (
    params: IGenerateDoubaoImagesInput,
    flowConfig?: IToolFlowConfig
): Pick<
    IResolvedReferenceImages,
    'referenceImageFileNames' | 'referenceImages' | 'resolvedReferenceSource' | 'referenceResolutionWarnings'
> => {
    const warnings: string[] = []

    if (!params.referenceImageStateKey?.trim()) {
        warnings.push('Automatic flowState reference image resolution was enabled, but referenceImageStateKey was empty.')
        return {
            referenceImageFileNames: [],
            resolvedReferenceSource: 'none',
            referenceResolutionWarnings: warnings
        }
    }

    const stateValue = flowConfig?.state?.[params.referenceImageStateKey]
    if (stateValue === undefined || stateValue === null || stateValue === '') {
        warnings.push(`No flow state value was found for referenceImageStateKey "${params.referenceImageStateKey}".`)
        return {
            referenceImageFileNames: [],
            resolvedReferenceSource: 'none',
            referenceResolutionWarnings: warnings
        }
    }

    const fileNames = extractReferenceFileNamesFromValue(stateValue)
    const selectedFileName = selectReferenceItem(fileNames, params.referenceImageSelection)

    if (!selectedFileName) {
        warnings.push(`No reference image file names could be parsed from flow state "${params.referenceImageStateKey}".`)
        return {
            referenceImageFileNames: [],
            resolvedReferenceSource: 'none',
            referenceResolutionWarnings: warnings
        }
    }

    return {
        referenceImageFileNames: [selectedFileName],
        referenceImages: buildReferenceImages([selectedFileName]),
        resolvedReferenceSource: 'flowState',
        referenceResolutionWarnings: warnings
    }
}

const resolveReferenceImagesFromCurrentUploads = (
    params: IGenerateDoubaoImagesInput,
    flowConfig?: IToolFlowConfig
): Pick<
    IResolvedReferenceImages,
    'referenceImageFileNames' | 'referenceImages' | 'resolvedReferenceSource' | 'referenceResolutionWarnings'
> => {
    const sourceUploads =
        flowConfig?.recentImageUploads && flowConfig.recentImageUploads.length ? flowConfig.recentImageUploads : flowConfig?.uploads || []
    const candidateUploads = sourceUploads.map(normalizeReferenceUpload).filter(Boolean) as IFileUpload[]

    if (!candidateUploads.length) {
        return {
            referenceImageFileNames: [],
            resolvedReferenceSource: 'none',
            referenceResolutionWarnings: ['No current image uploads were available for automatic reference image resolution.']
        }
    }

    const selectedUpload = selectReferenceItem(candidateUploads, params.referenceImageSelection)
    if (!selectedUpload) {
        return {
            referenceImageFileNames: [],
            resolvedReferenceSource: 'none',
            referenceResolutionWarnings: ['Automatic currentUploads reference image selection did not find a usable image.']
        }
    }

    return {
        referenceImageFileNames: [getReferenceImageDisplayName(selectedUpload)],
        referenceImages: [selectedUpload],
        resolvedReferenceSource: 'currentUploads',
        referenceResolutionWarnings: []
    }
}

const resolveReferenceImages = (
    request: IDoubaoImageRequest,
    params: IGenerateDoubaoImagesInput,
    flowConfig?: IToolFlowConfig
): IResolvedReferenceImages => {
    const explicitReferenceImageFileNames = normalizeReferenceImageFileNames(request.referenceImageFileNames)

    if (explicitReferenceImageFileNames.length) {
        return {
            referenceImageFileNames: explicitReferenceImageFileNames,
            referenceImages: buildReferenceImages(explicitReferenceImageFileNames),
            resolvedReferenceSource: 'manual',
            referenceResolutionWarnings: []
        }
    }

    switch (params.referenceImageSource) {
        case 'flowState':
            return resolveReferenceImagesFromFlowState(params, flowConfig)
        case 'currentUploads':
            return resolveReferenceImagesFromCurrentUploads(params, flowConfig)
        case 'flowStateThenUploads': {
            const flowStateResult = resolveReferenceImagesFromFlowState(params, flowConfig)
            if (flowStateResult.referenceImages?.length) {
                return flowStateResult
            }

            const uploadsResult = resolveReferenceImagesFromCurrentUploads(params, flowConfig)
            return {
                ...uploadsResult,
                referenceResolutionWarnings: [...flowStateResult.referenceResolutionWarnings, ...uploadsResult.referenceResolutionWarnings]
            }
        }
        case 'disabled':
        default:
            return {
                referenceImageFileNames: [],
                resolvedReferenceSource: 'none',
                referenceResolutionWarnings: []
            }
    }
}

const serializeReferenceImagesForDebug = (referenceImages?: IFileUpload[]) => {
    if (!referenceImages?.length) {
        return []
    }

    return referenceImages.map((upload) => ({
        type: upload.type,
        name: upload.name,
        mime: upload.mime
    }))
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

    protected async _call(arg: z.output<typeof GenerateDoubaoImagesSchema>, _: unknown, flowConfig?: IToolFlowConfig): Promise<string> {
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
            const resolvedReferenceSource: string[] = []
            const resolvedReferenceImages: Array<Array<{ type: string; name: string; mime: string }>> = []
            const referenceResolutionWarnings: string[] = []

            for (const request of requests) {
                try {
                    const resolvedReference = resolveReferenceImages(request, params, flowConfig)
                    const effectiveRequest = {
                        ...request,
                        ...(resolvedReference.referenceImageFileNames.length
                            ? { referenceImageFileNames: resolvedReference.referenceImageFileNames }
                            : {})
                    }

                    resolvedReferenceSource.push(resolvedReference.resolvedReferenceSource)
                    resolvedReferenceImages.push(serializeReferenceImagesForDebug(resolvedReference.referenceImages))
                    referenceResolutionWarnings.push(...resolvedReference.referenceResolutionWarnings)

                    const result = await this.mediaModel.invoke(
                        {
                            prompt: effectiveRequest.prompt,
                            ...(effectiveRequest.size || params.size
                                ? { size: effectiveRequest.size || params.size || DEFAULT_DOUBAO_IMAGE_SIZE }
                                : {}),
                            ...(effectiveRequest.outputFormat || params.outputFormat
                                ? {
                                      outputFormat: normalizeDoubaoOutputFormat(
                                          effectiveRequest.outputFormat || params.outputFormat || DEFAULT_DOUBAO_IMAGE_OUTPUT_FORMAT
                                      )
                                  }
                                : {}),
                            ...(typeof effectiveRequest.watermark === 'boolean' || typeof params.watermark === 'boolean'
                                ? { watermark: effectiveRequest.watermark ?? params.watermark ?? DEFAULT_DOUBAO_IMAGE_WATERMARK }
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
                            ...(resolvedReference.referenceImages?.length ? { referenceImages: resolvedReference.referenceImages } : {})
                        },
                        {
                            chatflowid: flowConfig?.chatflowId,
                            chatId: flowConfig?.chatId,
                            orgId: flowConfig?.orgId
                        }
                    )

                    const fileAnnotations = extractFileAnnotations(result)
                    if (!fileAnnotations.length) {
                        throw new Error('No stored image file was returned by Doubao image generation')
                    }

                    generatedImages.push({
                        artifacts: result.artifacts,
                        request: effectiveRequest,
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
                    resolvedReferenceSource: requests.length === 1 ? resolvedReferenceSource[0] || 'none' : resolvedReferenceSource,
                    resolvedReferenceImages: requests.length === 1 ? resolvedReferenceImages[0] || [] : resolvedReferenceImages,
                    referenceResolutionWarnings,
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
