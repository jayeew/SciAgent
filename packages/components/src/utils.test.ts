import { ensureStructuredOutputJsonHint } from './utils'

describe('ensureStructuredOutputJsonHint', () => {
    it('should append a json hint to string prompts when missing', () => {
        expect(ensureStructuredOutputJsonHint('Return the structured result.')).toContain('json')
    })

    it('should not modify string prompts that already mention json', () => {
        expect(ensureStructuredOutputJsonHint('Return valid json only.')).toBe('Return valid json only.')
    })

    it('should append a system message when message arrays do not mention json', () => {
        expect(
            ensureStructuredOutputJsonHint([
                {
                    role: 'user',
                    content: 'Please summarize the image.'
                }
            ])
        ).toEqual([
            {
                role: 'user',
                content: 'Please summarize the image.'
            },
            {
                role: 'system',
                content: 'Return the response as valid json only.'
            }
        ])
    })

    it('should keep message arrays unchanged when json is already present', () => {
        const messages = [
            {
                role: 'system',
                content: 'Return valid json only.'
            }
        ]

        expect(ensureStructuredOutputJsonHint(messages)).toBe(messages)
    })
})
