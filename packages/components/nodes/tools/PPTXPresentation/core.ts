import path from 'path'
import sanitize from 'sanitize-filename'
import PptxGenJS from 'pptxgenjs'
import { z } from 'zod'
import { addSingleFileToStorage, getFileFromStorage } from '../../../src/storageUtils'
import { DynamicStructuredTool } from '../OpenAPIToolkit/core'
import { FILE_ANNOTATIONS_PREFIX, TOOL_ARGS_PREFIX, formatToolError } from '../../../src/agents'
import { ICommonObject } from '../../../src/Interface'

export const PPTX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

const THEME_PRESETS = ['business-neutral', 'business-blue', 'clean-dark'] as const
const SLIDE_SIZES = ['wide', 'standard'] as const
const SLIDE_LAYOUTS = ['title', 'section', 'title-bullets', 'image-right', 'two-column'] as const

export const ThemePresetSchema = z.enum(THEME_PRESETS)
export const SlideSizeSchema = z.enum(SLIDE_SIZES)
export const SlideLayoutSchema = z.enum(SLIDE_LAYOUTS)

export const PresentationSlideSchema = z.object({
    layout: SlideLayoutSchema.default('title-bullets'),
    title: z.string().min(1),
    subtitle: z.string().optional(),
    body: z.string().optional(),
    bullets: z.array(z.string()).optional(),
    speakerNotes: z.string().optional(),
    imageFileNames: z.array(z.string()).optional(),
    leftTitle: z.string().optional(),
    leftBody: z.string().optional(),
    leftBullets: z.array(z.string()).optional(),
    rightTitle: z.string().optional(),
    rightBody: z.string().optional(),
    rightBullets: z.array(z.string()).optional()
})

export const PresentationSpecSchema = z.object({
    fileName: z.string().optional(),
    title: z.string().min(1),
    subtitle: z.string().optional(),
    themePreset: ThemePresetSchema.optional(),
    slideSize: SlideSizeSchema.optional(),
    includeSpeakerNotes: z.boolean().optional(),
    slides: z.array(PresentationSlideSchema).min(1)
})

export const CreatePresentationSchema = z.object({
    presentationSpec: z
        .union([z.string(), z.record(z.any())])
        .describe('Presentation spec as a JSON string or object with fileName, title, themePreset, slideSize, and slides[]'),
    themePreset: ThemePresetSchema.optional().describe('Optional theme override'),
    outputFileName: z.string().optional().describe('Optional output filename ending with .pptx'),
    slideSize: SlideSizeSchema.optional().describe('Optional presentation size override'),
    includeSpeakerNotes: z.boolean().optional().default(true).describe('Whether to include speaker notes in slides')
})

export interface IPresentationSlide extends z.infer<typeof PresentationSlideSchema> {}

export interface IPresentationSpec extends z.infer<typeof PresentationSpecSchema> {}

export interface ICreatePresentationInput extends z.infer<typeof CreatePresentationSchema> {}

export interface IRequestParameters {
    defaultParams?: ICommonObject
}

interface IThemeConfig {
    backgroundColor: string
    titleColor: string
    textColor: string
    accentColor: string
    mutedColor: string
    sectionBackgroundColor: string
    sectionTextColor: string
}

interface IStoredImage {
    data: string
    fileName: string
}

const themeConfigs: Record<(typeof THEME_PRESETS)[number], IThemeConfig> = {
    'business-neutral': {
        backgroundColor: 'F7F8FA',
        titleColor: '1F2937',
        textColor: '374151',
        accentColor: '3B82F6',
        mutedColor: '6B7280',
        sectionBackgroundColor: 'E5E7EB',
        sectionTextColor: '111827'
    },
    'business-blue': {
        backgroundColor: 'F5F9FF',
        titleColor: '0F172A',
        textColor: '1E3A8A',
        accentColor: '2563EB',
        mutedColor: '475569',
        sectionBackgroundColor: 'DBEAFE',
        sectionTextColor: '1D4ED8'
    },
    'clean-dark': {
        backgroundColor: '111827',
        titleColor: 'F9FAFB',
        textColor: 'E5E7EB',
        accentColor: '60A5FA',
        mutedColor: 'CBD5E1',
        sectionBackgroundColor: '1F2937',
        sectionTextColor: 'F9FAFB'
    }
}

const getMimeTypeFromFilename = (fileName: string): string => {
    switch (path.extname(fileName).toLowerCase()) {
        case '.png':
            return 'image/png'
        case '.jpg':
        case '.jpeg':
            return 'image/jpeg'
        case '.gif':
            return 'image/gif'
        case '.webp':
            return 'image/webp'
        case '.svg':
            return 'image/svg+xml'
        default:
            return 'application/octet-stream'
    }
}

const normalizeOutputFileName = (fileName?: string, title?: string): string => {
    const preferredName = fileName?.trim() || title?.trim() || 'presentation'
    const sanitized = sanitize(preferredName).replace(/\.pptx$/i, '')
    const fallbackName = sanitized || 'presentation'
    return `${fallbackName}.pptx`
}

const normalizeSlideTitle = (title?: string): string | undefined => {
    const trimmedTitle = title?.trim()
    if (!trimmedTitle) {
        return undefined
    }

    return trimmedTitle.length > 80 ? `${trimmedTitle.slice(0, 77).trimEnd()}...` : trimmedTitle
}

const normalizeTextLikeValue = (value: unknown): string | undefined => {
    if (typeof value === 'string') {
        const trimmedValue = value.trim()
        return trimmedValue || undefined
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value)
    }

    if (Array.isArray(value)) {
        const normalizedItems = value.map((item) => normalizeTextLikeValue(item)).filter((item): item is string => Boolean(item))
        return normalizedItems.length ? normalizedItems.join('\n') : undefined
    }

    if (value && typeof value === 'object') {
        const normalizedEntries = Object.entries(value)
            .map(([key, childValue]) => {
                const normalizedChildValue = normalizeTextLikeValue(childValue)
                if (!normalizedChildValue) {
                    return undefined
                }

                return `${key}\n${normalizedChildValue}`
            })
            .filter((entry): entry is string => Boolean(entry))

        return normalizedEntries.length ? normalizedEntries.join('\n\n') : undefined
    }

    return undefined
}

const normalizeNullableValue = (value: unknown): unknown => {
    if (value === null) {
        return undefined
    }

    if (Array.isArray(value)) {
        return value.map((item) => normalizeNullableValue(item)).filter((item) => item !== undefined)
    }

    if (typeof value === 'object' && value !== null) {
        const normalizedObject: Record<string, unknown> = {}

        for (const [key, childValue] of Object.entries(value)) {
            const normalizedChildValue = normalizeNullableValue(childValue)
            if (normalizedChildValue !== undefined) {
                normalizedObject[key] = normalizedChildValue
            }
        }

        return normalizedObject
    }

    return value
}

const inferSlideTitle = (slide: Record<string, any>, index: number): string => {
    const candidateTitle = normalizeSlideTitle(slide.title)
    if (candidateTitle) {
        return candidateTitle
    }

    const fallbackCandidates = [
        slide.subtitle,
        slide.leftTitle,
        slide.rightTitle,
        Array.isArray(slide.bullets) ? slide.bullets[0] : undefined,
        Array.isArray(slide.leftBullets) ? slide.leftBullets[0] : undefined,
        Array.isArray(slide.rightBullets) ? slide.rightBullets[0] : undefined,
        slide.body,
        slide.leftBody,
        slide.rightBody
    ]

    for (const candidate of fallbackCandidates) {
        const normalizedCandidate = normalizeSlideTitle(candidate)
        if (normalizedCandidate) {
            return normalizedCandidate
        }
    }

    return `Slide ${index + 1}`
}

const hasTwoColumnContent = (slide: Record<string, any>): boolean => {
    return Boolean(
        normalizeTextLikeValue(slide.leftTitle) ||
            normalizeTextLikeValue(slide.leftBody) ||
            (Array.isArray(slide.leftBullets) && slide.leftBullets.length > 0) ||
            normalizeTextLikeValue(slide.rightTitle) ||
            normalizeTextLikeValue(slide.rightBody) ||
            (Array.isArray(slide.rightBullets) && slide.rightBullets.length > 0)
    )
}

const normalizeSlideLayout = (slide: Record<string, any>): (typeof SLIDE_LAYOUTS)[number] => {
    const rawLayout = typeof slide.layout === 'string' ? slide.layout.trim() : ''

    if (rawLayout && SLIDE_LAYOUTS.includes(rawLayout as (typeof SLIDE_LAYOUTS)[number])) {
        return rawLayout as (typeof SLIDE_LAYOUTS)[number]
    }

    if (rawLayout === 'title-body') {
        return 'title-bullets'
    }

    if (rawLayout === 'section-header') {
        return hasTwoColumnContent(slide) ? 'two-column' : 'section'
    }

    if (hasTwoColumnContent(slide)) {
        return 'two-column'
    }

    return 'title-bullets'
}

const normalizeRawPresentationSpec = (rawSpec: unknown): unknown => {
    if (!rawSpec || typeof rawSpec !== 'object' || Array.isArray(rawSpec)) {
        return rawSpec
    }

    const normalizedSpec = normalizeNullableValue(rawSpec) as Record<string, any>

    if (Array.isArray(normalizedSpec.slides)) {
        normalizedSpec.slides = normalizedSpec.slides.map((slide: unknown, index: number) => {
            if (!slide || typeof slide !== 'object' || Array.isArray(slide)) {
                return slide
            }

            const normalizedSlide = { ...(slide as Record<string, any>) }
            normalizedSlide.layout = normalizeSlideLayout(normalizedSlide)
            normalizedSlide.speakerNotes = normalizeTextLikeValue(normalizedSlide.speakerNotes)
            normalizedSlide.title = inferSlideTitle(normalizedSlide, index)
            return normalizedSlide
        })
    }

    return normalizedSpec
}

const decodeHtmlEntities = (value: string): string => {
    return value
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
}

const sanitizePresentationSpecString = (rawSpec: string): string => {
    let cleanedSpec = rawSpec.trim()

    const fencedMatch = cleanedSpec.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
    if (fencedMatch?.[1]) {
        cleanedSpec = fencedMatch[1].trim()
    }

    cleanedSpec = decodeHtmlEntities(cleanedSpec)

    if (cleanedSpec.includes('<')) {
        cleanedSpec = cleanedSpec.replace(/<[^>]+>/g, '').trim()
    }

    if (!cleanedSpec.startsWith('{')) {
        const objectStartIndex = cleanedSpec.indexOf('{')
        const objectEndIndex = cleanedSpec.lastIndexOf('}')
        if (objectStartIndex !== -1 && objectEndIndex > objectStartIndex) {
            cleanedSpec = cleanedSpec.slice(objectStartIndex, objectEndIndex + 1).trim()
        }
    }

    return cleanedSpec
}

const parsePresentationSpec = (rawSpec: string): unknown => {
    const trimmedSpec = rawSpec.trim()

    try {
        return JSON.parse(trimmedSpec)
    } catch (error) {
        const sanitizedSpec = sanitizePresentationSpecString(trimmedSpec)
        if (sanitizedSpec !== trimmedSpec) {
            return JSON.parse(sanitizedSpec)
        }

        throw error
    }
}

const formatBulletList = (bullets?: string[]): string => {
    if (!bullets || bullets.length === 0) {
        return ''
    }

    return bullets.map((bullet) => `• ${bullet}`).join('\n')
}

const mergeTextContent = (parts: Array<string | undefined>): string => {
    return parts.filter((part) => typeof part === 'string' && part.trim()).join('\n\n')
}

const buildTheme = (pptx: PptxGenJS, themePreset: (typeof THEME_PRESETS)[number]) => {
    pptx.author = 'Flowise'
    pptx.company = 'Flowise'
    pptx.subject = 'AI-generated presentation'
    pptx.theme = {
        headFontFace: 'Aptos Display',
        bodyFontFace: 'Aptos'
    }
    pptx.layout =
        themePreset === 'business-neutral' || themePreset === 'business-blue' || themePreset === 'clean-dark'
            ? 'LAYOUT_WIDE'
            : 'LAYOUT_WIDE'
}

const applyPresentationSize = (pptx: PptxGenJS, slideSize: (typeof SLIDE_SIZES)[number]) => {
    pptx.layout = slideSize === 'standard' ? 'LAYOUT_4x3' : 'LAYOUT_WIDE'
}

const addTitle = (slide: PptxGenJS.Slide, title: string, theme: IThemeConfig) => {
    slide.addText(title, {
        x: 0.7,
        y: 0.45,
        w: 11.9,
        h: 0.7,
        fontFace: 'Aptos Display',
        fontSize: 24,
        bold: true,
        color: theme.titleColor,
        margin: 0
    })
}

const addBodyText = (slide: PptxGenJS.Slide, text: string, x: number, y: number, w: number, h: number, theme: IThemeConfig) => {
    slide.addText(text, {
        x,
        y,
        w,
        h,
        fontFace: 'Aptos',
        fontSize: 15,
        color: theme.textColor,
        valign: 'top',
        margin: 0.06,
        breakLine: false,
        fit: 'shrink'
    })
}

const addSubtitleText = (slide: PptxGenJS.Slide, text: string, theme: IThemeConfig, y = 1.6) => {
    slide.addText(text, {
        x: 1.2,
        y,
        w: 10.9,
        h: 0.6,
        fontFace: 'Aptos',
        fontSize: 18,
        color: theme.mutedColor,
        align: 'center',
        margin: 0
    })
}

const addDivider = (slide: PptxGenJS.Slide, theme: IThemeConfig) => {
    slide.addShape('line', {
        x: 0.7,
        y: 1.18,
        w: 2.3,
        h: 0,
        line: {
            color: theme.accentColor,
            width: 1.5
        }
    })
}

const addImageToSlide = (slide: PptxGenJS.Slide, image: IStoredImage, x: number, y: number, w: number, h: number) => {
    slide.addImage({
        data: image.data,
        x,
        y,
        w,
        h
    })
}

const renderTitleSlide = (slide: PptxGenJS.Slide, spec: IPresentationSpec, theme: IThemeConfig) => {
    slide.background = { color: theme.backgroundColor }
    slide.addText(spec.title, {
        x: 1,
        y: 1.6,
        w: 11.3,
        h: 1.2,
        fontFace: 'Aptos Display',
        fontSize: 28,
        bold: true,
        color: theme.titleColor,
        align: 'center',
        valign: 'middle',
        margin: 0
    })

    if (spec.subtitle) {
        addSubtitleText(slide, spec.subtitle, theme, 3.0)
    }

    slide.addShape('line', {
        x: 4.75,
        y: 4.05,
        w: 3.8,
        h: 0,
        line: {
            color: theme.accentColor,
            width: 1.5
        }
    })
}

const renderSectionSlide = (slide: PptxGenJS.Slide, section: IPresentationSlide, theme: IThemeConfig) => {
    slide.background = { color: theme.sectionBackgroundColor }
    slide.addText(section.title, {
        x: 1,
        y: 2.1,
        w: 11.3,
        h: 0.9,
        fontFace: 'Aptos Display',
        fontSize: 26,
        bold: true,
        color: theme.sectionTextColor,
        align: 'center',
        valign: 'middle',
        margin: 0
    })

    const subtitle = mergeTextContent([section.subtitle, section.body])
    if (subtitle) {
        slide.addText(subtitle, {
            x: 1.2,
            y: 3.25,
            w: 10.9,
            h: 1.2,
            fontFace: 'Aptos',
            fontSize: 16,
            color: theme.mutedColor,
            align: 'center',
            fit: 'shrink',
            margin: 0
        })
    }
}

const renderTitleBulletsSlide = (slide: PptxGenJS.Slide, section: IPresentationSlide, theme: IThemeConfig, images: IStoredImage[]) => {
    slide.background = { color: theme.backgroundColor }
    addTitle(slide, section.title, theme)
    addDivider(slide, theme)

    const image = images[0]
    const bodyText = mergeTextContent([section.body, formatBulletList(section.bullets)])
    const hasImage = Boolean(image)

    if (bodyText) {
        addBodyText(slide, bodyText, 0.9, 1.55, hasImage ? 6.5 : 11.3, 4.9, theme)
    }

    if (hasImage && image) {
        addImageToSlide(slide, image, 8.25, 1.65, 4.1, 3.9)
    }
}

const renderImageRightSlide = (slide: PptxGenJS.Slide, section: IPresentationSlide, theme: IThemeConfig, images: IStoredImage[]) => {
    slide.background = { color: theme.backgroundColor }
    addTitle(slide, section.title, theme)
    addDivider(slide, theme)

    const textContent = mergeTextContent([section.body, formatBulletList(section.bullets)])
    if (textContent) {
        addBodyText(slide, textContent, 0.9, 1.55, 6.2, 4.95, theme)
    }

    if (images[0]) {
        addImageToSlide(slide, images[0], 7.7, 1.65, 4.45, 3.95)
    }
}

const renderTwoColumnSlide = (slide: PptxGenJS.Slide, section: IPresentationSlide, theme: IThemeConfig) => {
    slide.background = { color: theme.backgroundColor }
    addTitle(slide, section.title, theme)
    addDivider(slide, theme)

    const leftTitle = section.leftTitle || 'Column A'
    const rightTitle = section.rightTitle || 'Column B'
    const leftText = mergeTextContent([section.leftBody, formatBulletList(section.leftBullets)])
    const rightText = mergeTextContent([section.rightBody, formatBulletList(section.rightBullets)])

    slide.addText(leftTitle, {
        x: 0.9,
        y: 1.55,
        w: 5.45,
        h: 0.4,
        fontFace: 'Aptos Display',
        fontSize: 16,
        bold: true,
        color: theme.accentColor,
        margin: 0
    })
    slide.addText(rightTitle, {
        x: 6.95,
        y: 1.55,
        w: 5.45,
        h: 0.4,
        fontFace: 'Aptos Display',
        fontSize: 16,
        bold: true,
        color: theme.accentColor,
        margin: 0
    })
    if (leftText) {
        addBodyText(slide, leftText, 0.9, 2.0, 5.45, 4.6, theme)
    }
    if (rightText) {
        addBodyText(slide, rightText, 6.95, 2.0, 5.45, 4.6, theme)
    }
}

const renderSlide = (
    slide: PptxGenJS.Slide,
    spec: IPresentationSpec,
    section: IPresentationSlide,
    theme: IThemeConfig,
    images: IStoredImage[]
) => {
    switch (section.layout) {
        case 'title':
            renderTitleSlide(
                slide,
                {
                    ...spec,
                    title: section.title,
                    subtitle: section.subtitle || section.body || spec.subtitle
                },
                theme
            )
            break
        case 'section':
            renderSectionSlide(slide, section, theme)
            break
        case 'image-right':
            renderImageRightSlide(slide, section, theme, images)
            break
        case 'two-column':
            renderTwoColumnSlide(slide, section, theme)
            break
        case 'title-bullets':
        default:
            renderTitleBulletsSlide(slide, section, theme, images)
            break
    }
}

const getImageData = async (fileName: string, flowConfig?: ICommonObject): Promise<IStoredImage | null> => {
    const chatflowId = flowConfig?.chatflowId as string | undefined
    const chatId = flowConfig?.chatId as string | undefined

    if (!chatflowId || !chatId) {
        return null
    }

    const paths = [flowConfig?.orgId, chatflowId, chatId].filter(Boolean) as string[]
    const fileBuffer = await getFileFromStorage(fileName, ...paths)

    return {
        fileName,
        data: `${getMimeTypeFromFilename(fileName)};base64,${fileBuffer.toString('base64')}`
    }
}

export const normalizePresentationSpec = (rawSpec: unknown, overrides?: Partial<ICreatePresentationInput>): IPresentationSpec => {
    let parsedSpec = rawSpec

    if (typeof rawSpec === 'string') {
        parsedSpec = parsePresentationSpec(rawSpec)
    }

    const normalizedSpec = normalizeRawPresentationSpec(parsedSpec)
    const validatedSpec = PresentationSpecSchema.parse(normalizedSpec)

    return {
        ...validatedSpec,
        fileName: normalizeOutputFileName(overrides?.outputFileName || validatedSpec.fileName, validatedSpec.title),
        themePreset: overrides?.themePreset || validatedSpec.themePreset || 'business-neutral',
        slideSize: overrides?.slideSize || validatedSpec.slideSize || 'wide',
        includeSpeakerNotes: overrides?.includeSpeakerNotes ?? validatedSpec.includeSpeakerNotes ?? true
    }
}

export const buildPresentationBuffer = async (
    spec: IPresentationSpec,
    flowConfig?: ICommonObject
): Promise<{ buffer: Buffer; fileName: string; warnings: string[] }> => {
    const pptx = new PptxGenJS()
    const warnings: string[] = []
    const theme = themeConfigs[spec.themePreset || 'business-neutral']

    buildTheme(pptx, spec.themePreset || 'business-neutral')
    applyPresentationSize(pptx, spec.slideSize || 'wide')
    pptx.title = spec.title

    for (const slideSpec of spec.slides) {
        const slide = pptx.addSlide()
        const images: IStoredImage[] = []

        for (const imageFileName of slideSpec.imageFileNames || []) {
            try {
                const image = await getImageData(imageFileName, flowConfig)
                if (image) {
                    images.push(image)
                }
            } catch (error) {
                warnings.push(`Unable to load image: ${imageFileName}`)
            }
        }

        renderSlide(slide, spec, slideSpec, theme, images)

        if (spec.includeSpeakerNotes && slideSpec.speakerNotes) {
            slide.addNotes(slideSpec.speakerNotes)
        }
    }

    const buffer = (await pptx.write({ outputType: 'nodebuffer', compression: true })) as Buffer

    return {
        buffer,
        fileName: spec.fileName || normalizeOutputFileName(undefined, spec.title),
        warnings
    }
}

class CreatePresentationTool extends DynamicStructuredTool<typeof CreatePresentationSchema> {
    private defaultParams: ICommonObject

    constructor(args?: IRequestParameters) {
        super({
            name: 'create_presentation',
            description:
                'Create a downloadable PowerPoint (.pptx) presentation from a structured presentationSpec. Use uploaded image file names when imageFileNames are provided.',
            schema: CreatePresentationSchema,
            baseUrl: '',
            method: 'POST',
            headers: {}
        })

        this.defaultParams = args?.defaultParams || {}
    }

    protected async _call(
        arg: z.output<typeof CreatePresentationSchema>,
        _: unknown,
        flowConfig?: { sessionId?: string; chatId?: string; chatflowId?: string; orgId?: string; input?: string; state?: ICommonObject }
    ): Promise<string> {
        const params = {
            ...this.defaultParams,
            ...arg
        } as ICreatePresentationInput

        try {
            if (!flowConfig?.chatflowId || !flowConfig?.chatId) {
                throw new Error('chatflowId and chatId are required to store presentation output')
            }

            const spec = normalizePresentationSpec(params.presentationSpec, params)
            const { buffer, fileName, warnings } = await buildPresentationBuffer(spec, flowConfig)
            const storagePaths = [flowConfig.orgId, flowConfig.chatflowId, flowConfig.chatId].filter(Boolean) as string[]
            const savedFile = await addSingleFileToStorage(PPTX_MIME_TYPE, buffer, fileName, ...storagePaths)
            const storedFileName = savedFile.path.replace('FILE-STORAGE::', '')
            const summary = [
                `Created PowerPoint presentation "${storedFileName}" with ${spec.slides.length} slides.`,
                warnings.length ? `${warnings.length} image reference(s) were skipped.` : ''
            ]
                .filter(Boolean)
                .join(' ')

            return (
                summary +
                FILE_ANNOTATIONS_PREFIX +
                JSON.stringify([
                    {
                        filePath: savedFile.path,
                        fileName: storedFileName
                    }
                ]) +
                TOOL_ARGS_PREFIX +
                JSON.stringify({
                    outputFileName: storedFileName,
                    themePreset: spec.themePreset,
                    slideSize: spec.slideSize,
                    includeSpeakerNotes: spec.includeSpeakerNotes
                })
            )
        } catch (error) {
            return formatToolError(`Error creating presentation: ${error}`, params)
        }
    }
}

export const createPPTXPresentationTools = (args?: IRequestParameters): DynamicStructuredTool[] => {
    return [new CreatePresentationTool(args)]
}
