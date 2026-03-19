import { OTLPTraceExporter as ProtoOTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto'
import { createTokenUsageAuditCallbacks, getPhoenixTracer } from './handler'

jest.mock('@opentelemetry/exporter-trace-otlp-proto', () => {
    return {
        OTLPTraceExporter: jest.fn().mockImplementation((args) => {
            return { args }
        })
    }
})

describe('URL Handling For Phoenix Tracer', () => {
    const apiKey = 'test-api-key'
    const projectName = 'test-project-name'

    const makeOptions = (baseUrl: string) => ({
        baseUrl,
        apiKey,
        projectName,
        enableCallback: false
    })

    beforeEach(() => {
        jest.clearAllMocks()
    })

    const cases: [string, string][] = [
        ['http://localhost:6006', 'http://localhost:6006/v1/traces'],
        ['http://localhost:6006/v1/traces', 'http://localhost:6006/v1/traces'],
        ['https://app.phoenix.arize.com', 'https://app.phoenix.arize.com/v1/traces'],
        ['https://app.phoenix.arize.com/v1/traces', 'https://app.phoenix.arize.com/v1/traces'],
        ['https://app.phoenix.arize.com/s/my-space', 'https://app.phoenix.arize.com/s/my-space/v1/traces'],
        ['https://app.phoenix.arize.com/s/my-space/v1/traces', 'https://app.phoenix.arize.com/s/my-space/v1/traces'],
        ['https://my-phoenix.com/my-slug', 'https://my-phoenix.com/my-slug/v1/traces'],
        ['https://my-phoenix.com/my-slug/v1/traces', 'https://my-phoenix.com/my-slug/v1/traces']
    ]

    it.each(cases)('baseUrl %s - exporterUrl %s', (input, expected) => {
        getPhoenixTracer(makeOptions(input))
        expect(ProtoOTLPTraceExporter).toHaveBeenCalledWith(
            expect.objectContaining({
                url: expected,
                headers: expect.objectContaining({
                    api_key: apiKey,
                    authorization: `Bearer ${apiKey}`
                })
            })
        )
    })
})

describe('Token usage audit callbacks', () => {
    it('records aligned payload and credential access metadata exactly once per run id', async () => {
        const tokenAuditContext: Record<string, any> = {
            credentialMetadataById: {
                'credential-1': {
                    credentialName: 'DeepSeek Credential'
                }
            }
        }
        const [callback] = createTokenUsageAuditCallbacks({
            tokenAuditContext,
            credentialId: 'credential-1',
            model: 'deepseek-chat',
            provider: 'chatDeepseek',
            tokenUsageCredentialCallId: 'call-1'
        })

        const output = {
            generations: [
                [
                    {
                        message: {
                            usage_metadata: {
                                input_tokens: 10,
                                output_tokens: 5,
                                total_tokens: 15
                            }
                        }
                    }
                ]
            ]
        }

        await callback.handleLLMStart({} as any, [], 'run-1')
        await callback.handleLLMEnd(output, 'run-1')
        await callback.handleLLMEnd(output, 'run-1')

        expect(tokenAuditContext.tokenUsagePayloads).toEqual([
            expect.objectContaining({
                auditSource: 'llm_callback',
                tokenUsageCredentialCallId: 'call-1',
                credentialId: 'credential-1',
                credentialName: 'DeepSeek Credential',
                model: 'deepseek-chat',
                provider: 'chatDeepseek',
                output
            })
        ])
        expect(tokenAuditContext.credentialAccesses).toEqual([
            expect.objectContaining({
                credentialId: 'credential-1',
                credentialName: 'DeepSeek Credential',
                model: 'deepseek-chat',
                provider: 'chatDeepseek',
                tokenUsageCredentialCallId: 'call-1'
            })
        ])
    })

    it('assigns a distinct call id to each LLM run handled by the same callback instance', async () => {
        const tokenAuditContext: Record<string, any> = {
            credentialMetadataById: {
                'credential-1': {
                    credentialName: 'DeepSeek Credential'
                }
            }
        }
        const [callback] = createTokenUsageAuditCallbacks({
            tokenAuditContext,
            credentialId: 'credential-1',
            model: 'deepseek-chat',
            provider: 'chatDeepseek'
        })

        const output = {
            generations: [
                [
                    {
                        message: {
                            usage_metadata: {
                                input_tokens: 10,
                                output_tokens: 5,
                                total_tokens: 15
                            }
                        }
                    }
                ]
            ]
        }

        await callback.handleLLMStart({} as any, [], 'run-1')
        await callback.handleLLMEnd(output, 'run-1')
        await callback.handleLLMStart({} as any, [], 'run-2')
        await callback.handleLLMEnd(output, 'run-2')

        expect(tokenAuditContext.tokenUsagePayloads).toHaveLength(2)
        expect(tokenAuditContext.credentialAccesses).toHaveLength(2)
        expect(tokenAuditContext.tokenUsagePayloads[0].tokenUsageCredentialCallId).not.toBe(
            tokenAuditContext.tokenUsagePayloads[1].tokenUsageCredentialCallId
        )
        expect(tokenAuditContext.credentialAccesses[0].tokenUsageCredentialCallId).toBe(
            tokenAuditContext.tokenUsagePayloads[0].tokenUsageCredentialCallId
        )
        expect(tokenAuditContext.credentialAccesses[1].tokenUsageCredentialCallId).toBe(
            tokenAuditContext.tokenUsagePayloads[1].tokenUsageCredentialCallId
        )
    })
})
