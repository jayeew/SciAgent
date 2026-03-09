import { StatusCodes } from 'http-status-codes'
import { getRunningExpressApp } from '../../utils/getRunningExpressApp'
import { InternalFlowiseError } from '../../errors/internalFlowiseError'
import { getErrorMessage } from '../../errors/utils'
import { getTextToSpeechBillingDetails, getVoices, ICommonObject, ITextToSpeechBillingResult } from 'flowise-components'
import { databaseEntities } from '../../utils'
import { WorkspaceCreditService } from '../../enterprise/services/workspace-credit.service'
import logger from '../../utils/logger'
import { TokenUsageService } from '../../enterprise/services/token-usage.service'

export enum TextToSpeechProvider {
    OPENAI = 'openai',
    ELEVEN_LABS = 'elevenlabs',
    ALIBABA = 'alibaba'
}

export interface TTSRequest {
    text: string
    provider: TextToSpeechProvider
    credentialId: string
    voice?: string
    model?: string
}

export interface TTSResponse {
    audioBuffer: Buffer
    contentType: string
}

interface IConsumeTextToSpeechCreditParams {
    text: string
    provider: string
    credentialId: string
    model?: string
    baseUrl?: string
    languageType?: string
    instructions?: string
    optimizeInstructions?: boolean
    workspaceId?: string
    userId?: string
    options: ICommonObject
}

interface IRecordTextToSpeechUsageParams {
    workspaceId?: string
    organizationId?: string
    userId?: string
    flowType: 'CHATFLOW' | 'AGENTFLOW' | 'ASSISTANT' | 'MULTIAGENT'
    flowId?: string
    chatId?: string
    chatMessageId?: string
    billingDetails?: ITextToSpeechBillingResult
    options: ICommonObject
}

const getVoicesForProvider = async (provider: string, credentialId?: string): Promise<any[]> => {
    try {
        if (!credentialId) {
            throw new InternalFlowiseError(StatusCodes.BAD_REQUEST, 'Credential ID required for this provider')
        }

        const appServer = getRunningExpressApp()
        const options = {
            orgId: '',
            chatflowid: '',
            chatId: '',
            appDataSource: appServer.AppDataSource,
            databaseEntities: databaseEntities
        }

        return await getVoices(provider, credentialId, options)
    } catch (error) {
        throw new InternalFlowiseError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Error: textToSpeechService.getVoices - ${getErrorMessage(error)}`
        )
    }
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
            `[text-to-speech] failed to resolve credential name for usage credentialId=${credentialId}: ${
                error instanceof Error ? error.message : error
            }`
        )
        return {
            credentialId,
            model
        }
    }
}

const consumeTextToSpeechCredit = async (params: IConsumeTextToSpeechCreditParams): Promise<ITextToSpeechBillingResult | undefined> => {
    const { text, provider, credentialId, model, baseUrl, languageType, instructions, optimizeInstructions, workspaceId, userId, options } =
        params

    if (provider !== TextToSpeechProvider.ALIBABA) return undefined

    if (!workspaceId || !userId) {
        logger.warn(
            `[text-to-speech] skip Alibaba TTS credit: missing workspaceId/userId workspaceId=${workspaceId || '-'} userId=${userId || '-'}`
        )
        return undefined
    }

    const billingDetails = await getTextToSpeechBillingDetails(
        text,
        {
            name: provider,
            credentialId,
            model,
            baseUrl,
            languageType,
            instructions,
            optimizeInstructions
        },
        options
    )

    if (!billingDetails) return undefined

    const characters = Number(billingDetails.usage?.characters)
    const inputRmbPer10kChars = Number(billingDetails.billing?.inputRmbPer10kChars)
    const normalizedCharacters = Number.isFinite(characters) && characters >= 0 ? characters : 0
    const normalizedInputRmbPer10kChars = Number.isFinite(inputRmbPer10kChars) && inputRmbPer10kChars >= 0 ? inputRmbPer10kChars : 0

    const workspaceCreditService = new WorkspaceCreditService()
    await workspaceCreditService.consumeCreditByTextCharacters(workspaceId, userId, {
        credentialId: billingDetails.credentialId || credentialId,
        provider: billingDetails.provider || provider,
        model: billingDetails.model || model,
        characters: normalizedCharacters,
        inputRmbPer10kChars: normalizedInputRmbPer10kChars
    })

    logger.info(
        `[text-to-speech] Alibaba TTS credit consumed credentialId=${billingDetails.credentialId || credentialId || '-'} model=${
            billingDetails.model || model || '-'
        } characters=${normalizedCharacters} inputRmbPer10kChars=${normalizedInputRmbPer10kChars}`
    )

    return billingDetails
}

const recordTextToSpeechTokenUsage = async (params: IRecordTextToSpeechUsageParams): Promise<void> => {
    const { workspaceId, organizationId, userId, flowType, flowId, chatId, chatMessageId, billingDetails, options } = params

    if (!workspaceId || !organizationId || !billingDetails) {
        return
    }

    const characters = Number(billingDetails.usage?.characters)
    const normalizedCharacters = Number.isFinite(characters) && characters >= 0 ? characters : 0
    if (normalizedCharacters <= 0) {
        return
    }

    const credentialAccess = await getCredentialAccessForUsage(billingDetails.credentialId, billingDetails.model, options)
    const tokenUsageService = new TokenUsageService()

    await tokenUsageService.recordTokenUsage({
        workspaceId,
        organizationId,
        userId,
        flowType,
        flowId,
        chatId,
        chatMessageId,
        usagePayloads: [
            {
                model: billingDetails.model,
                provider: billingDetails.provider,
                source: 'text_to_speech',
                usage: {
                    characters: normalizedCharacters,
                    inputCharacters: normalizedCharacters
                }
            }
        ],
        credentialAccesses: credentialAccess ? [credentialAccess] : []
    })
}

export default {
    getVoices: getVoicesForProvider,
    consumeTextToSpeechCredit,
    recordTextToSpeechTokenUsage
}
