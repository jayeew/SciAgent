const { buildToolFlowConfig, getRecentImageUploadsFromUploads, resolveToolInputTemplate } = require('./Tool')

describe('Tool agentflow helpers', () => {
    it('should resolve flow state template variables for tool inputs', () => {
        const result = resolveToolInputTemplate('{{ $flow.state.presentationSpec }}', {
            question: 'Create a deck',
            form: {},
            flow: {
                state: {
                    presentationSpec: '```json\n{"title":"Quarterly Review","slides":[{"title":"Overview"}]}\n```'
                }
            }
        })

        expect(result).toBe('```json\n{"title":"Quarterly Review","slides":[{"title":"Overview"}]}\n```')
    })

    it('should resolve nested tool input values recursively', () => {
        const result = resolveToolInputTemplate(
            {
                presentationSpec: '{{ $flow.state.presentationSpec }}',
                note: 'Request: {{ question }}'
            },
            {
                question: 'Create a deck',
                form: {},
                flow: {
                    state: {
                        presentationSpec: '{"title":"Quarterly Review","slides":[{"title":"Overview"}]}'
                    }
                }
            }
        )

        expect(result).toEqual({
            presentationSpec: '{"title":"Quarterly Review","slides":[{"title":"Overview"}]}',
            note: 'Request: Create a deck'
        })
    })

    it('should include uploads and recentImageUploads in tool flow config', () => {
        const uploads = [
            {
                type: 'stored-file',
                name: 'FILE-STORAGE::figure.png',
                mime: 'image/png',
                data: ''
            },
            {
                type: 'stored-file',
                name: 'FILE-STORAGE::paper.pdf',
                mime: 'application/pdf',
                data: ''
            }
        ]

        expect(getRecentImageUploadsFromUploads(uploads)).toEqual([
            {
                type: 'stored-file',
                name: 'FILE-STORAGE::figure.png',
                mime: 'image/png',
                data: ''
            }
        ])

        expect(
            buildToolFlowConfig(
                {
                    chatflowid: 'flow-1',
                    sessionId: 'session-1',
                    chatId: 'chat-1',
                    orgId: 'org-1',
                    uploads,
                    agentflowRuntime: {
                        state: {
                            draftGenerationResult: '{"generatedImages":[]}'
                        }
                    }
                },
                'Refine the draft figure'
            )
        ).toEqual({
            chatflowId: 'flow-1',
            sessionId: 'session-1',
            chatId: 'chat-1',
            orgId: 'org-1',
            input: 'Refine the draft figure',
            state: {
                draftGenerationResult: '{"generatedImages":[]}'
            },
            uploads,
            recentImageUploads: [
                {
                    type: 'stored-file',
                    name: 'FILE-STORAGE::figure.png',
                    mime: 'image/png',
                    data: ''
                }
            ]
        })
    })
})
