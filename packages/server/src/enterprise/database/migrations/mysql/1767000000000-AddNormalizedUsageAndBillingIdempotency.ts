import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddNormalizedUsageAndBillingIdempotency1767000000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasColumn('token_usage_execution', 'idempotencyKey'))) {
            await queryRunner.query(`ALTER TABLE \`token_usage_execution\` ADD COLUMN \`idempotencyKey\` varchar(255) NULL;`)
        }
        for (const column of ['imageCount', 'videoCount', 'seconds', 'characters']) {
            if (!(await queryRunner.hasColumn('token_usage_execution', column))) {
                await queryRunner.query(`ALTER TABLE \`token_usage_execution\` ADD COLUMN \`${column}\` int NOT NULL DEFAULT 0;`)
            }
            if (!(await queryRunner.hasColumn('token_usage_credential', column))) {
                await queryRunner.query(`ALTER TABLE \`token_usage_credential\` ADD COLUMN \`${column}\` int NOT NULL DEFAULT 0;`)
            }
            if (!(await queryRunner.hasColumn('token_usage_credential_call', column))) {
                await queryRunner.query(`ALTER TABLE \`token_usage_credential_call\` ADD COLUMN \`${column}\` int NOT NULL DEFAULT 0;`)
            }
        }

        await queryRunner.query(`DROP INDEX \`idx_workspace_credit_transaction_call_id\` ON \`workspace_credit_transaction\`;`)
        await queryRunner.query(
            `CREATE UNIQUE INDEX \`idx_workspace_credit_transaction_call_id\`
                ON \`workspace_credit_transaction\` (\`tokenUsageCredentialCallId\`);`
        )
        await queryRunner.query(
            `CREATE UNIQUE INDEX \`idx_token_usage_execution_workspace_idempotency\`
                ON \`token_usage_execution\` (\`workspaceId\`, \`idempotencyKey\`);`
        )
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX \`idx_token_usage_execution_workspace_idempotency\` ON \`token_usage_execution\`;`)
        await queryRunner.query(`DROP INDEX \`idx_workspace_credit_transaction_call_id\` ON \`workspace_credit_transaction\`;`)
        await queryRunner.query(
            `CREATE INDEX \`idx_workspace_credit_transaction_call_id\`
                ON \`workspace_credit_transaction\` (\`tokenUsageCredentialCallId\`);`
        )

        for (const column of ['characters', 'seconds', 'videoCount', 'imageCount']) {
            if (await queryRunner.hasColumn('token_usage_credential_call', column)) {
                await queryRunner.query(`ALTER TABLE \`token_usage_credential_call\` DROP COLUMN \`${column}\`;`)
            }
            if (await queryRunner.hasColumn('token_usage_credential', column)) {
                await queryRunner.query(`ALTER TABLE \`token_usage_credential\` DROP COLUMN \`${column}\`;`)
            }
            if (await queryRunner.hasColumn('token_usage_execution', column)) {
                await queryRunner.query(`ALTER TABLE \`token_usage_execution\` DROP COLUMN \`${column}\`;`)
            }
        }

        if (await queryRunner.hasColumn('token_usage_execution', 'idempotencyKey')) {
            await queryRunner.query(`ALTER TABLE \`token_usage_execution\` DROP COLUMN \`idempotencyKey\`;`)
        }
    }
}
