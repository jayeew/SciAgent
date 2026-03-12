jest.mock('../../../src/storageUtils', () => ({
    addSingleFileToStorage: jest.fn(),
    getFileFromStorage: jest.fn()
}))

jest.mock('pptxgenjs', () => {
    class MockSlide {
        addText() {
            return this
        }

        addShape() {
            return this
        }

        addImage() {
            return this
        }

        addNotes() {
            return this
        }
    }

    return class MockPptxGenJS {
        author?: string
        company?: string
        subject?: string
        theme?: Record<string, any>
        layout?: string
        title?: string
        slides: MockSlide[] = []

        addSlide() {
            const slide = new MockSlide()
            this.slides.push(slide)
            return slide
        }

        async write() {
            return Buffer.alloc(2048, 1)
        }
    }
})

import { addSingleFileToStorage, getFileFromStorage } from '../../../src/storageUtils'
import { FILE_ANNOTATIONS_PREFIX, parseToolOutput } from '../../../src/agents'
import { PPTX_MIME_TYPE, buildPresentationBuffer, createPPTXPresentationTools, normalizePresentationSpec } from './core'

const mockedAddSingleFileToStorage = addSingleFileToStorage as jest.MockedFunction<typeof addSingleFileToStorage>
const mockedGetFileFromStorage = getFileFromStorage as jest.MockedFunction<typeof getFileFromStorage>

const transparentPngBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WnSUswAAAAASUVORK5CYII=',
    'base64'
)

describe('PPTXPresentation core', () => {
    beforeEach(() => {
        mockedAddSingleFileToStorage.mockReset()
        mockedGetFileFromStorage.mockReset()
    })

    it('should normalize presentation spec with defaults', () => {
        const spec = normalizePresentationSpec({
            title: 'Quarterly Review',
            slides: [
                {
                    layout: 'title-bullets',
                    title: 'Overview',
                    bullets: ['Revenue up 12%', 'Margin stable']
                }
            ]
        })

        expect(spec.fileName).toBe('Quarterly Review.pptx')
        expect(spec.themePreset).toBe('business-neutral')
        expect(spec.slideSize).toBe('wide')
        expect(spec.includeSpeakerNotes).toBe(true)
    })

    it('should normalize HTML-wrapped presentation spec strings', () => {
        const spec = normalizePresentationSpec(
            `<p><span class="variable" data-type="mention" data-id="$flow.state.presentationSpec">{` +
                `"title":"Quarterly Review","slides":[{"layout":"title-bullets","title":"Overview","bullets":["Revenue up 12%"]}]` +
                `}</span></p>`
        )

        expect(spec.title).toBe('Quarterly Review')
        expect(spec.slides).toHaveLength(1)
        expect(spec.fileName).toBe('Quarterly Review.pptx')
    })

    it('should infer missing slide titles from other slide fields', () => {
        const spec = normalizePresentationSpec({
            title: 'Quarterly Review',
            slides: [
                {
                    layout: 'two-column',
                    leftTitle: '产品方案',
                    leftBullets: ['帮助客户提升效率 40%'],
                    rightTitle: '关键成果'
                },
                {
                    layout: 'image-right',
                    body: '市场规模预计达到 1500 亿元'
                }
            ]
        })

        expect(spec.slides[0].title).toBe('产品方案')
        expect(spec.slides[1].title).toBe('市场规模预计达到 1500 亿元')
    })

    it('should normalize nullable optional presentation fields', () => {
        const spec = normalizePresentationSpec({
            title: 'Quarterly Review',
            subtitle: null,
            slides: [
                {
                    layout: 'image-right',
                    title: 'Overview',
                    subtitle: null,
                    body: null,
                    bullets: ['Revenue up 12%', null, 'Margin stable'],
                    leftBody: null,
                    rightBody: null
                }
            ]
        })

        expect(spec.subtitle).toBeUndefined()
        expect(spec.slides[0].subtitle).toBeUndefined()
        expect(spec.slides[0].body).toBeUndefined()
        expect(spec.slides[0].leftBody).toBeUndefined()
        expect(spec.slides[0].rightBody).toBeUndefined()
        expect(spec.slides[0].bullets).toEqual(['Revenue up 12%', 'Margin stable'])
    })

    it('should build a non-empty pptx buffer', async () => {
        const spec = normalizePresentationSpec({
            title: 'Quarterly Review',
            fileName: 'quarterly-review',
            slides: [
                {
                    layout: 'title',
                    title: 'Quarterly Review',
                    subtitle: 'Executive Summary'
                },
                {
                    layout: 'title-bullets',
                    title: 'Highlights',
                    bullets: ['Revenue up 12%', 'Margin stable', 'Pipeline healthy'],
                    speakerNotes: 'Keep the narration short.'
                }
            ]
        })

        const { buffer, fileName } = await buildPresentationBuffer(spec)

        expect(fileName).toBe('quarterly-review.pptx')
        expect(Buffer.isBuffer(buffer)).toBe(true)
        expect(buffer.length).toBeGreaterThan(1000)
    })

    it('should load stored images when imageFileNames are provided', async () => {
        mockedGetFileFromStorage.mockResolvedValue(transparentPngBuffer)

        const spec = normalizePresentationSpec({
            title: 'Image Deck',
            slides: [
                {
                    layout: 'image-right',
                    title: 'Visual Summary',
                    body: 'Key chart on the right.',
                    imageFileNames: ['cover.png']
                }
            ]
        })

        const result = await buildPresentationBuffer(spec, {
            orgId: 'org-1',
            chatflowId: 'flow-1',
            chatId: 'chat-1'
        })

        expect(result.buffer.length).toBeGreaterThan(1000)
        expect(mockedGetFileFromStorage).toHaveBeenCalledWith('cover.png', 'org-1', 'flow-1', 'chat-1')
    })

    it('should save generated pptx and emit file annotations', async () => {
        mockedAddSingleFileToStorage.mockResolvedValue({
            path: 'FILE-STORAGE::quarterly-review.pptx',
            totalSize: 0.1
        })

        const [tool] = createPPTXPresentationTools()

        const result = await (tool as any).call(
            {
                presentationSpec: JSON.stringify({
                    title: 'Quarterly Review',
                    slides: [
                        {
                            layout: 'title-bullets',
                            title: 'Highlights',
                            bullets: ['Revenue up 12%', 'Margin stable']
                        }
                    ]
                })
            },
            undefined,
            undefined,
            {
                orgId: 'org-1',
                chatflowId: 'flow-1',
                chatId: 'chat-1'
            }
        )

        expect(result).toContain(FILE_ANNOTATIONS_PREFIX)
        expect(mockedAddSingleFileToStorage).toHaveBeenCalledWith(
            PPTX_MIME_TYPE,
            expect.any(Buffer),
            'Quarterly Review.pptx',
            'org-1',
            'flow-1',
            'chat-1'
        )

        const parsed = parseToolOutput(result)
        expect(parsed.fileAnnotations).toEqual([{ fileName: 'quarterly-review.pptx', filePath: 'FILE-STORAGE::quarterly-review.pptx' }])
        expect(parsed.output).toContain('Created PowerPoint presentation')
    })
})
