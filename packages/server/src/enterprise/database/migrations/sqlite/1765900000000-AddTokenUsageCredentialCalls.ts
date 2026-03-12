import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddTokenUsageCredentialCalls1765900000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "token_usage_credential" ADD COLUMN "attributionMode" varchar(20) NOT NULL DEFAULT 'estimated';`
        )
        await queryRunner.query(`ALTER TABLE "token_usage_credential" ADD COLUMN "chargedCredit" integer NOT NULL DEFAULT 0;`)
        await queryRunner.query(`ALTER TABLE "workspace_credit_transaction" ADD COLUMN "tokenUsageCredentialCallId" varchar;`)

        await queryRunner.query(
            `CREATE TABLE IF NOT EXISTS "token_usage_credential_call" (
                "id" varchar PRIMARY KEY NOT NULL,
                "usageExecutionId" varchar NOT NULL,
                "tokenUsageCredentialId" varchar NOT NULL,
                "workspaceId" varchar NOT NULL,
                "organizationId" varchar NOT NULL,
                "userId" varchar,
                "sequenceIndex" integer NOT NULL DEFAULT 0,
                "attributionMode" varchar(20) NOT NULL DEFAULT 'estimated',
                "billingMode" varchar(32) NOT NULL,
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
                "chargedCredit" integer NOT NULL DEFAULT 0,
                "creditTransactionId" varchar,
                "creditedAt" datetime,
                "createdDate" datetime NOT NULL DEFAULT (datetime('now'))
            );`
        )

        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "idx_token_usage_credential_call_org_created"
                ON "token_usage_credential_call" ("organizationId", "createdDate");`
        )
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "idx_token_usage_credential_call_workspace_user_created"
                ON "token_usage_credential_call" ("workspaceId", "userId", "createdDate");`
        )
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "idx_token_usage_credential_call_parent_sequence"
                ON "token_usage_credential_call" ("tokenUsageCredentialId", "sequenceIndex");`
        )
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "idx_workspace_credit_transaction_call_id"
                ON "workspace_credit_transaction" ("tokenUsageCredentialCallId");`
        )
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "idx_workspace_credit_transaction_call_id";`)
        await queryRunner.query(`DROP INDEX IF EXISTS "idx_token_usage_credential_call_parent_sequence";`)
        await queryRunner.query(`DROP INDEX IF EXISTS "idx_token_usage_credential_call_workspace_user_created";`)
        await queryRunner.query(`DROP INDEX IF EXISTS "idx_token_usage_credential_call_org_created";`)
        await queryRunner.query(`DROP TABLE IF EXISTS "token_usage_credential_call";`)
        await queryRunner.query(`ALTER TABLE "workspace_credit_transaction" DROP COLUMN "tokenUsageCredentialCallId";`)
        await queryRunner.query(`ALTER TABLE "token_usage_credential" DROP COLUMN "chargedCredit";`)
        await queryRunner.query(`ALTER TABLE "token_usage_credential" DROP COLUMN "attributionMode";`)
    }
}
