import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddCredentialModelConsumptionMultiplier1765900000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "credential" ADD COLUMN "creditConsumptionMultiplierByModel" TEXT NULL;`)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "credential" DROP COLUMN "creditConsumptionMultiplierByModel";`)
    }
}
