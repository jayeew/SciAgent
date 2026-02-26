import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * Updates the general role "owner" (organizationId IS NULL) to have the full list
 * of permission keys so that owner can see and use User & Workspace Management.
 */
const OWNER_FULL_PERMISSIONS = JSON.stringify([
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
    'credentials:create',
    'credentials:update',
    'credentials:delete',
    'credentials:share',
    'variables:view',
    'variables:create',
    'variables:update',
    'variables:delete',
    'apikeys:view',
    'apikeys:create',
    'apikeys:update',
    'apikeys:delete',
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
    'executions:view',
    'executions:delete',
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
    'workspace:view',
    'workspace:create',
    'workspace:update',
    'workspace:add-user',
    'workspace:unlink-user',
    'workspace:delete',
    'workspace:export',
    'workspace:import',
    'users:manage',
    'roles:manage',
    'sso:manage',
    'logs:view',
    'loginActivity:view'
])

export class OwnerRoleFullPermissions1765400000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `UPDATE \`role\` SET \`permissions\` = '${OWNER_FULL_PERMISSIONS.replace(
                /'/g,
                "''"
            )}' WHERE \`name\` = 'owner' AND \`organizationId\` IS NULL`
        )
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `UPDATE \`role\` SET \`permissions\` = '["organization","workspace"]' WHERE \`name\` = 'owner' AND \`organizationId\` IS NULL`
        )
    }
}
