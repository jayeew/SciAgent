import { ARTIFACTS_PREFIX, FILE_ANNOTATIONS_PREFIX, SOURCE_DOCUMENTS_PREFIX, TOOL_ARGS_PREFIX, parseToolOutput } from './agents'

describe('parseToolOutput', () => {
    it('should parse file annotations and tool args from tool output', () => {
        const toolOutput =
            'Created deck.' +
            FILE_ANNOTATIONS_PREFIX +
            JSON.stringify([{ fileName: 'deck.pptx', filePath: 'FILE-STORAGE::deck.pptx' }]) +
            TOOL_ARGS_PREFIX +
            JSON.stringify({ slideSize: 'wide' })

        const parsed = parseToolOutput(toolOutput)

        expect(parsed.output).toBe('Created deck.')
        expect(parsed.fileAnnotations).toEqual([{ fileName: 'deck.pptx', filePath: 'FILE-STORAGE::deck.pptx' }])
        expect(parsed.toolArgs).toEqual({ slideSize: 'wide' })
    })

    it('should parse stacked payloads in reverse suffix order', () => {
        const toolOutput =
            'Completed.' +
            SOURCE_DOCUMENTS_PREFIX +
            JSON.stringify([{ pageContent: 'source' }]) +
            ARTIFACTS_PREFIX +
            JSON.stringify([{ type: 'markdown', data: '# summary' }]) +
            FILE_ANNOTATIONS_PREFIX +
            JSON.stringify([{ fileName: 'deck.pptx', filePath: 'FILE-STORAGE::deck.pptx' }]) +
            TOOL_ARGS_PREFIX +
            JSON.stringify({ outputFileName: 'deck.pptx' })

        const parsed = parseToolOutput(toolOutput)

        expect(parsed.output).toBe('Completed.')
        expect(parsed.sourceDocuments).toEqual([{ pageContent: 'source' }])
        expect(parsed.artifacts).toEqual([{ type: 'markdown', data: '# summary' }])
        expect(parsed.fileAnnotations).toEqual([{ fileName: 'deck.pptx', filePath: 'FILE-STORAGE::deck.pptx' }])
        expect(parsed.toolArgs).toEqual({ outputFileName: 'deck.pptx' })
    })
})
