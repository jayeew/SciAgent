import { DataSource } from 'typeorm'
import { entities } from '../../src/database/entities'

describe('sqlite entity metadata', () => {
    it('initializes entity metadata with nullable organization publish timestamps', async () => {
        const dataSource = new DataSource({
            type: 'sqlite',
            database: ':memory:',
            synchronize: false,
            migrationsRun: false,
            entities: Object.values(entities)
        })

        try {
            await dataSource.initialize()

            expect(dataSource.isInitialized).toBe(true)
        } finally {
            if (dataSource.isInitialized) {
                await dataSource.destroy()
            }
        }
    })
})
