import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddWorkspaceCredit1765600000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`workspace_user\` ADD COLUMN \`credit\` INT NOT NULL DEFAULT 0;`)

        await queryRunner.query(
            `CREATE TABLE IF NOT EXISTS \`workspace_credit_transaction\` (
                \`id\` varchar(36) NOT NULL,
                \`workspaceId\` varchar(36) NOT NULL,
                \`userId\` varchar(36) NOT NULL,
                \`type\` varchar(20) NOT NULL,
                \`amount\` int NOT NULL,
                \`balance\` int NOT NULL,
                \`credentialName\` varchar(255) NULL,
                \`credentialId\` varchar(36) NULL,
                \`description\` text NULL,
                \`createdDate\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
                PRIMARY KEY (\`id\`),
                INDEX \`idx_workspace_credit_transaction_workspace_user_created\` (\`workspaceId\`, \`userId\`, \`createdDate\`)
            ) ENGINE=InnoDB;`
        )
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS \`workspace_credit_transaction\`;`)
        await queryRunner.query(`ALTER TABLE \`workspace_user\` DROP COLUMN \`credit\`;`)
    }
}
