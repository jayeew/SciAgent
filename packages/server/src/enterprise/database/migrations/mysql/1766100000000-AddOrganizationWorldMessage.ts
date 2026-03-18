import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddOrganizationWorldMessage1766100000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE \`organization\`
                ADD COLUMN \`worldMessageDraft\` text NULL,
                ADD COLUMN \`worldMessagePublished\` text NULL,
                ADD COLUMN \`worldMessagePublishedAt\` timestamp NULL;`
        )
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE \`organization\`
                DROP COLUMN \`worldMessageDraft\`,
                DROP COLUMN \`worldMessagePublished\`,
                DROP COLUMN \`worldMessagePublishedAt\`;`
        )
    }
}
