import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddTokenUsageAudit1765800000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `CREATE TABLE IF NOT EXISTS \`token_usage_execution\` (
                \`id\` varchar(36) NOT NULL,
                \`workspaceId\` varchar(36) NOT NULL,
                \`organizationId\` varchar(36) NOT NULL,
                \`userId\` varchar(36) NULL,
                \`flowType\` varchar(32) NOT NULL,
                \`flowId\` varchar(36) NULL,
                \`executionId\` varchar(36) NULL,
                \`chatId\` varchar(255) NULL,
                \`chatMessageId\` varchar(36) NULL,
                \`sessionId\` varchar(255) NULL,
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
                \`modelBreakdown\` text NULL,
                \`createdDate\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
                PRIMARY KEY (\`id\`),
                INDEX \`idx_token_usage_execution_org_created\` (\`organizationId\`, \`createdDate\`),
                INDEX \`idx_token_usage_execution_workspace_user_created\` (\`workspaceId\`, \`userId\`, \`createdDate\`)
            ) ENGINE=InnoDB;`
        )

        await queryRunner.query(
            `CREATE TABLE IF NOT EXISTS \`token_usage_credential\` (
                \`id\` varchar(36) NOT NULL,
                \`usageExecutionId\` varchar(36) NOT NULL,
                \`workspaceId\` varchar(36) NOT NULL,
                \`organizationId\` varchar(36) NOT NULL,
                \`userId\` varchar(36) NULL,
                \`credentialId\` varchar(36) NULL,
                \`credentialName\` varchar(255) NULL,
                \`model\` varchar(255) NULL,
                \`usageCount\` int NOT NULL DEFAULT 0,
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
                \`createdDate\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
                PRIMARY KEY (\`id\`),
                INDEX \`idx_token_usage_credential_org_created\` (\`organizationId\`, \`createdDate\`),
                INDEX \`idx_token_usage_credential_workspace_user_created\` (\`workspaceId\`, \`userId\`, \`createdDate\`),
                INDEX \`idx_token_usage_credential_credential_created\` (\`credentialId\`, \`createdDate\`)
            ) ENGINE=InnoDB;`
        )
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS \`token_usage_credential\`;`)
        await queryRunner.query(`DROP TABLE IF EXISTS \`token_usage_execution\`;`)
    }
}
