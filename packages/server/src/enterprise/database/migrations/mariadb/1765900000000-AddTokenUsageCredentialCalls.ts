import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddTokenUsageCredentialCalls1765900000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE \`token_usage_credential\`
                ADD COLUMN IF NOT EXISTS \`attributionMode\` varchar(20) NOT NULL DEFAULT 'estimated',
                ADD COLUMN IF NOT EXISTS \`chargedCredit\` int NOT NULL DEFAULT 0;`
        )

        await queryRunner.query(
            `ALTER TABLE \`workspace_credit_transaction\`
                ADD COLUMN IF NOT EXISTS \`tokenUsageCredentialCallId\` varchar(36) NULL;`
        )

        await queryRunner.query(
            `CREATE TABLE IF NOT EXISTS \`token_usage_credential_call\` (
                \`id\` varchar(36) NOT NULL,
                \`usageExecutionId\` varchar(36) NOT NULL,
                \`tokenUsageCredentialId\` varchar(36) NOT NULL,
                \`workspaceId\` varchar(36) NOT NULL,
                \`organizationId\` varchar(36) NOT NULL,
                \`userId\` varchar(36) NULL,
                \`sequenceIndex\` int NOT NULL DEFAULT 0,
                \`attributionMode\` varchar(20) NOT NULL DEFAULT 'estimated',
                \`billingMode\` varchar(32) NOT NULL,
                \`inputTokens\` int NOT NULL DEFAULT 0,
                \`outputTokens\` int NOT NULL DEFAULT 0,
                \`totalTokens\` int NOT NULL DEFAULT 0,
                \`cacheReadTokens\` int NOT NULL DEFAULT 0,
                \`cacheWriteTokens\` int NOT NULL DEFAULT 0,
                \`reasoningTokens\` int NOT NULL DEFAULT 0,
                \`acceptedPredictionTokens\` int NOT NULL DEFAULT 0,
                \`rejectedPredictionTokens\` int NOT NULL DEFAULT 0,
                \`audioInputTokens\` int NOT NULL DEFAULT 0,
                \`audioOutputTokens\` int NOT NULL DEFAULT 0,
                \`usageBreakdown\` text NULL,
                \`chargedCredit\` int NOT NULL DEFAULT 0,
                \`creditTransactionId\` varchar(36) NULL,
                \`creditedAt\` datetime(6) NULL,
                \`createdDate\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
                PRIMARY KEY (\`id\`),
                INDEX \`idx_token_usage_credential_call_org_created\` (\`organizationId\`, \`createdDate\`),
                INDEX \`idx_token_usage_credential_call_workspace_user_created\` (\`workspaceId\`, \`userId\`, \`createdDate\`),
                INDEX \`idx_token_usage_credential_call_parent_sequence\` (\`tokenUsageCredentialId\`, \`sequenceIndex\`)
            ) ENGINE=InnoDB;`
        )

        await queryRunner.query(
            `CREATE INDEX \`idx_workspace_credit_transaction_call_id\`
                ON \`workspace_credit_transaction\` (\`tokenUsageCredentialCallId\`);`
        )
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX \`idx_workspace_credit_transaction_call_id\` ON \`workspace_credit_transaction\`;`)
        await queryRunner.query(`DROP TABLE IF EXISTS \`token_usage_credential_call\`;`)
        await queryRunner.query(`ALTER TABLE \`workspace_credit_transaction\` DROP COLUMN IF EXISTS \`tokenUsageCredentialCallId\`;`)
        await queryRunner.query(`ALTER TABLE \`token_usage_credential\` DROP COLUMN IF EXISTS \`chargedCredit\`;`)
        await queryRunner.query(`ALTER TABLE \`token_usage_credential\` DROP COLUMN IF EXISTS \`attributionMode\`;`)
    }
}
