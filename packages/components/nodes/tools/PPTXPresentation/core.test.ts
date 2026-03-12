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
