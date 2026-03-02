import { StatusCodes } from 'http-status-codes'
import { In } from 'typeorm'
import { omit } from 'lodash'
import { INodeOptionsValue } from 'flowise-components'
import { Credential } from '../../database/entities/Credential'
import { WorkspaceShared } from '../../enterprise/database/entities/EnterpriseEntities'
import { WorkspaceService } from '../../enterprise/services/workspace.service'
import { InternalFlowiseError } from '../../errors/internalFlowiseError'
import { getErrorMessage } from '../../errors/utils'
import { decryptCredentialData, transformToCredentialEntity } from '../../utils'
import { getRunningExpressApp } from '../../utils/getRunningExpressApp'
import logger from '../../utils/logger'

const MODEL_NAME_MAX_LENGTH = 255

interface ICredentialModelBillingConfig {
    multiplier: number
    rmbPerMTok: number
}

const LEGACY_DEFAULT_RMB_PER_MTOK = 0

const normalizeModelBillingConfig = (rawValue: unknown): ICredentialModelBillingConfig | null => {
    if (typeof rawValue === 'number' || typeof rawValue === 'string') {
        const multiplier = Number(rawValue)
        if (!Number.isFinite(multiplier) || multiplier <= 0) return null
        return {
            multiplier,
            rmbPerMTok: LEGACY_DEFAULT_RMB_PER_MTOK
        }
    }

    if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) return null

    const config = rawValue as Record<string, unknown>
    const multiplier = Number(config.multiplier)
    const rmbPerMTok = Number(config.rmbPerMTok)

    if (!Number.isFinite(multiplier) || multiplier <= 0) return null
    if (!Number.isFinite(rmbPerMTok) || rmbPerMTok < 0) return null

    return {
        multiplier,
        rmbPerMTok
    }
}

const parseCredentialModelMultipliers = (value?: string | null): Record<string, ICredentialModelBillingConfig> => {
    if (!value) return {}

    try {
        const parsed = JSON.parse(value)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

        const result: Record<string, ICredentialModelBillingConfig> = {}
        for (const [rawModelName, rawConfig] of Object.entries(parsed)) {
            const modelName = String(rawModelName).trim()
            if (!modelName || modelName.length > MODEL_NAME_MAX_LENGTH) continue

            const normalizedConfig = normalizeModelBillingConfig(rawConfig)
            if (!normalizedConfig) continue

            result[modelName] = normalizedConfig
        }
        return result
    } catch {
        return {}
    }
}

const validateAndNormalizeModelMultipliers = (modelMultipliers: unknown): Record<string, ICredentialModelBillingConfig> => {
    if (!modelMultipliers || typeof modelMultipliers !== 'object' || Array.isArray(modelMultipliers)) {
        throw new InternalFlowiseError(StatusCodes.BAD_REQUEST, 'Invalid model multipliers payload')
    }

    const normalizedModelMultipliers: Record<string, ICredentialModelBillingConfig> = {}

    for (const [rawModelName, rawConfig] of Object.entries(modelMultipliers)) {
        const modelName = rawModelName.trim()
        if (!modelName) {
            throw new InternalFlowiseError(StatusCodes.BAD_REQUEST, 'Model name cannot be empty')
        }
        if (modelName.length > MODEL_NAME_MAX_LENGTH) {
            throw new InternalFlowiseError(StatusCodes.BAD_REQUEST, `Model name "${modelName}" exceeds max length ${MODEL_NAME_MAX_LENGTH}`)
        }
        if (Object.prototype.hasOwnProperty.call(normalizedModelMultipliers, modelName)) {
            throw new InternalFlowiseError(StatusCodes.BAD_REQUEST, `Duplicate model name: ${modelName}`)
        }

        const normalizedConfig = normalizeModelBillingConfig(rawConfig)
        if (!normalizedConfig) {
            throw new InternalFlowiseError(
                StatusCodes.BAD_REQUEST,
                `Invalid model billing config for "${modelName}". Expect { multiplier > 0, rmbPerMTok >= 0 }`
            )
        }

        normalizedModelMultipliers[modelName] = normalizedConfig
    }

    return normalizedModelMultipliers
}

const maskCredentialResponse = (
    credential: Credential & { shared?: boolean },
    isOwner?: boolean,
    plainDataObj?: Record<string, unknown>
) => {
    const modelMultipliers = parseCredentialModelMultipliers(credential.creditConsumptionMultiplierByModel)
    const responsePayload: any = {
        ...credential,
        ...(plainDataObj !== undefined && { plainDataObj }),
        ...(isOwner ? { creditConsumptionMultiplierByModel: modelMultipliers } : {})
    }

    return omit(responsePayload, [
        'encryptedData',
        ...(isOwner ? [] : ['creditConsumptionMultiplier', 'creditConsumptionMultiplierByModel'])
    ])
}

const createCredential = async (requestBody: any) => {
    try {
        if (typeof requestBody?.creditConsumptionMultiplierByModel !== 'undefined') {
            requestBody.creditConsumptionMultiplierByModel = validateAndNormalizeModelMultipliers(
                requestBody.creditConsumptionMultiplierByModel
            )
        }

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
        if (typeof requestBody?.creditConsumptionMultiplierByModel !== 'undefined') {
            requestBody.creditConsumptionMultiplierByModel = validateAndNormalizeModelMultipliers(
                requestBody.creditConsumptionMultiplierByModel
            )
        }

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
        const normalizedModelMultipliers = validateAndNormalizeModelMultipliers(modelMultipliers)
        const appServer = getRunningExpressApp()
        const credential = await appServer.AppDataSource.getRepository(Credential).findOne({
            where: { id: credentialId, workspaceId: In(workspaceIds) }
        })
        if (!credential) {
            throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `Credential ${credentialId} not found`)
        }

        credential.creditConsumptionMultiplierByModel = Object.keys(normalizedModelMultipliers).length
            ? JSON.stringify(normalizedModelMultipliers)
            : undefined

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

                if (!Array.isArray(models)) continue

                for (const model of models) {
                    const modelName = typeof model?.name === 'string' ? model.name.trim() : ''
                    if (!modelName || modelName.length > MODEL_NAME_MAX_LENGTH) continue
                    if (modelOptionMap.has(modelName)) continue

                    const modelLabel = typeof model?.label === 'string' && model.label.trim() ? model.label.trim() : modelName
                    modelOptionMap.set(modelName, { name: modelName, label: modelLabel })
                }
            } catch (error) {
                logger.warn(
                    `[credentialsService]: Failed to load models for credential=${
                        credential.credentialName
                    } node=${nodeName}: ${getErrorMessage(error)}`
                )
            }
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

export default {
    createCredential,
    deleteCredentials,
    getAllCredentials,
    getCredentialById,
    updateCredential,
    updateCredentialMultiplier,
    updateCredentialModelMultipliers,
    getCredentialModels
}
