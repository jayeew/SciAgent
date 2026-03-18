import { MigrationInterface, QueryRunner } from 'typeorm'
import { ensureColumnExists } from './sqlliteCustomFunctions'

export class AddOrganizationWorldMessage1766100000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await ensureColumnExists(queryRunner, 'organization', 'worldMessageDraft', 'text')
        await ensureColumnExists(queryRunner, 'organization', 'worldMessagePublished', 'text')
        await ensureColumnExists(queryRunner, 'organization', 'worldMessagePublishedAt', 'datetime')
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "organization" DROP COLUMN "worldMessageDraft";`)
        await queryRunner.query(`ALTER TABLE "organization" DROP COLUMN "worldMessagePublished";`)
        await queryRunner.query(`ALTER TABLE "organization" DROP COLUMN "worldMessagePublishedAt";`)
    }
}
