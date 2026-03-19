const containsNonTokenUsageSeed = (value: any): boolean => {
    if (!value || typeof value !== 'object') return false

    if (Array.isArray(value)) {
        return value.some((item) => containsNonTokenUsageSeed(item))
    }

    const billingMode = typeof value.billingMode === 'string' ? value.billingMode.trim().toLowerCase() : undefined
    if (billingMode && billingMode !== 'token') return true
    if (value.mediaBilling || value.mediaBillings) return true

    return Object.values(value).some((child) => containsNonTokenUsageSeed(child))
}

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
        const supplementalSeeds: any[] = []
        if (Array.isArray(agentFlowExecutedData) && agentFlowExecutedData.length > 0 && containsNonTokenUsageSeed(agentFlowExecutedData)) {
            supplementalSeeds.push(agentFlowExecutedData)
        }
        if (fallbackPayload !== null && fallbackPayload !== undefined && containsNonTokenUsageSeed(fallbackPayload)) {
            supplementalSeeds.push(fallbackPayload)
        }
        return supplementalSeeds
    }

    if (Array.isArray(agentFlowExecutedData) && agentFlowExecutedData.length > 0) {
        return [agentFlowExecutedData]
    }

    if (fallbackPayload !== null && fallbackPayload !== undefined) {
        return [fallbackPayload]
    }

    return []
}
