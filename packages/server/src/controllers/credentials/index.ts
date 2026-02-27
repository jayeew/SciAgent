import { Request, Response, NextFunction } from 'express'
import credentialsService from '../../services/credentials'
import { WorkspaceService } from '../../enterprise/services/workspace.service'
import { InternalFlowiseError } from '../../errors/internalFlowiseError'
import { StatusCodes } from 'http-status-codes'
import { LoggedInUser } from '../../enterprise/Interface.Enterprise'

const createCredential = async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (!req.body) {
            throw new InternalFlowiseError(
                StatusCodes.PRECONDITION_FAILED,
                `Error: credentialsController.createCredential - body not provided!`
            )
        }
        const body = req.body
        const user = req.user as LoggedInUser | undefined
        if (typeof body?.creditConsumptionMultiplier !== 'undefined' && !user?.isOrganizationAdmin) {
            throw new InternalFlowiseError(StatusCodes.FORBIDDEN, `Only owner can set credit consumption multiplier`)
        }
        const workspaceService = new WorkspaceService()
        const sharedCredsWorkspaceId = user?.activeOrganizationId
            ? await workspaceService.getSharedCredentialsWorkspaceId(user.activeOrganizationId)
            : null
        body.workspaceId = sharedCredsWorkspaceId || user?.activeWorkspaceId || body.workspaceId
        const apiResponse = await credentialsService.createCredential(body)
        return res.json(apiResponse)
    } catch (error) {
        next(error)
    }
}

const getCredentialWorkspaceIds = async (req: Request): Promise<string[]> => {
    const user = req.user as LoggedInUser | undefined
    const workspaceId = user?.activeWorkspaceId
    if (!workspaceId) return []
    const ids = [workspaceId]
    const workspaceService = new WorkspaceService()
    const sharedId = user?.activeOrganizationId ? await workspaceService.getSharedCredentialsWorkspaceId(user.activeOrganizationId) : null
    if (sharedId && !ids.includes(sharedId)) ids.push(sharedId)
    return ids
}

const deleteCredentials = async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (typeof req.params === 'undefined' || !req.params.id) {
            throw new InternalFlowiseError(
                StatusCodes.PRECONDITION_FAILED,
                `Error: credentialsController.deleteCredentials - id not provided!`
            )
        }
        const workspaceIds = await getCredentialWorkspaceIds(req)
        if (!workspaceIds.length) {
            throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `Error: credentialsController.deleteCredentials - workspace not found!`)
        }
        const apiResponse = await credentialsService.deleteCredentials(req.params.id, workspaceIds)
        return res.json(apiResponse)
    } catch (error) {
        next(error)
    }
}

const getAllCredentials = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const user = req.user as LoggedInUser | undefined
        const workspaceId = user?.activeWorkspaceId
        if (!workspaceId) {
            throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `Error: credentialsController.getAllCredentials - workspace not found!`)
        }
        const canManageCredentials =
            !!user?.isOrganizationAdmin ||
            (Array.isArray(user?.permissions) &&
                (user.permissions.includes('credentials:update') || user.permissions.includes('credentials:create')))
        const isOwner = !!user?.isOrganizationAdmin
        const apiResponse = await credentialsService.getAllCredentials(
            req.query.credentialName,
            workspaceId,
            user?.activeOrganizationId,
            canManageCredentials,
            isOwner
        )
        return res.json(apiResponse)
    } catch (error) {
        next(error)
    }
}

const getCredentialById = async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (typeof req.params === 'undefined' || !req.params.id) {
            throw new InternalFlowiseError(
                StatusCodes.PRECONDITION_FAILED,
                `Error: credentialsController.getCredentialById - id not provided!`
            )
        }
        const workspaceIds = await getCredentialWorkspaceIds(req)
        if (!workspaceIds.length) {
            throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `Error: credentialsController.getCredentialById - workspace not found!`)
        }
        const user = req.user as LoggedInUser | undefined
        const canViewPlainData =
            !!user?.isOrganizationAdmin ||
            (Array.isArray(user?.permissions) &&
                (user.permissions.includes('credentials:update') || user.permissions.includes('credentials:create')))
        const isOwner = !!user?.isOrganizationAdmin
        const apiResponse = await credentialsService.getCredentialById(req.params.id, workspaceIds, canViewPlainData, isOwner)
        return res.json(apiResponse)
    } catch (error) {
        next(error)
    }
}

const updateCredential = async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (typeof req.params === 'undefined' || !req.params.id) {
            throw new InternalFlowiseError(
                StatusCodes.PRECONDITION_FAILED,
                `Error: credentialsController.updateCredential - id not provided!`
            )
        }
        if (!req.body) {
            throw new InternalFlowiseError(
                StatusCodes.PRECONDITION_FAILED,
                `Error: credentialsController.updateCredential - body not provided!`
            )
        }
        const workspaceIds = await getCredentialWorkspaceIds(req)
        if (!workspaceIds.length) {
            throw new InternalFlowiseError(StatusCodes.NOT_FOUND, `Error: credentialsController.updateCredential - workspace not found!`)
        }
        const user = req.user as LoggedInUser | undefined
        // creditConsumptionMultiplier is owner-only
        if (typeof req.body?.creditConsumptionMultiplier !== 'undefined' && !user?.isOrganizationAdmin) {
            throw new InternalFlowiseError(StatusCodes.FORBIDDEN, `Only owner can update credit consumption multiplier`)
        }
        const apiResponse = await credentialsService.updateCredential(req.params.id, req.body, workspaceIds)
        return res.json(apiResponse)
    } catch (error) {
        next(error)
    }
}

const updateCredentialMultiplier = async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (typeof req.params === 'undefined' || !req.params.id) {
            throw new InternalFlowiseError(
                StatusCodes.PRECONDITION_FAILED,
                `Error: credentialsController.updateCredentialMultiplier - id not provided!`
            )
        }
        if (!req.body) {
            throw new InternalFlowiseError(
                StatusCodes.PRECONDITION_FAILED,
                `Error: credentialsController.updateCredentialMultiplier - body not provided!`
            )
        }
        const user = req.user as LoggedInUser | undefined
        if (!user?.isOrganizationAdmin) {
            throw new InternalFlowiseError(StatusCodes.FORBIDDEN, `Only owner can update credit consumption multiplier`)
        }
        const workspaceIds = await getCredentialWorkspaceIds(req)
        if (!workspaceIds.length) {
            throw new InternalFlowiseError(
                StatusCodes.NOT_FOUND,
                `Error: credentialsController.updateCredentialMultiplier - workspace not found!`
            )
        }
        const apiResponse = await credentialsService.updateCredentialMultiplier(
            req.params.id,
            Number(req.body.creditConsumptionMultiplier),
            workspaceIds
        )
        return res.json(apiResponse)
    } catch (error) {
        next(error)
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
