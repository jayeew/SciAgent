import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddOrganizationWorldMessage1766100000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "organization" ADD COLUMN IF NOT EXISTS "worldMessageDraft" text;`)
        await queryRunner.query(`ALTER TABLE "organization" ADD COLUMN IF NOT EXISTS "worldMessagePublished" text;`)
        await queryRunner.query(`ALTER TABLE "organization" ADD COLUMN IF NOT EXISTS "worldMessagePublishedAt" timestamp;`)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "organization" DROP COLUMN IF EXISTS "worldMessageDraft";`)
        await queryRunner.query(`ALTER TABLE "organization" DROP COLUMN IF EXISTS "worldMessagePublished";`)
        await queryRunner.query(`ALTER TABLE "organization" DROP COLUMN IF EXISTS "worldMessagePublishedAt";`)
    }
}
