import { StatusCodes } from 'http-status-codes'
import { NextFunction, Request, Response } from 'express'
jest.mock('../../../src/utils/getRunningExpressApp', () => ({
    getRunningExpressApp: jest.fn()
}))

import { OrganizationController } from '../../../src/enterprise/controllers/organization.controller'
import { GeneralErrorMessage } from '../../../src/utils/constants'

describe('OrganizationController', () => {
    it('keeps detached world-message handlers bound to the controller instance', async () => {
        const controller = new OrganizationController()
        const handler = controller.getWorldMessageManage
        const next = jest.fn() as NextFunction

        await handler({} as Request, {} as Response, next)

        expect(next).toHaveBeenCalledTimes(1)
        expect(next).toHaveBeenCalledWith(
            expect.objectContaining({
                statusCode: StatusCodes.UNAUTHORIZED,
                message: GeneralErrorMessage.UNAUTHORIZED
            })
        )
    })
})
