import { StatusCodes } from 'http-status-codes'
import { getRunningExpressApp } from '../../utils/getRunningExpressApp'
import { InternalFlowiseError } from '../../errors/internalFlowiseError'
import { getErrorMessage } from '../../errors/utils'
import { getVoices, ICommonObject, ITextToSpeechBillingResult, supportsTextToSpeechProviderUsageMetering } from 'flowise-components'
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
    provider: string
    credentialId: string
    model?: string
    billingDetails?: ITextToSpeechBillingResult
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
    executionId?: string
    idempotencyKey?: string
    chatId?: string
    chatMessageId?: string
    billingDetails?: ITextToSpeechBillingResult
    options: ICommonObject
}

const buildTextToSpeechIdempotencyKey = (params: {
    flowType: string
    flowId?: string
    executionId?: string
    chatId?: string
    chatMessageId?: string
    tokenUsageCredentialCallId?: string
}) =>
    `tts:${params.flowType}:${params.flowId || '-'}:${params.executionId || '-'}:${params.chatId || '-'}:${params.chatMessageId || '-'}:${
        params.tokenUsageCredentialCallId || '-'
    }`

const buildTextToSpeechMeteringUnsupportedError = (provider: string) =>
    new InternalFlowiseError(
        StatusCodes.BAD_REQUEST,
        `Metering unsupported for text-to-speech provider "${provider}" without real provider usage`
    )

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
    provider: string | undefined,
    tokenUsageCredentialCallId: string | undefined,
    options: ICommonObject
): Promise<
    { credentialId?: string; credentialName?: string; model?: string; provider?: string; tokenUsageCredentialCallId?: string } | undefined
> => {
    if (!credentialId) return undefined

    const appDataSource = options.appDataSource
    const credentialEntity = options.databaseEntities?.Credential
    if (!appDataSource || !credentialEntity) {
        return {
            credentialId,
            model,
            provider,
            tokenUsageCredentialCallId
        }
    }

    try {
        const credential = await appDataSource.getRepository(credentialEntity).findOneBy({ id: credentialId })
        return {
            credentialId,
            credentialName: credential?.name || credential?.credentialName,
            model,
            provider,
            tokenUsageCredentialCallId
        }
    } catch (error) {
        logger.warn(
            `[text-to-speech] failed to resolve credential name for usage credentialId=${credentialId}: ${
                error instanceof Error ? error.message : error
            }`
        )
        return {
            credentialId,
            model,
            provider,
            tokenUsageCredentialCallId
        }
    }
}

const consumeTextToSpeechCredit = async (params: IConsumeTextToSpeechCreditParams): Promise<ITextToSpeechBillingResult | undefined> => {
    const { provider, credentialId, model, billingDetails, workspaceId, userId } = params

    if (!workspaceId || !userId) {
        return billingDetails
    }

    if (!supportsTextToSpeechProviderUsageMetering(provider)) {
        throw buildTextToSpeechMeteringUnsupportedError(provider)
    }

    if (!billingDetails) {
        throw buildTextToSpeechMeteringUnsupportedError(provider)
    }

    const tokenUsageCredentialCallId =
        (billingDetails as ITextToSpeechBillingResult & { tokenUsageCredentialCallId?: string }).tokenUsageCredentialCallId || undefined
    const characters = Number(billingDetails.usage?.characters)
    const normalizedCharacters = Number.isFinite(characters) && characters >= 0 ? characters : 0
    if (normalizedCharacters <= 0) {
        throw buildTextToSpeechMeteringUnsupportedError(provider)
    }

    const workspaceCreditService = new WorkspaceCreditService()
    await workspaceCreditService.consumeCreditByTextCharacters(workspaceId, userId, {
        credentialId: billingDetails.credentialId || credentialId,
        provider: billingDetails.provider || provider,
        model: billingDetails.model || model,
        tokenUsageCredentialCallId,
        characters: normalizedCharacters
    })

    logger.info(
        `[text-to-speech] Alibaba TTS credit consumed credentialId=${billingDetails.credentialId || credentialId || '-'} model=${
            billingDetails.model || model || '-'
        } characters=${normalizedCharacters}`
    )

    return billingDetails
}

const recordTextToSpeechTokenUsage = async (params: IRecordTextToSpeechUsageParams): Promise<void> => {
    const {
        workspaceId,
        organizationId,
        userId,
        flowType,
        flowId,
        executionId,
        idempotencyKey,
        chatId,
        chatMessageId,
        billingDetails,
        options
    } = params

    if (!workspaceId || !organizationId || !billingDetails) {
        return
    }

    const characters = Number(billingDetails.usage?.characters)
    const normalizedCharacters = Number.isFinite(characters) && characters >= 0 ? characters : 0
    if (normalizedCharacters <= 0) {
        return
    }

    const tokenUsageCredentialCallId =
        (billingDetails as ITextToSpeechBillingResult & { tokenUsageCredentialCallId?: string }).tokenUsageCredentialCallId || undefined
    const credentialAccess = await getCredentialAccessForUsage(
        billingDetails.credentialId,
        billingDetails.model,
        billingDetails.provider,
        tokenUsageCredentialCallId,
        options
    )
    const tokenUsageService = new TokenUsageService()

    await tokenUsageService.recordTokenUsage({
        workspaceId,
        organizationId,
        userId,
        flowType,
        flowId,
        executionId,
        chatId,
        chatMessageId,
        idempotencyKey:
            idempotencyKey ||
            buildTextToSpeechIdempotencyKey({
                flowType,
                flowId,
                executionId,
                chatId,
                chatMessageId,
                tokenUsageCredentialCallId
            }),
        usagePayloads: [
            {
                credentialId: billingDetails.credentialId,
                tokenUsageCredentialCallId,
                model: billingDetails.model,
                provider: billingDetails.provider,
                source: 'text_to_speech',
                billingMode: 'characters',
                usage: {
                    characters: normalizedCharacters
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
