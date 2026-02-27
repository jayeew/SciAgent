import express from 'express'
import { UserController } from '../controllers/user.controller'
import { checkPermission } from '../rbac/PermissionCheck'

const router = express.Router()
const userController = new UserController()

router.get('/', userController.read)
router.get('/test', userController.test)
router.get('/token-usage/summary', checkPermission('users:manage'), userController.getTokenUsageSummary)

router.post('/', userController.create)

router.put('/', userController.update)

export default router
