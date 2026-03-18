import { getAgentflowTokenUsagePayloadSeeds } from '../../src/utils/agentflowTokenUsage'

describe('agentflowTokenUsage utility', () => {
    it('prefers audited token usage payloads over execution trace seeds', () => {
        const agentFlowExecutedData = [{ nodeId: 'llmAgentflow_0', data: { output: { usage_metadata: { total_tokens: 42 } } } }]
        const tokenAuditContext = {
            tokenUsagePayloads: [{ model: 'moonshot-v1-8k', usage_metadata: { input_tokens: 20, output_tokens: 22, total_tokens: 42 } }]
        }

        const seeds = getAgentflowTokenUsagePayloadSeeds({
            agentFlowExecutedData,
            tokenAuditContext
        })

        expect(seeds).toEqual([])
    })

    it('falls back to execution trace when no audited payload is available', () => {
        const agentFlowExecutedData = [{ nodeId: 'llmAgentflow_0', data: { output: { usage_metadata: { total_tokens: 42 } } } }]

        const seeds = getAgentflowTokenUsagePayloadSeeds({
            agentFlowExecutedData,
            tokenAuditContext: {
                tokenUsagePayloads: []
            }
        })

        expect(seeds).toEqual([agentFlowExecutedData])
    })

    it('falls back to the provided payload when execution trace is empty', () => {
        const fallbackPayload = { output: { usage_metadata: { total_tokens: 12 } } }

        const seeds = getAgentflowTokenUsagePayloadSeeds({
            fallbackPayload,
            tokenAuditContext: {
                tokenUsagePayloads: []
            }
        })

        expect(seeds).toEqual([fallbackPayload])
    })
})
