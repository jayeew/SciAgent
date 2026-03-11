import { getEffectiveCredentialBillingRules, getResolvedRuleForUsage } from '../../src/utils/credentialBilling'

describe('credentialBilling utility', () => {
    it('resolves an exact token billing rule match', () => {
        const credential = {
            billingRules: JSON.stringify({
                'doubao-seedance-1-5-pro-251215': {
                    billingMode: 'token',
                    multiplier: 1.2,
                    inputRmbPerMTok: 0.8,
                    outputRmbPerMTok: 1.6
                }
            })
        }

        const resolved = getResolvedRuleForUsage(credential as any, undefined, {
            provider: 'doubao-ark',
            model: 'doubao-seedance-1-5-pro-251215',
            billingMode: 'token',
            usage: {
                inputTokens: 1000,
                outputTokens: 2000
            }
        })

        expect(resolved.source).toBe('billing_rules')
        expect(resolved.modeMismatch).toBe(false)
        expect(resolved.rule).toEqual({
            billingMode: 'token',
            multiplier: 1.2,
            inputRmbPerMTok: 0.8,
            outputRmbPerMTok: 1.6
        })
    })

    it('resolves an exact image_count billing rule match', () => {
        const credential = {
            billingRules: JSON.stringify({
                'doubao-seedream-5-0-260128': {
                    billingMode: 'image_count',
                    multiplier: 1,
                    rmbPerUnit: 0.22
                }
            })
        }

        const resolved = getResolvedRuleForUsage(credential as any, undefined, {
            provider: 'doubao-ark',
            model: 'doubao-seedream-5-0-260128',
            billingMode: 'image_count',
            usage: {
                units: 2
            }
        })

        expect(resolved.source).toBe('billing_rules')
        expect(resolved.modeMismatch).toBe(false)
        expect(resolved.rule).toEqual({
            billingMode: 'image_count',
            multiplier: 1,
            rmbPerUnit: 0.22
        })
    })

    it('returns missing when no exact rule or legacy fallback exists', () => {
        const resolved = getResolvedRuleForUsage(undefined, undefined, {
            provider: 'doubao-ark',
            model: 'missing-model',
            billingMode: 'token',
            usage: {
                totalTokens: 1234
            }
        })

        expect(resolved.source).toBe('missing')
        expect(resolved.modeMismatch).toBe(false)
        expect(resolved.rule).toBeUndefined()
    })

    it('converts legacy model multipliers into token billing rules', () => {
        const effectiveRules = getEffectiveCredentialBillingRules({
            billingRules: undefined,
            creditConsumptionMultiplierByModel: JSON.stringify({
                'gpt-4o-mini': {
                    multiplier: 1.5,
                    inputRmbPerMTok: 0.3,
                    outputRmbPerMTok: 0.6
                }
            })
        } as any)

        expect(effectiveRules).toEqual({
            'gpt-4o-mini': {
                billingMode: 'token',
                multiplier: 1.5,
                inputRmbPerMTok: 0.3,
                outputRmbPerMTok: 0.6
            }
        })
    })

    it('applies legacy image fallback only to image_count mode', () => {
        const plainDataObj = {
            inputRmbPerImage: 0.22
        }

        const imageResolved = getResolvedRuleForUsage(undefined, plainDataObj, {
            provider: 'doubao-ark',
            model: 'doubao-seedream-5-0-260128',
            billingMode: 'image_count',
            usage: {
                units: 1
            }
        })
        const tokenResolved = getResolvedRuleForUsage(undefined, plainDataObj, {
            provider: 'doubao-ark',
            model: 'doubao-seedance-1-5-pro-251215',
            billingMode: 'token',
            usage: {
                totalTokens: 108900
            }
        })

        expect(imageResolved.source).toBe('legacy_compatibility')
        expect(imageResolved.modeMismatch).toBe(false)
        expect(imageResolved.rule).toEqual({
            billingMode: 'image_count',
            multiplier: 1,
            rmbPerUnit: 0.22
        })

        expect(tokenResolved.source).toBe('missing')
        expect(tokenResolved.modeMismatch).toBe(false)
        expect(tokenResolved.rule).toBeUndefined()
    })

    it('flags a mode mismatch instead of auto-switching billing modes', () => {
        const credential = {
            billingRules: JSON.stringify({
                'doubao-seedance-1-5-pro-251215': {
                    billingMode: 'image_count',
                    multiplier: 1,
                    rmbPerUnit: 5
                }
            })
        }

        const resolved = getResolvedRuleForUsage(credential as any, undefined, {
            provider: 'doubao-ark',
            model: 'doubao-seedance-1-5-pro-251215',
            billingMode: 'token',
            usage: {
                totalTokens: 108900
            }
        })

        expect(resolved.source).toBe('billing_rules')
        expect(resolved.modeMismatch).toBe(true)
        expect(resolved.rule).toEqual({
            billingMode: 'image_count',
            multiplier: 1,
            rmbPerUnit: 5
        })
    })
})
