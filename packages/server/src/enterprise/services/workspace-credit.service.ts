import { StatusCodes } from 'http-status-codes'
import { DataSource, In } from 'typeorm'
import { InternalFlowiseError } from '../../errors/internalFlowiseError'
import { getRunningExpressApp } from '../../utils/getRunningExpressApp'
import { WorkspaceCreditTransaction, WorkspaceCreditTransactionType } from '../database/entities/workspace-credit-transaction.entity'
import { WorkspaceUser } from '../database/entities/workspace-user.entity'
import { Credential } from '../../database/entities/Credential'

export const enum WorkspaceCreditErrorMessage {
    INVALID_AMOUNT = 'Invalid credit amount',
    WORKSPACE_USER_NOT_FOUND = 'Workspace User Not Found'
}

export class WorkspaceCreditService {
    private dataSource: DataSource

    constructor() {
        const appServer = getRunningExpressApp()
        this.dataSource = appServer.AppDataSource
    }

    public async getCreditSummary(workspaceId: string, userId: string) {
        const queryRunner = this.dataSource.createQueryRunner()
        await queryRunner.connect()

        try {
            const workspaceUser = await queryRunner.manager.findOneBy(WorkspaceUser, {
                workspaceId,
                userId
            })

            if (!workspaceUser) {
                throw new InternalFlowiseError(StatusCodes.NOT_FOUND, WorkspaceCreditErrorMessage.WORKSPACE_USER_NOT_FOUND)
            }

            return {
                workspaceId,
                userId,
                credit: workspaceUser.credit ?? 0
            }
        } finally {
            if (!queryRunner.isReleased) await queryRunner.release()
        }
    }

    public async getTransactions(workspaceId: string, userId: string, limit = 100) {
        const queryRunner = this.dataSource.createQueryRunner()
        await queryRunner.connect()

        try {
            const workspaceUser = await queryRunner.manager.findOneBy(WorkspaceUser, {
                workspaceId,
                userId
            })

            if (!workspaceUser) {
                throw new InternalFlowiseError(StatusCodes.NOT_FOUND, WorkspaceCreditErrorMessage.WORKSPACE_USER_NOT_FOUND)
            }

            const normalizedLimit = Number.isInteger(limit) ? Math.max(1, Math.min(limit, 500)) : 100

            const transactions = await queryRunner.manager.find(WorkspaceCreditTransaction, {
                where: {
                    workspaceId,
                    userId
                },
                order: {
                    createdDate: 'DESC'
                },
                take: normalizedLimit
            })

            return {
                workspaceId,
                userId,
                credit: workspaceUser.credit ?? 0,
                transactions
            }
        } finally {
            if (!queryRunner.isReleased) await queryRunner.release()
        }
    }

    public async topupCredit(workspaceId: string, userId: string, amount: number, description?: string) {
        if (!Number.isInteger(amount) || amount <= 0) {
            throw new InternalFlowiseError(StatusCodes.BAD_REQUEST, WorkspaceCreditErrorMessage.INVALID_AMOUNT)
        }

        const queryRunner = this.dataSource.createQueryRunner()
        await queryRunner.connect()

        try {
            await queryRunner.startTransaction()

            const workspaceUser = await queryRunner.manager.findOneBy(WorkspaceUser, {
                workspaceId,
                userId
            })

            if (!workspaceUser) {
                throw new InternalFlowiseError(StatusCodes.NOT_FOUND, WorkspaceCreditErrorMessage.WORKSPACE_USER_NOT_FOUND)
            }

            workspaceUser.credit = (workspaceUser.credit ?? 0) + amount
            await queryRunner.manager.save(WorkspaceUser, workspaceUser)

            const transaction = queryRunner.manager.create(WorkspaceCreditTransaction, {
                workspaceId,
                userId,
                type: WorkspaceCreditTransactionType.TOPUP,
                amount,
                balance: workspaceUser.credit,
                description: description || 'Manual top-up'
            })
            const savedTransaction = await queryRunner.manager.save(WorkspaceCreditTransaction, transaction)

            await queryRunner.commitTransaction()

            return {
                workspaceId,
                userId,
                credit: workspaceUser.credit,
                transaction: savedTransaction
            }
        } catch (error) {
            if (queryRunner.isTransactionActive) await queryRunner.rollbackTransaction()
            throw error
        } finally {
            if (!queryRunner.isReleased) await queryRunner.release()
        }
    }

    public async consumeCreditByCredentialUsages(
        workspaceId: string,
        userId: string,
        usages: Array<{ credentialId?: string; credentialName?: string; totalTokens: number }>
    ) {
        const validUsages = usages.filter((usage) => usage.totalTokens > 0)
        if (!validUsages.length) {
            return { workspaceId, userId, creditConsumed: 0, transactions: [] as WorkspaceCreditTransaction[] }
        }

        const queryRunner = this.dataSource.createQueryRunner()
        await queryRunner.connect()

        try {
            await queryRunner.startTransaction()

            const workspaceUser = await queryRunner.manager.findOneBy(WorkspaceUser, {
                workspaceId,
                userId
            })

            if (!workspaceUser) {
                throw new InternalFlowiseError(StatusCodes.NOT_FOUND, WorkspaceCreditErrorMessage.WORKSPACE_USER_NOT_FOUND)
            }

            const credentialIds = validUsages.map((usage) => usage.credentialId).filter((id): id is string => !!id)
            const credentials = credentialIds.length ? await queryRunner.manager.findBy(Credential, { id: In(credentialIds) }) : []
            const credentialMap = new Map(credentials.map((credential) => [credential.id, credential]))

            let totalCreditConsumed = 0
            const transactions: WorkspaceCreditTransaction[] = []

            for (const usage of validUsages) {
                const credential = usage.credentialId ? credentialMap.get(usage.credentialId) : undefined
                const multiplier = credential?.creditConsumptionMultiplier ?? 1
                const consumed = Math.round(multiplier * usage.totalTokens)
                if (consumed <= 0) continue

                workspaceUser.credit = (workspaceUser.credit ?? 0) - consumed
                totalCreditConsumed += consumed

                const transaction = queryRunner.manager.create(WorkspaceCreditTransaction, {
                    workspaceId,
                    userId,
                    type: WorkspaceCreditTransactionType.CONSUME,
                    amount: -consumed,
                    balance: workspaceUser.credit,
                    credentialName: usage.credentialName || credential?.name || 'Unknown Credential',
                    credentialId: usage.credentialId,
                    description: `Token consumption: totalTokens=${usage.totalTokens}, multiplier=${multiplier}`
                })

                const saved = await queryRunner.manager.save(WorkspaceCreditTransaction, transaction)
                transactions.push(saved)
            }

            await queryRunner.manager.save(WorkspaceUser, workspaceUser)
            await queryRunner.commitTransaction()

            return {
                workspaceId,
                userId,
                creditConsumed: totalCreditConsumed,
                creditBalance: workspaceUser.credit,
                transactions
            }
        } catch (error) {
            if (queryRunner.isTransactionActive) await queryRunner.rollbackTransaction()
            throw error
        } finally {
            if (!queryRunner.isReleased) await queryRunner.release()
        }
    }
}
