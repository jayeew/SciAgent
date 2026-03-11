import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddCredentialBillingRules1766000000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`credential\` ADD COLUMN \`billingRules\` TEXT NULL;`)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`credential\` DROP COLUMN \`billingRules\`;`)
    }
}
