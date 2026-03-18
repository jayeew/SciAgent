import { Request, Response, NextFunction } from 'express'
import { StatusCodes } from 'http-status-codes'
import { OrganizationErrorMessage, OrganizationService } from '../services/organization.service'
import { getRunningExpressApp } from '../../utils/getRunningExpressApp'
import { InternalFlowiseError } from '../../errors/internalFlowiseError'
import { Organization } from '../database/entities/organization.entity'
import { GeneralErrorMessage } from '../../utils/constants'
import { OrganizationUserService } from '../services/organization-user.service'
import { getCurrentUsage } from '../../utils/quotaUsage'

export class OrganizationController {
    constructor() {
        this.create = this.create.bind(this)
        this.read = this.read.bind(this)
        this.update = this.update.bind(this)
        this.getWorldMessage = this.getWorldMessage.bind(this)
        this.getWorldMessageManage = this.getWorldMessageManage.bind(this)
        this.updateWorldMessageDraft = this.updateWorldMessageDraft.bind(this)
        this.publishWorldMessage = this.publishWorldMessage.bind(this)
        this.unpublishWorldMessage = this.unpublishWorldMessage.bind(this)
        this.getAdditionalSeatsQuantity = this.getAdditionalSeatsQuantity.bind(this)
        this.getCustomerWithDefaultSource = this.getCustomerWithDefaultSource.bind(this)
        this.getAdditionalSeatsProration = this.getAdditionalSeatsProration.bind(this)
        this.getPlanProration = this.getPlanProration.bind(this)
        this.updateAdditionalSeats = this.updateAdditionalSeats.bind(this)
        this.updateSubscriptionPlan = this.updateSubscriptionPlan.bind(this)
        this.getCurrentUsage = this.getCurrentUsage.bind(this)
    }

    private getInternalUserId(req: Request): string {
        const userId = req.user?.id
        if (!userId) {
            throw new InternalFlowiseError(StatusCodes.UNAUTHORIZED, GeneralErrorMessage.UNAUTHORIZED)
        }

        return userId
    }

    private getActiveOrganizationId(req: Request): string {
        const organizationId = req.user?.activeOrganizationId
        if (!organizationId) {
            throw new InternalFlowiseError(StatusCodes.UNAUTHORIZED, GeneralErrorMessage.UNAUTHORIZED)
        }

        return organizationId
    }

    private ensureOwner(req: Request) {
        if (!req.user?.isOrganizationAdmin) {
            throw new InternalFlowiseError(StatusCodes.FORBIDDEN, GeneralErrorMessage.FORBIDDEN)
        }
    }

    public async create(req: Request, res: Response, next: NextFunction) {
        try {
            const organizationUserService = new OrganizationUserService()
            const newOrganization = await organizationUserService.createOrganization(req.body)
            return res.status(StatusCodes.CREATED).json(newOrganization)
        } catch (error) {
            next(error)
        }
    }

    public async read(req: Request, res: Response, next: NextFunction) {
        let queryRunner
        try {
            queryRunner = getRunningExpressApp().AppDataSource.createQueryRunner()
            await queryRunner.connect()
            const query = req.query as Partial<Organization>
            const organizationService = new OrganizationService()

            let organization: Organization | null
            if (query.id) {
                organization = await organizationService.readOrganizationById(query.id, queryRunner)
                if (!organization) throw new InternalFlowiseError(StatusCodes.NOT_FOUND, OrganizationErrorMessage.ORGANIZATION_NOT_FOUND)
            } else if (query.name) {
                organization = await organizationService.readOrganizationByName(query.name, queryRunner)
                if (!organization) throw new InternalFlowiseError(StatusCodes.NOT_FOUND, OrganizationErrorMessage.ORGANIZATION_NOT_FOUND)
            } else {
                throw new InternalFlowiseError(StatusCodes.BAD_REQUEST, GeneralErrorMessage.UNHANDLED_EDGE_CASE)
            }

            if (organization) {
                delete organization.worldMessageDraft
                delete organization.worldMessagePublished
                delete organization.worldMessagePublishedAt
            }

            return res.status(StatusCodes.OK).json(organization)
        } catch (error) {
            next(error)
        } finally {
            if (queryRunner) await queryRunner.release()
        }
    }

    public async update(req: Request, res: Response, next: NextFunction) {
        try {
            const organizationService = new OrganizationService()
            const organization = await organizationService.updateOrganization(req.body)
            return res.status(StatusCodes.OK).json(organization)
        } catch (error) {
            next(error)
        }
    }

    public async getWorldMessage(req: Request, res: Response, next: NextFunction) {
        try {
            this.getInternalUserId(req)
            const organizationService = new OrganizationService()
            const organizationId = this.getActiveOrganizationId(req)
            return res.status(StatusCodes.OK).json(await organizationService.getWorldMessage(organizationId))
        } catch (error) {
            next(error)
        }
    }

    public async getWorldMessageManage(req: Request, res: Response, next: NextFunction) {
        try {
            this.getInternalUserId(req)
            this.ensureOwner(req)
            const organizationService = new OrganizationService()
            const organizationId = this.getActiveOrganizationId(req)
            return res.status(StatusCodes.OK).json(await organizationService.getWorldMessageManage(organizationId))
        } catch (error) {
            next(error)
        }
    }

    public async updateWorldMessageDraft(req: Request, res: Response, next: NextFunction) {
        try {
            const userId = this.getInternalUserId(req)
            this.ensureOwner(req)
            if (typeof req.body?.draftMessage !== 'string') {
                throw new InternalFlowiseError(StatusCodes.BAD_REQUEST, 'draftMessage must be a string')
            }

            const organizationService = new OrganizationService()
            const organizationId = this.getActiveOrganizationId(req)
            return res
                .status(StatusCodes.OK)
                .json(await organizationService.updateWorldMessageDraft(organizationId, userId, req.body.draftMessage))
        } catch (error) {
            next(error)
        }
    }

    public async publishWorldMessage(req: Request, res: Response, next: NextFunction) {
        try {
            const userId = this.getInternalUserId(req)
            this.ensureOwner(req)
            const organizationService = new OrganizationService()
            const organizationId = this.getActiveOrganizationId(req)
            return res.status(StatusCodes.OK).json(await organizationService.publishWorldMessage(organizationId, userId))
        } catch (error) {
            next(error)
        }
    }

    public async unpublishWorldMessage(req: Request, res: Response, next: NextFunction) {
        try {
            const userId = this.getInternalUserId(req)
            this.ensureOwner(req)
            const organizationService = new OrganizationService()
            const organizationId = this.getActiveOrganizationId(req)
            return res.status(StatusCodes.OK).json(await organizationService.unpublishWorldMessage(organizationId, userId))
        } catch (error) {
            next(error)
        }
    }

    public async getAdditionalSeatsQuantity(req: Request, res: Response, next: NextFunction) {
        try {
            const { subscriptionId } = req.query
            if (!subscriptionId) {
                return res.status(400).json({ error: 'Subscription ID is required' })
            }
            const organizationUserservice = new OrganizationUserService()
            const totalOrgUsers = await organizationUserservice.readOrgUsersCountByOrgId(req.user?.activeOrganizationId as string)

            const identityManager = getRunningExpressApp().identityManager
            const result = await identityManager.getAdditionalSeatsQuantity(subscriptionId as string)

            return res.status(StatusCodes.OK).json({ ...result, totalOrgUsers })
        } catch (error) {
            next(error)
        }
    }

    public async getCustomerWithDefaultSource(req: Request, res: Response, next: NextFunction) {
        try {
            const { customerId } = req.query
            if (!customerId) {
                return res.status(400).json({ error: 'Customer ID is required' })
            }
            const identityManager = getRunningExpressApp().identityManager
            const result = await identityManager.getCustomerWithDefaultSource(customerId as string)

            return res.status(StatusCodes.OK).json(result)
        } catch (error) {
            next(error)
        }
    }

    public async getAdditionalSeatsProration(req: Request, res: Response, next: NextFunction) {
        try {
            const { subscriptionId, quantity } = req.query
            if (!subscriptionId) {
                return res.status(400).json({ error: 'Customer ID is required' })
            }
            if (quantity === undefined) {
                return res.status(400).json({ error: 'Quantity is required' })
            }
            const identityManager = getRunningExpressApp().identityManager
            const result = await identityManager.getAdditionalSeatsProration(subscriptionId as string, parseInt(quantity as string))

            return res.status(StatusCodes.OK).json(result)
        } catch (error) {
            next(error)
        }
    }

    public async getPlanProration(req: Request, res: Response, next: NextFunction) {
        try {
            const { subscriptionId, newPlanId } = req.query
            if (!subscriptionId) {
                return res.status(400).json({ error: 'Subscription ID is required' })
            }
            if (!newPlanId) {
                return res.status(400).json({ error: 'New plan ID is required' })
            }
            const identityManager = getRunningExpressApp().identityManager
            const result = await identityManager.getPlanProration(subscriptionId as string, newPlanId as string)

            return res.status(StatusCodes.OK).json(result)
        } catch (error) {
            next(error)
        }
    }

    public async updateAdditionalSeats(req: Request, res: Response, next: NextFunction) {
        try {
            const { subscriptionId, quantity, prorationDate } = req.body
            if (!subscriptionId) {
                return res.status(400).json({ error: 'Subscription ID is required' })
            }
            if (quantity === undefined) {
                return res.status(400).json({ error: 'Quantity is required' })
            }
            if (!prorationDate) {
                return res.status(400).json({ error: 'Proration date is required' })
            }
            const identityManager = getRunningExpressApp().identityManager
            const result = await identityManager.updateAdditionalSeats(subscriptionId, quantity, prorationDate)

            return res.status(StatusCodes.OK).json(result)
        } catch (error) {
            next(error)
        }
    }

    public async updateSubscriptionPlan(req: Request, res: Response, next: NextFunction) {
        try {
            const { subscriptionId, newPlanId, prorationDate } = req.body
            if (!subscriptionId) {
                return res.status(400).json({ error: 'Subscription ID is required' })
            }
            if (!newPlanId) {
                return res.status(400).json({ error: 'New plan ID is required' })
            }
            if (!prorationDate) {
                return res.status(400).json({ error: 'Proration date is required' })
            }
            const identityManager = getRunningExpressApp().identityManager
            const result = await identityManager.updateSubscriptionPlan(req, subscriptionId, newPlanId, prorationDate)

            return res.status(StatusCodes.OK).json(result)
        } catch (error) {
            next(error)
        }
    }

    public async getCurrentUsage(req: Request, res: Response, next: NextFunction) {
        try {
            const orgId = req.user?.activeOrganizationId
            const subscriptionId = req.user?.activeOrganizationSubscriptionId
            if (!orgId) {
                return res.status(400).json({ error: 'Organization ID is required' })
            }
            if (!subscriptionId) {
                return res.status(400).json({ error: 'Subscription ID is required' })
            }
            const usageCacheManager = getRunningExpressApp().usageCacheManager
            const result = await getCurrentUsage(orgId, subscriptionId, usageCacheManager)
            return res.status(StatusCodes.OK).json(result)
        } catch (error) {
            next(error)
        }
    }
}
