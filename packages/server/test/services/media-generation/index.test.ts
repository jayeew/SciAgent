const mockConsumeCreditByBillingUsages = jest.fn()

jest.mock('../../../src/enterprise/services/workspace-credit.service', () => ({
    WorkspaceCreditService: jest.fn().mockImplementation(() => ({
        consumeCreditByBillingUsages: mockConsumeCreditByBillingUsages
    }))
}))

jest.mock('../../../src/utils/logger', () => ({
    __esModule: true,
    default: {
        info: jest.fn(),
        warn: jest.fn()
    }
}))

import mediaGenerationService from '../../../src/services/media-generation'

describe('mediaGenerationService', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    it('parses Doubao video token billing details', () => {
        const billingDetails = mediaGenerationService.getMediaGenerationBillingDetails({
            mediaBilling: {
                provider: 'doubao-ark',
                credentialId: 'credential-1',
                model: 'doubao-seedance-1-5-pro-251215',
                source: 'media_generation',
                tokenUsageCredentialCallId: 'call-1',
                billingMode: 'token',
                usage: {
                    outputTokens: 108900,
                    totalTokens: 108900
                }
            }
        } as any)

        expect(billingDetails).toEqual({
            provider: 'doubao-ark',
            credentialId: 'credential-1',
            model: 'doubao-seedance-1-5-pro-251215',
            source: 'media_generation',
            tokenUsageCredentialCallId: 'call-1',
            billingMode: 'token',
            usage: {
                outputTokens: 108900,
                totalTokens: 108900
            }
        })
    })

    it('parses Alibaba image count billing details', () => {
        const billingDetails = mediaGenerationService.getMediaGenerationBillingDetails({
            mediaBilling: {
                provider: 'alibaba-dashscope',
                credentialId: 'credential-2',
                model: 'qwen-image-2.0-pro',
                source: 'media_generation',
                tokenUsageCredentialCallId: 'call-img-1',
                billingMode: 'image_count',
                usage: {
                    units: 3
                }
            }
        } as any)

        expect(billingDetails).toEqual({
            provider: 'alibaba-dashscope',
            credentialId: 'credential-2',
            model: 'qwen-image-2.0-pro',
            source: 'media_generation',
            tokenUsageCredentialCallId: 'call-img-1',
            billingMode: 'image_count',
            usage: {
                units: 3
            }
        })
    })

    it('reuses or generates tokenUsageCredentialCallId', () => {
        const existingBilling = {
            tokenUsageCredentialCallId: 'existing-call-id'
        }
        expect(mediaGenerationService.ensureMediaGenerationCredentialCallId(existingBilling as any)).toBe('existing-call-id')

        const generatedBilling: Record<string, any> = {}
        const generatedCallId = mediaGenerationService.ensureMediaGenerationCredentialCallId(generatedBilling as any)

        expect(typeof generatedCallId).toBe('string')
        expect(generatedCallId).toBeTruthy()
        expect(generatedBilling.tokenUsageCredentialCallId).toBe(generatedCallId)
    })

    it('records credential access for video token billing', async () => {
        const tokenAuditContext: Record<string, any> = {}
        const findOneBy = jest.fn().mockResolvedValue({
            name: 'Doubao Ark Credential'
        })

        const result = await mediaGenerationService.recordMediaGenerationCredentialAccess({
            billingDetails: {
                provider: 'doubao-ark',
                credentialId: 'credential-1',
                model: 'doubao-seedance-1-5-pro-251215',
                source: 'media_generation',
                tokenUsageCredentialCallId: 'call-1',
                billingMode: 'token',
                usage: {
                    totalTokens: 108900
                }
            },
            tokenAuditContext,
            options: {
                appDataSource: {
                    getRepository: jest.fn().mockReturnValue({
                        findOneBy
                    })
                },
                databaseEntities: {
                    Credential: {}
                }
            } as any
        })

        expect(findOneBy).toHaveBeenCalledWith({ id: 'credential-1' })
        expect(result).toEqual({
            credentialId: 'credential-1',
            credentialName: 'Doubao Ark Credential',
            model: 'doubao-seedance-1-5-pro-251215',
            provider: 'doubao-ark',
            tokenUsageCredentialCallId: 'call-1'
        })
        expect(tokenAuditContext.credentialAccesses).toEqual([result])
    })

    it('appends explicit media usage events before token usage recording', () => {
        const tokenAuditContext: Record<string, any> = {}

        const payload = mediaGenerationService.appendMediaGenerationUsageEvent({
            billingDetails: {
                provider: 'doubao-ark',
                credentialId: 'credential-1',
                credentialName: 'Doubao Ark Credential',
                model: 'doubao-seedream-5-0-260128',
                source: 'media_generation',
                tokenUsageCredentialCallId: 'call-2',
                billingMode: 'image_count',
                usage: {
                    units: 2
                }
            },
            tokenAuditContext
        })

        expect(payload).toEqual({
            provider: 'doubao-ark',
            credentialId: 'credential-1',
            credentialName: 'Doubao Ark Credential',
            model: 'doubao-seedream-5-0-260128',
            source: 'media_generation',
            tokenUsageCredentialCallId: 'call-2',
            billingMode: 'image_count',
            usage: {
                units: 2
            }
        })
        expect(tokenAuditContext.tokenUsagePayloads).toEqual([payload])
    })

    it('consumes credit for video token billing', async () => {
        mockConsumeCreditByBillingUsages.mockResolvedValue({
            creditConsumed: 120,
            creditBalance: 880
        })

        const billingDetails = {
            provider: 'doubao-ark',
            credentialId: 'credential-1',
            model: 'doubao-seedance-1-5-pro-251215',
            source: 'media_generation',
            tokenUsageCredentialCallId: 'call-1',
            billingMode: 'token' as const,
            usage: {
                totalTokens: 108900
            }
        }

        const result = await mediaGenerationService.consumeMediaGenerationCredit({
            workspaceId: 'workspace-1',
            userId: 'user-1',
            billingDetails
        })

        expect(mockConsumeCreditByBillingUsages).toHaveBeenCalledWith('workspace-1', 'user-1', [billingDetails])
        expect(result).toBe(billingDetails)
    })
})
