import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddTokenUsageAudit1765800000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `CREATE TABLE IF NOT EXISTS "token_usage_execution" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "workspaceId" uuid NOT NULL,
                "organizationId" uuid NOT NULL,
                "userId" uuid,
                "flowType" varchar(32) NOT NULL,
                "flowId" uuid,
                "executionId" uuid,
                "chatId" varchar(255),
                "chatMessageId" uuid,
                "sessionId" varchar(255),
                "inputTokens" integer NOT NULL DEFAULT 0,
                "outputTokens" integer NOT NULL DEFAULT 0,
                "totalTokens" integer NOT NULL DEFAULT 0,
                "cacheReadTokens" integer NOT NULL DEFAULT 0,
                "cacheWriteTokens" integer NOT NULL DEFAULT 0,
                "reasoningTokens" integer NOT NULL DEFAULT 0,
                "acceptedPredictionTokens" integer NOT NULL DEFAULT 0,
                "rejectedPredictionTokens" integer NOT NULL DEFAULT 0,
                "audioInputTokens" integer NOT NULL DEFAULT 0,
                "audioOutputTokens" integer NOT NULL DEFAULT 0,
                "usageBreakdown" text,
                "modelBreakdown" text,
                "createdDate" timestamp NOT NULL DEFAULT now(),
                CONSTRAINT "pk_token_usage_execution" PRIMARY KEY ("id")
            );`
        )

        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "idx_token_usage_execution_org_created" ON "token_usage_execution" ("organizationId", "createdDate");`
        )
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "idx_token_usage_execution_workspace_user_created" ON "token_usage_execution" ("workspaceId", "userId", "createdDate");`
        )

        await queryRunner.query(
            `CREATE TABLE IF NOT EXISTS "token_usage_credential" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "usageExecutionId" uuid NOT NULL,
                "workspaceId" uuid NOT NULL,
                "organizationId" uuid NOT NULL,
                "userId" uuid,
                "credentialId" uuid,
                "credentialName" varchar(255),
                "model" varchar(255),
                "usageCount" integer NOT NULL DEFAULT 0,
                "inputTokens" integer NOT NULL DEFAULT 0,
                "outputTokens" integer NOT NULL DEFAULT 0,
                "totalTokens" integer NOT NULL DEFAULT 0,
                "cacheReadTokens" integer NOT NULL DEFAULT 0,
                "cacheWriteTokens" integer NOT NULL DEFAULT 0,
                "reasoningTokens" integer NOT NULL DEFAULT 0,
                "acceptedPredictionTokens" integer NOT NULL DEFAULT 0,
                "rejectedPredictionTokens" integer NOT NULL DEFAULT 0,
                "audioInputTokens" integer NOT NULL DEFAULT 0,
                "audioOutputTokens" integer NOT NULL DEFAULT 0,
                "usageBreakdown" text,
                "createdDate" timestamp NOT NULL DEFAULT now(),
                CONSTRAINT "pk_token_usage_credential" PRIMARY KEY ("id")
            );`
        )

        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "idx_token_usage_credential_org_created" ON "token_usage_credential" ("organizationId", "createdDate");`
        )
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "idx_token_usage_credential_workspace_user_created" ON "token_usage_credential" ("workspaceId", "userId", "createdDate");`
        )
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "idx_token_usage_credential_credential_created" ON "token_usage_credential" ("credentialId", "createdDate");`
        )
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "idx_token_usage_credential_credential_created";`)
        await queryRunner.query(`DROP INDEX IF EXISTS "idx_token_usage_credential_workspace_user_created";`)
        await queryRunner.query(`DROP INDEX IF EXISTS "idx_token_usage_credential_org_created";`)
        await queryRunner.query(`DROP TABLE IF EXISTS "token_usage_credential";`)

        await queryRunner.query(`DROP INDEX IF EXISTS "idx_token_usage_execution_workspace_user_created";`)
        await queryRunner.query(`DROP INDEX IF EXISTS "idx_token_usage_execution_org_created";`)
        await queryRunner.query(`DROP TABLE IF EXISTS "token_usage_execution";`)
    }
}
