import {
    buildStructuredOutputExactKeyHint,
    buildStructuredOutputSchema,
    ensureStructuredOutputInstructions,
    ensureStructuredOutputJsonHint,
    parseWithTypeConversion
} from './utils'

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

describe('buildStructuredOutputExactKeyHint', () => {
    it('should include exact keys and enum values in the schema hint', () => {
        expect(
            buildStructuredOutputExactKeyHint([
                {
                    key: 'riskLevel',
                    type: 'enum',
                    enumValues: 'green, yellow, red',
                    description: '风险等级'
                }
            ])
        ).toContain('- riskLevel: enum(green | yellow | red). 风险等级')
    })
})

describe('buildStructuredOutputSchema', () => {
    it('should build a schema that supports type conversion for fallback parsing', async () => {
        const schema = buildStructuredOutputSchema([
            {
                key: 'chiefComplaint',
                type: 'string'
            },
            {
                key: 'mustSeekUrgentCare',
                type: 'boolean'
            },
            {
                key: 'missingCriticalInfo',
                type: 'stringArray'
            }
        ])

        await expect(
            parseWithTypeConversion(schema, {
                chiefComplaint: '胸痛',
                mustSeekUrgentCare: 'true',
                missingCriticalInfo: ['心电图', '血压']
            })
        ).resolves.toEqual({
            chiefComplaint: '胸痛',
            mustSeekUrgentCare: true,
            missingCriticalInfo: ['心电图', '血压']
        })
    })
})

describe('ensureStructuredOutputInstructions', () => {
    it('should append exact-key instructions to string prompts', () => {
        expect(
            ensureStructuredOutputInstructions('Return the structured result.', [
                {
                    key: 'chiefComplaint',
                    type: 'string',
                    description: '本次问诊的主诉'
                }
            ])
        ).toContain('Use exactly the JSON keys listed below.')
    })

    it('should append a system message with exact-key instructions to message arrays', () => {
        expect(
            ensureStructuredOutputInstructions(
                [
                    {
                        role: 'user',
                        content: 'Please summarize the image.'
                    }
                ],
                [
                    {
                        key: 'chiefComplaint',
                        type: 'string',
                        description: '本次问诊的主诉'
                    }
                ]
            )
        ).toEqual([
            {
                role: 'user',
                content: 'Please summarize the image.'
            },
            {
                role: 'system',
                content: 'Return the response as valid json only.'
            },
            {
                role: 'system',
                content:
                    'Use exactly the JSON keys listed below.\n' +
                    'Do not translate, localize, rename, omit, or add keys.\n' +
                    'Every listed key is required. Keep keys exactly as written even if the field values are in another language.\n' +
                    'Use JSON arrays for array fields and schema-compatible primitive values for every field.\n' +
                    'Required schema:\n' +
                    '- chiefComplaint: string. 本次问诊的主诉'
            }
        ])
    })

    it('should not duplicate exact-key instructions when they already exist', () => {
        const prompt = ensureStructuredOutputInstructions('Return the structured result.', [
            {
                key: 'chiefComplaint',
                type: 'string',
                description: '本次问诊的主诉'
            }
        ])

        expect(ensureStructuredOutputInstructions(prompt, [{ key: 'chiefComplaint', type: 'string' }])).toBe(prompt)
    })
})
