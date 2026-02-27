import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddCredentialConsumptionMultiplier1765700000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "credential" ADD COLUMN "creditConsumptionMultiplier" double precision NOT NULL DEFAULT 1;`)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "credential" DROP COLUMN "creditConsumptionMultiplier";`)
    }
}
