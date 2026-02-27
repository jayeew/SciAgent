import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddWorkspaceCredit1765600000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "workspace_user" ADD COLUMN "credit" integer NOT NULL DEFAULT 0;`)

        await queryRunner.query(
            `CREATE TABLE IF NOT EXISTS "workspace_credit_transaction" (
                "id" varchar PRIMARY KEY NOT NULL,
                "workspaceId" varchar NOT NULL,
                "userId" varchar NOT NULL,
                "type" varchar(20) NOT NULL,
                "amount" integer NOT NULL,
                "balance" integer NOT NULL,
                "credentialName" varchar(255),
                "credentialId" varchar,
                "description" text,
                "createdDate" datetime NOT NULL DEFAULT (datetime('now'))
            );`
        )

        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "idx_workspace_credit_transaction_workspace_user_created" ON "workspace_credit_transaction" ("workspaceId", "userId", "createdDate");`
        )
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "idx_workspace_credit_transaction_workspace_user_created";`)
        await queryRunner.query(`DROP TABLE IF EXISTS "workspace_credit_transaction";`)
        await queryRunner.query(`ALTER TABLE "workspace_user" DROP COLUMN "credit";`)
    }
}
