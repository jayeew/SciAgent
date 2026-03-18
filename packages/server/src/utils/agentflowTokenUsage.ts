export const getAgentflowTokenUsagePayloadSeeds = ({
    agentFlowExecutedData,
    fallbackPayload,
    tokenAuditContext
}: {
    agentFlowExecutedData?: any[]
    fallbackPayload?: any
    tokenAuditContext?: Record<string, any>
}): any[] => {
    const auditedPayloads = Array.isArray(tokenAuditContext?.tokenUsagePayloads)
        ? (tokenAuditContext?.tokenUsagePayloads as any[]).filter((payload) => payload !== null && payload !== undefined)
        : []

    // When the callback audit already captured raw model usage payloads, prefer those.
    if (auditedPayloads.length > 0) {
        return []
    }

    if (Array.isArray(agentFlowExecutedData) && agentFlowExecutedData.length > 0) {
        return [agentFlowExecutedData]
    }

    if (fallbackPayload !== null && fallbackPayload !== undefined) {
        return [fallbackPayload]
    }

    return []
}
