import { StatusCodes } from 'http-status-codes'
import { In } from 'typeorm'
import { omit } from 'lodash'
import { Credential } from '../../database/entities/Credential'
import { WorkspaceShared } from '../../enterprise/database/entities/EnterpriseEntities'
import { WorkspaceService } from '../../enterprise/services/workspace.service'
import { InternalFlowiseError } from '../../errors/internalFlowiseError'
import { getErrorMessage } from '../../errors/utils'
import { decryptCredentialData, transformToCredentialEntity } from '../../utils'
import { getRunningExpressApp } from '../../utils/getRunningExpressApp'

const createCredential = async (requestBody: any) => {
    try {
        const appServer = getRunningExpressApp()
        const newCredential = await transformToCredentialEntity(requestBody)

        if (requestBody.id) {
            newCredential.id = requestBody.id
        }

        const credential = await appServer.AppDataSource.getRepository(Credential).create(newCredential)
        const dbResponse = await appServer.AppDataSource.getRepository(Credential).save(credential)
        return dbResponse
    } catch (error) {
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
                    dbResponse.push(
                        ...credentials.map((credential) =>
                            omit(credential, ['encryptedData', ...(isOwner ? [] : ['creditConsumptionMultiplier'])])
                        )
                    )
                }
            } else {
                const credentials = await appServer.AppDataSource.getRepository(Credential).find({
                    where: { credentialName: paramCredentialName, workspaceId: In(workspaceIds) }
                })
                dbResponse = credentials.map((credential) =>
                    omit(credential, ['encryptedData', ...(isOwner ? [] : ['creditConsumptionMultiplier'])])
                )
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
                                    dbResponse.push(
                                        omit(sharedItem, ['encryptedData', ...(isOwner ? [] : ['creditConsumptionMultiplier'])])
                                    )
                                    break
                                }
                            }
                        } else {
                            if (sharedItem.credentialName === paramCredentialName) {
                                // @ts-ignore
                                sharedItem.shared = true
                                dbResponse.push(omit(sharedItem, ['encryptedData', ...(isOwner ? [] : ['creditConsumptionMultiplier'])]))
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
                const item = omit(credential, ['encryptedData', ...(isOwner ? [] : ['creditConsumptionMultiplier'])])
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
                        dbResponse.push(omit(sharedItem, ['encryptedData', ...(isOwner ? [] : ['creditConsumptionMultiplier'])]))
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
        const dbResponse: any = omit(returnCredential, ['encryptedData', ...(isOwner ? [] : ['creditConsumptionMultiplier'])])
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
        return omit(dbResponse, ['encryptedData'])
    } catch (error) {
        if (error instanceof InternalFlowiseError) throw error
        throw new InternalFlowiseError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            `Error: credentialsService.updateCredentialMultiplier - ${getErrorMessage(error)}`
        )
    }
}

export default {
    createCredential,
    deleteCredentials,
    getAllCredentials,
    getCredentialById,
    updateCredential,
    updateCredentialMultiplier
}
