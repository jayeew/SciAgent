import logger from '../../utils/logger'
import { WorkspaceCreditService } from '../../enterprise/services/workspace-credit.service'
import { ICommonObject } from 'flowise-components'

interface IMediaGenerationBillingDetails {
    provider: string
    credentialId?: string
    model?: string
    generatedImages: number
    inputRmbPerImage: number
}

interface IConsumeMediaGenerationCreditParams {
    workspaceId?: string
    userId?: string
    billingDetails?: IMediaGenerationBillingDetails
}

const getMediaGenerationBillingDetails = (result?: ICommonObject): IMediaGenerationBillingDetails | undefined => {
    const billingDetails = result?.mediaBilling as ICommonObject | undefined
    if (!billingDetails || typeof billingDetails !== 'object') return undefined

    const generatedImages = Number(billingDetails.generatedImages)
    const inputRmbPerImage = Number(billingDetails.inputRmbPerImage)

    return {
        provider: typeof billingDetails.provider === 'string' ? billingDetails.provider : 'unknown',
        credentialId: typeof billingDetails.credentialId === 'string' ? billingDetails.credentialId : undefined,
        model: typeof billingDetails.model === 'string' ? billingDetails.model : undefined,
        generatedImages: Number.isFinite(generatedImages) && generatedImages >= 0 ? generatedImages : 0,
        inputRmbPerImage: Number.isFinite(inputRmbPerImage) && inputRmbPerImage >= 0 ? inputRmbPerImage : 0
    }
}

const consumeMediaGenerationCredit = async (params: IConsumeMediaGenerationCreditParams) => {
    const { workspaceId, userId, billingDetails } = params
    if (!workspaceId || !userId || !billingDetails) return undefined
    if (billingDetails.generatedImages <= 0) return undefined

    const workspaceCreditService = new WorkspaceCreditService()
    await workspaceCreditService.consumeCreditByGeneratedImages(workspaceId, userId, {
        credentialId: billingDetails.credentialId,
        provider: billingDetails.provider,
        model: billingDetails.model,
        generatedImages: billingDetails.generatedImages,
        inputRmbPerImage: billingDetails.inputRmbPerImage
    })

    logger.info(
        `[media-generation] credit consumed credentialId=${billingDetails.credentialId || '-'} model=${
            billingDetails.model || '-'
        } generatedImages=${billingDetails.generatedImages} inputRmbPerImage=${billingDetails.inputRmbPerImage}`
    )

    return billingDetails
}

const getCredentialAccessForUsage = async (
    credentialId: string | undefined,
    model: string | undefined,
    options: ICommonObject
): Promise<{ credentialId?: string; credentialName?: string; model?: string } | undefined> => {
    if (!credentialId) return undefined

    const appDataSource = options.appDataSource
    const credentialEntity = options.databaseEntities?.Credential
    if (!appDataSource || !credentialEntity) {
        return {
            credentialId,
            model
        }
    }

    try {
        const credential = await appDataSource.getRepository(credentialEntity).findOneBy({ id: credentialId })
        return {
            credentialId,
            credentialName: credential?.name || credential?.credentialName,
            model
        }
    } catch (error) {
        logger.warn(
            `[media-generation] failed to resolve credential name for usage credentialId=${credentialId}: ${
                error instanceof Error ? error.message : error
            }`
        )
        return {
            credentialId,
            model
        }
    }
}

export default {
    getMediaGenerationBillingDetails,
    consumeMediaGenerationCredit,
    getCredentialAccessForUsage
}
