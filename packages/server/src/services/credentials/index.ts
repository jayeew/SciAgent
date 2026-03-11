import { StatusCodes } from 'http-status-codes'
import { In } from 'typeorm'
import { omit } from 'lodash'
import fs from 'fs'
import path from 'path'
import { INodeOptionsValue } from 'flowise-components'
import { Credential } from '../../database/entities/Credential'
import { WorkspaceShared } from '../../enterprise/database/entities/EnterpriseEntities'
import { WorkspaceService } from '../../enterprise/services/workspace.service'
import { InternalFlowiseError } from '../../errors/internalFlowiseError'
import { getErrorMessage } from '../../errors/utils'
import { decryptCredentialData, getNodeModulesPackagePath, transformToCredentialEntity } from '../../utils'
import {
    getCredentialBillingRulesForStorage,
    getEffectiveCredentialBillingRules,
    getLegacyBillingFallbacks,
    mergeBillingRuleMaps,
    MODEL_NAME_MAX_LENGTH,
    validateAndNormalizeBillingRules,
    validateAndNormalizeLegacyModelMultipliers
} from '../../utils/credentialBilling'
import { getRunningExpressApp } from '../../utils/getRunningExpressApp'
import logger from '../../utils/logger'

let cachedSpeechToTextModelMap: Map<string, INodeOptionsValue[]> | undefined
let cachedTextToSpeechModelMap: Map<string, INodeOptionsValue[]> | undefined
let cachedMediaModelMap: Map<string, INodeOptionsValue[]> | undefined

const appendModelOptions = (modelOptionMap: Map<string, { name: string; label: string }>, models: INodeOptionsValue[] | undefined) => {
    if (!Array.isArray(models)) return

    for (const model of models) {
        const modelName = typeof model?.name === 'string' ? model.name.trim() : ''
        if (!modelName || modelName.length > MODEL_NAME_MAX_LENGTH) continue
        if (modelOptionMap.has(modelName)) continue

        const modelLabel = typeof model?.label === 'string' && model.label.trim() ? model.label.trim() : modelName
        modelOptionMap.set(modelName, { name: modelName, label: modelLabel })
    }
}

const normalizeBillingRulePayload = (requestBody: Record<string, any>): Record<string, any> => {
    const normalizedRequestBody = { ...requestBody }
    const hasBillingRules = typeof normalizedRequestBody.billingRules !== 'undefined'
    const hasLegacyModelMultipliers = typeof normalizedRequestBody.creditConsumptionMultiplierByModel !== 'undefined'

    if (!hasBillingRules && !hasLegacyModelMultipliers) {
        return normalizedRequestBody
    }

    const explicitRules = hasBillingRules ? validateAndNormalizeBillingRules(normalizedRequestBody.billingRules) : {}
    const legacyCompatRules = hasLegacyModelMultipliers
        ? validateAndNormalizeLegacyModelMultipliers(normalizedRequestBody.creditConsumptionMultiplierByModel)
        : {}
    const mergedRules = mergeBillingRuleMaps(explicitRules, legacyCompatRules)

    normalizedRequestBody.billingRules = mergedRules
    normalizedRequestBody.creditConsumptionMultiplierByModel = undefined

    return normalizedRequestBody
}

const maskCredentialResponse = (
    credential: Credential & { shared?: boolean },
    isOwner?: boolean,
    plainDataObj?: Record<string, unknown>
) => {
    const billingRules = getEffectiveCredentialBillingRules(credential)
    const responsePayload: any = {
        ...credential,
        ...(plainDataObj !== undefined && { plainDataObj }),
        ...(isOwner
            ? {
                  billingRules,
                  creditConsumptionMultiplierByModel: undefined,
                  ...(plainDataObj !== undefined ? { legacyBillingFallbacks: getLegacyBillingFallbacks(plainDataObj) } : {})
              }
            : {})
    }

    return omit(responsePayload, [
        'encryptedData',
        ...(isOwner ? [] : ['creditConsumptionMultiplier', 'creditConsumptionMultiplierByModel', 'billingRules'])
    ])
}

const createCredential = async (requestBody: any) => {
    try {
        requestBody = normalizeBillingRulePayload(requestBody)

        const appServer = getRunningExpressApp()
        const newCredential = await transformToCredentialEntity(requestBody)

        if (requestBody.id) {
            newCredential.id = requestBody.id
        }

        const credential = await appServer.AppDataSource.getRepository(Credential).create(newCredential)
        const dbResponse = await appServer.AppDataSource.getRepository(Credential).save(credential)
        return dbResponse
    } catch (error) {
        if (error instanceof InternalFlowiseError) throw error
        throw new InternalFlowiseError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Error: credentialsService.createCredential - ${getErrorMessage(error)}`
        )
    }
}

const deleteCredentials = async (credentialId: string, workspaceIds: string[]): Promise<any> => {
    try {
        const appServer = getRunningExpressApp()
        const credential = await appServer.AppDataSource.getRepository(Credential).findOne({
            where: { id: credentialId, workspaceId: In(workspaceIds) }
        })
        if (!credential) {
            throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `Credential ${credentialId} not found`)
        }
        const dbResponse = await appServer.AppDataSource.getRepository(Credential).delete({
            id: credentialId,
            workspaceId: credential.workspaceId
        })
        return dbResponse
    } catch (error) {
        throw new InternalFlowiseError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Error: credentialsService.deleteCredential - ${getErrorMessage(error)}`
        )
    }
}

const getAllCredentials = async (
    paramCredentialName: any,
    workspaceId: string,
    organizationId?: string,
    canManageCredentials?: boolean,
    isOwner?: boolean
) => {
    try {
        const appServer = getRunningExpressApp()
        const workspaceService = new WorkspaceService()
        const sharedCredsWorkspaceId = organizationId ? await workspaceService.getSharedCredentialsWorkspaceId(organizationId) : null
        const workspaceIds = [workspaceId]
        if (sharedCredsWorkspaceId && sharedCredsWorkspaceId !== workspaceId) {
            workspaceIds.push(sharedCredsWorkspaceId)
        }

        let dbResponse: any[] = []
        if (paramCredentialName) {
            if (Array.isArray(paramCredentialName)) {
                for (let i = 0; i < paramCredentialName.length; i += 1) {
                    const name = paramCredentialName[i] as string
                    const credentials = await appServer.AppDataSource.getRepository(Credential).find({
                        where: { credentialName: name, workspaceId: In(workspaceIds) }
                    })
                    dbResponse.push(...credentials.map((credential) => maskCredentialResponse(credential, isOwner)))
                }
            } else {
                const credentials = await appServer.AppDataSource.getRepository(Credential).find({
                    where: { credentialName: paramCredentialName, workspaceId: In(workspaceIds) }
                })
                dbResponse = credentials.map((credential) => maskCredentialResponse(credential, isOwner))
            }
            if (workspaceId) {
                const sharedItems = (await workspaceService.getSharedItemsForWorkspace(workspaceId, 'credential')) as Credential[]
                if (sharedItems.length) {
                    for (const sharedItem of sharedItems) {
                        if (Array.isArray(paramCredentialName)) {
                            for (let i = 0; i < paramCredentialName.length; i += 1) {
                                if (sharedItem.credentialName === paramCredentialName[i]) {
                                    // @ts-ignore
                                    sharedItem.shared = true
                                    dbResponse.push(maskCredentialResponse(sharedItem as Credential & { shared?: boolean }, isOwner))
                                    break
                                }
                            }
                        } else {
                            if (sharedItem.credentialName === paramCredentialName) {
                                // @ts-ignore
                                sharedItem.shared = true
                                dbResponse.push(maskCredentialResponse(sharedItem as Credential & { shared?: boolean }, isOwner))
                            }
                        }
                    }
                }
            }
        } else {
            const credentials = await appServer.AppDataSource.getRepository(Credential).find({
                where: { workspaceId: In(workspaceIds) }
            })
            for (const credential of credentials) {
                const item = maskCredentialResponse(credential, isOwner)
                if (sharedCredsWorkspaceId && credential.workspaceId === sharedCredsWorkspaceId && !canManageCredentials) {
                    // Only mark as shared for non-owners so they see "Shared Credential" and no edit/delete; owner can manage
                    // @ts-ignore
                    item.shared = true
                }
                dbResponse.push(item)
            }
            if (workspaceId) {
                const sharedItems = (await workspaceService.getSharedItemsForWorkspace(workspaceId, 'credential')) as Credential[]
                if (sharedItems.length) {
                    for (const sharedItem of sharedItems) {
                        // @ts-ignore
                        sharedItem.shared = true
                        dbResponse.push(maskCredentialResponse(sharedItem as Credential & { shared?: boolean }, isOwner))
                    }
                }
            }
        }
        return dbResponse
    } catch (error) {
        throw new InternalFlowiseError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Error: credentialsService.getAllCredentials - ${getErrorMessage(error)}`
        )
    }
}

const getCredentialById = async (
    credentialId: string,
    workspaceIds: string[],
    canViewPlainData: boolean,
    isOwner: boolean
): Promise<any> => {
    try {
        const appServer = getRunningExpressApp()
        const credential = await appServer.AppDataSource.getRepository(Credential).findOne({
            where: { id: credentialId, workspaceId: In(workspaceIds) }
        })
        if (!credential) {
            throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `Credential ${credentialId} not found`)
        }
        let plainDataObj: Record<string, unknown> | undefined
        if (canViewPlainData) {
            plainDataObj = await decryptCredentialData(
                credential.encryptedData,
                credential.credentialName,
                appServer.nodesPool.componentCredentials
            )
        }
        const returnCredential = {
            ...credential,
            ...(plainDataObj !== undefined && { plainDataObj })
        }
        const dbResponse: any = maskCredentialResponse(returnCredential as Credential & { shared?: boolean }, isOwner)
        const primaryWorkspaceId = workspaceIds[0]
        if (primaryWorkspaceId) {
            const shared = await appServer.AppDataSource.getRepository(WorkspaceShared).count({
                where: {
                    workspaceId: primaryWorkspaceId,
                    sharedItemId: credentialId,
                    itemType: 'credential'
                }
            })
            if (shared > 0) {
                dbResponse.shared = true
            }
        }
        if (!canViewPlainData && credential.workspaceId !== primaryWorkspaceId) {
            dbResponse.shared = true
        }
        return dbResponse
    } catch (error) {
        throw new InternalFlowiseError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Error: credentialsService.getCredentialById - ${getErrorMessage(error)}`
        )
    }
}

const updateCredential = async (credentialId: string, requestBody: any, workspaceIds: string[]): Promise<any> => {
    try {
        const shouldClearLegacyModelMultipliers =
            Object.prototype.hasOwnProperty.call(requestBody, 'billingRules') ||
            Object.prototype.hasOwnProperty.call(requestBody, 'creditConsumptionMultiplierByModel')
        requestBody = normalizeBillingRulePayload(requestBody)

        const appServer = getRunningExpressApp()
        const credential = await appServer.AppDataSource.getRepository(Credential).findOne({
            where: { id: credentialId, workspaceId: In(workspaceIds) }
        })
        if (!credential) {
            throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `Credential ${credentialId} not found`)
        }
        const decryptedCredentialData = await decryptCredentialData(credential.encryptedData)
        requestBody.plainDataObj = { ...decryptedCredentialData, ...requestBody.plainDataObj }
        const updateCredential = await transformToCredentialEntity(requestBody)
        updateCredential.workspaceId = credential.workspaceId
        await appServer.AppDataSource.getRepository(Credential).merge(credential, updateCredential)
        if (shouldClearLegacyModelMultipliers) {
            credential.creditConsumptionMultiplierByModel = undefined
        }
        const dbResponse = await appServer.AppDataSource.getRepository(Credential).save(credential)
        return dbResponse
    } catch (error) {
        if (error instanceof InternalFlowiseError) throw error
        throw new InternalFlowiseError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Error: credentialsService.updateCredential - ${getErrorMessage(error)}`
        )
    }
}

const updateCredentialMultiplier = async (credentialId: string, multiplier: number, workspaceIds: string[]): Promise<any> => {
    try {
        if (typeof multiplier !== 'number' || Number.isNaN(multiplier) || multiplier <= 0) {
            throw new InternalFlowiseError(StatusCodes.BAD_REQUEST, `Invalid credit consumption multiplier`)
        }
        const appServer = getRunningExpressApp()
        const credential = await appServer.AppDataSource.getRepository(Credential).findOne({
            where: { id: credentialId, workspaceId: In(workspaceIds) }
        })
        if (!credential) {
            throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `Credential ${credentialId} not found`)
        }

        credential.creditConsumptionMultiplier = multiplier
        const dbResponse = await appServer.AppDataSource.getRepository(Credential).save(credential)
        return maskCredentialResponse(dbResponse, true)
    } catch (error) {
        if (error instanceof InternalFlowiseError) throw error
        throw new InternalFlowiseError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Error: credentialsService.updateCredentialMultiplier - ${getErrorMessage(error)}`
        )
    }
}

const updateCredentialModelMultipliers = async (
    credentialId: string,
    modelMultipliers: unknown,
    workspaceIds: string[]
): Promise<Record<string, unknown>> => {
    try {
        const normalizedBillingRules = validateAndNormalizeLegacyModelMultipliers(modelMultipliers)
        const appServer = getRunningExpressApp()
        const credential = await appServer.AppDataSource.getRepository(Credential).findOne({
            where: { id: credentialId, workspaceId: In(workspaceIds) }
        })
        if (!credential) {
            throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `Credential ${credentialId} not found`)
        }

        credential.billingRules = getCredentialBillingRulesForStorage(normalizedBillingRules)
        credential.creditConsumptionMultiplierByModel = undefined

        const dbResponse = await appServer.AppDataSource.getRepository(Credential).save(credential)
        return maskCredentialResponse(dbResponse, true)
    } catch (error) {
        if (error instanceof InternalFlowiseError) throw error
        throw new InternalFlowiseError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Error: credentialsService.updateCredentialModelMultipliers - ${getErrorMessage(error)}`
        )
    }
}

const updateCredentialBillingRules = async (
    credentialId: string,
    billingRules: unknown,
    workspaceIds: string[]
): Promise<Record<string, unknown>> => {
    try {
        const normalizedBillingRules = validateAndNormalizeBillingRules(billingRules)
        const appServer = getRunningExpressApp()
        const credential = await appServer.AppDataSource.getRepository(Credential).findOne({
            where: { id: credentialId, workspaceId: In(workspaceIds) }
        })
        if (!credential) {
            throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `Credential ${credentialId} not found`)
        }

        credential.billingRules = getCredentialBillingRulesForStorage(normalizedBillingRules)
        credential.creditConsumptionMultiplierByModel = undefined

        const dbResponse = await appServer.AppDataSource.getRepository(Credential).save(credential)
        return maskCredentialResponse(dbResponse, true)
    } catch (error) {
        if (error instanceof InternalFlowiseError) throw error
        throw new InternalFlowiseError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Error: credentialsService.updateCredentialBillingRules - ${getErrorMessage(error)}`
        )
    }
}

const getCredentialModels = async (
    credentialId: string,
    workspaceIds: string[],
    searchOptions: Record<string, unknown> = {}
): Promise<Array<{ name: string; label: string }>> => {
    try {
        const appServer = getRunningExpressApp()
        const credential = await appServer.AppDataSource.getRepository(Credential).findOne({
            where: { id: credentialId, workspaceId: In(workspaceIds) }
        })
        if (!credential) {
            throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `Credential ${credentialId} not found`)
        }

        const modelOptionMap = new Map<string, { name: string; label: string }>()
        const componentNodes = appServer.nodesPool.componentNodes

        for (const nodeName in componentNodes) {
            const nodeInstance = componentNodes[nodeName]
            const credentialNames = nodeInstance?.credential?.credentialNames
            const listModelsMethod = nodeInstance?.loadMethods?.listModels

            if (!Array.isArray(credentialNames) || !credentialNames.includes(credential.credentialName) || !listModelsMethod) {
                continue
            }

            try {
                const models = (await listModelsMethod.call(
                    nodeInstance,
                    {
                        id: nodeName,
                        name: nodeName,
                        credential: credential.id,
                        inputs: {
                            credentialId: credential.id
                        },
                        loadMethod: 'listModels'
                    } as any,
                    {
                        appDataSource: appServer.AppDataSource,
                        componentNodes: appServer.nodesPool.componentNodes,
                        searchOptions,
                        cachePool: appServer.cachePool
                    }
                )) as INodeOptionsValue[]

                appendModelOptions(modelOptionMap, models)
            } catch (error) {
                logger.warn(
                    `[credentialsService]: Failed to load models for credential=${
                        credential.credentialName
                    } node=${nodeName}: ${getErrorMessage(error)}`
                )
            }
        }

        try {
            appendModelOptions(modelOptionMap, getSpeechToTextModelsByCredentialName(credential.credentialName))
            appendModelOptions(modelOptionMap, getTextToSpeechModelsByCredentialName(credential.credentialName))
            appendModelOptions(modelOptionMap, getMediaModelsByCredentialName(credential.credentialName))
        } catch (error) {
            logger.warn(
                `[credentialsService]: Failed to load bundled models for credential=${credential.credentialName}: ${getErrorMessage(error)}`
            )
        }

        return Array.from(modelOptionMap.values()).sort((a, b) => a.label.localeCompare(b.label))
    } catch (error) {
        if (error instanceof InternalFlowiseError) throw error
        throw new InternalFlowiseError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Error: credentialsService.getCredentialModels - ${getErrorMessage(error)}`
        )
    }
}

const getSpeechToTextModelsByCredentialName = (credentialName: string): INodeOptionsValue[] => {
    if (!credentialName) return []

    if (!cachedSpeechToTextModelMap) {
        cachedSpeechToTextModelMap = loadCredentialModelMap('speechToText')
    }

    return cachedSpeechToTextModelMap.get(credentialName) ?? []
}

const getTextToSpeechModelsByCredentialName = (credentialName: string): INodeOptionsValue[] => {
    if (!credentialName) return []

    if (!cachedTextToSpeechModelMap) {
        cachedTextToSpeechModelMap = loadCredentialModelMap('textToSpeech')
    }

    return cachedTextToSpeechModelMap.get(credentialName) ?? []
}

const getMediaModelsByCredentialName = (credentialName: string): INodeOptionsValue[] => {
    if (!credentialName) return []

    if (!cachedMediaModelMap) {
        cachedMediaModelMap = loadCredentialModelMap('mediaModels')
    }

    return cachedMediaModelMap.get(credentialName) ?? []
}

const loadCredentialModelMap = (sectionKey: 'speechToText' | 'textToSpeech' | 'mediaModels'): Map<string, INodeOptionsValue[]> => {
    const modelMap = new Map<string, INodeOptionsValue[]>()
    const componentsPackagePath = getNodeModulesPackagePath('flowise-components')
    if (!componentsPackagePath) return modelMap

    const modelFilesToCheck = [path.join(componentsPackagePath, 'models.json'), path.join(componentsPackagePath, 'dist', 'models.json')]
    let modelFilePath = ''
    for (const candidatePath of modelFilesToCheck) {
        if (fs.existsSync(candidatePath)) {
            modelFilePath = candidatePath
            break
        }
    }
    if (!modelFilePath) return modelMap

    try {
        const raw = fs.readFileSync(modelFilePath, 'utf8')
        const parsed = JSON.parse(raw)
        const providerConfigs = Array.isArray(parsed?.[sectionKey]) ? parsed[sectionKey] : []

        for (const config of providerConfigs) {
            const providerName = typeof config?.name === 'string' ? config.name.trim() : ''
            if (!providerName) continue

            const providerModels = Array.isArray(config?.models) ? (config.models as INodeOptionsValue[]) : []
            modelMap.set(providerName, providerModels)
        }
    } catch (error) {
        logger.warn(`[credentialsService]: Failed to parse ${sectionKey} model config: ${getErrorMessage(error)}`)
    }

    return modelMap
}

export default {
    createCredential,
    deleteCredentials,
    getAllCredentials,
    getCredentialById,
    updateCredential,
    updateCredentialMultiplier,
    updateCredentialModelMultipliers,
    updateCredentialBillingRules,
    getCredentialModels
}
