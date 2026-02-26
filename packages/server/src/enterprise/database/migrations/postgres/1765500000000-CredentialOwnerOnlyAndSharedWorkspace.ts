import { MigrationInterface, QueryRunner } from 'typeorm'
import { v4 as uuidv4 } from 'uuid'
import { WorkspaceName } from '../../entities/workspace.entity'
import { GeneralRole } from '../../entities/role.entity'

/**
 * 1) Remove credentials:create, credentials:update, credentials:delete, credentials:share
 *    from "member" and "personal workspace" roles so only owner can manage credentials.
 * 2) Create a "Shared Credentials" workspace per organization and add org owner as workspace user.
 */
const PERSONAL_WORKSPACE_PERMISSIONS_WITHOUT_CRED_MANAGE = JSON.stringify([
    'chatflows:view',
    'chatflows:create',
    'chatflows:update',
    'chatflows:duplicate',
    'chatflows:delete',
    'chatflows:export',
    'chatflows:import',
    'chatflows:config',
    'chatflows:domains',
    'agentflows:view',
    'agentflows:create',
    'agentflows:update',
    'agentflows:duplicate',
    'agentflows:delete',
    'agentflows:export',
    'agentflows:import',
    'agentflows:config',
    'agentflows:domains',
    'tools:view',
    'tools:create',
    'tools:update',
    'tools:delete',
    'tools:export',
    'assistants:view',
    'assistants:create',
    'assistants:update',
    'assistants:delete',
    'credentials:view',
    'variables:view',
    'variables:create',
    'variables:update',
    'variables:delete',
    'apikeys:view',
    'apikeys:create',
    'apikeys:update',
    'apikeys:delete',
    'apikeys:import',
    'documentStores:view',
    'documentStores:create',
    'documentStores:update',
    'documentStores:delete',
    'documentStores:add-loader',
    'documentStores:delete-loader',
    'documentStores:preview-process',
    'documentStores:upsert-config',
    'datasets:view',
    'datasets:create',
    'datasets:update',
    'datasets:delete',
    'evaluators:view',
    'evaluators:create',
    'evaluators:update',
    'evaluators:delete',
    'evaluations:view',
    'evaluations:create',
    'evaluations:update',
    'evaluations:delete',
    'evaluations:run',
    'templates:marketplace',
    'templates:custom',
    'templates:custom-delete',
    'templates:toolexport',
    'templates:flowexport',
    'templates:custom-share',
    'workspace:export',
    'workspace:import',
    'executions:view',
    'executions:delete'
])

export class CredentialOwnerOnlyAndSharedWorkspace1765500000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `UPDATE "role" SET "permissions" = '${PERSONAL_WORKSPACE_PERMISSIONS_WITHOUT_CRED_MANAGE.replace(
                /'/g,
                "''"
            )}' WHERE "name" = '${GeneralRole.PERSONAL_WORKSPACE}' AND "organizationId" IS NULL`
        )

        const organizations = await queryRunner.query('SELECT "id", "createdBy" FROM "organization";')
        const ownerRoleRows = await queryRunner.query(
            `SELECT "id" FROM "role" WHERE "name" = '${GeneralRole.OWNER}' AND "organizationId" IS NULL LIMIT 1`
        )
        const ownerRoleId = ownerRoleRows?.[0]?.id
        if (!ownerRoleId) return

        for (const org of organizations) {
            const workspaceId = uuidv4()
            const existing = await queryRunner.query(
                `SELECT "id" FROM "workspace" WHERE "organizationId" = '${org.id}' AND "name" = '${WorkspaceName.SHARED_CREDENTIALS}' LIMIT 1`
            )
            if (existing?.length) continue

            await queryRunner.query(
                `INSERT INTO "workspace" ("id", "name", "description", "organizationId", "createdBy", "updatedBy")
                 VALUES ('${workspaceId}', '${WorkspaceName.SHARED_CREDENTIALS}', 'Credentials shared across all workspaces', '${org.id}', '${org.createdBy}', '${org.createdBy}')`
            )
            await queryRunner.query(
                `INSERT INTO "workspace_user" ("workspaceId", "userId", "roleId", "status", "createdBy", "updatedBy")
                 VALUES ('${workspaceId}', '${org.createdBy}', '${ownerRoleId}', 'ACTIVE', '${org.createdBy}', '${org.createdBy}')`
            )
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const credPerms = ['credentials:create', 'credentials:update', 'credentials:delete', 'credentials:share']
        const personalPerms = [
            'chatflows:view',
            'chatflows:create',
            'chatflows:update',
            'chatflows:duplicate',
            'chatflows:delete',
            'chatflows:export',
            'chatflows:import',
            'chatflows:config',
            'chatflows:domains',
            'agentflows:view',
            'agentflows:create',
            'agentflows:update',
            'agentflows:duplicate',
            'agentflows:delete',
            'agentflows:export',
            'agentflows:import',
            'agentflows:config',
            'agentflows:domains',
            'tools:view',
            'tools:create',
            'tools:update',
            'tools:delete',
            'tools:export',
            'assistants:view',
            'assistants:create',
            'assistants:update',
            'assistants:delete',
            'credentials:view',
            ...credPerms,
            'variables:view',
            'variables:create',
            'variables:update',
            'variables:delete',
            'apikeys:view',
            'apikeys:create',
            'apikeys:update',
            'apikeys:delete',
            'apikeys:import',
            'documentStores:view',
            'documentStores:create',
            'documentStores:update',
            'documentStores:delete',
            'documentStores:add-loader',
            'documentStores:delete-loader',
            'documentStores:preview-process',
            'documentStores:upsert-config',
            'datasets:view',
            'datasets:create',
            'datasets:update',
            'datasets:delete',
            'evaluators:view',
            'evaluators:create',
            'evaluators:update',
            'evaluators:delete',
            'evaluations:view',
            'evaluations:create',
            'evaluations:update',
            'evaluations:delete',
            'evaluations:run',
            'templates:marketplace',
            'templates:custom',
            'templates:custom-delete',
            'templates:toolexport',
            'templates:flowexport',
            'templates:custom-share',
            'workspace:export',
            'workspace:import',
            'executions:view',
            'executions:delete'
        ]
        await queryRunner.query(
            `UPDATE "role" SET "permissions" = '${JSON.stringify(personalPerms).replace(/'/g, "''")}' WHERE "name" = '${
                GeneralRole.PERSONAL_WORKSPACE
            }' AND "organizationId" IS NULL`
        )

        const workspaces = await queryRunner.query(`SELECT "id" FROM "workspace" WHERE "name" = '${WorkspaceName.SHARED_CREDENTIALS}'`)
        for (const w of workspaces) {
            await queryRunner.query(`DELETE FROM "workspace_user" WHERE "workspaceId" = '${w.id}'`)
            await queryRunner.query(`DELETE FROM "credential" WHERE "workspaceId" = '${w.id}'`)
            await queryRunner.query(`DELETE FROM "workspace" WHERE "id" = '${w.id}'`)
        }
    }
}
