const { resolveToolInputTemplate } = require('./Tool')

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
})
