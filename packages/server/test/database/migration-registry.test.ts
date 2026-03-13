import { mariadbMigrations } from '../../src/database/migrations/mariadb'
import { mysqlMigrations } from '../../src/database/migrations/mysql'
import { postgresMigrations } from '../../src/database/migrations/postgres'
import { sqliteMigrations } from '../../src/database/migrations/sqlite'
import { AddTokenUsageCredentialCalls1765900000000 as MariadbAddTokenUsageCredentialCalls1765900000000 } from '../../src/enterprise/database/migrations/mariadb/1765900000000-AddTokenUsageCredentialCalls'
import { AddTokenUsageCredentialCalls1765900000000 as MysqlAddTokenUsageCredentialCalls1765900000000 } from '../../src/enterprise/database/migrations/mysql/1765900000000-AddTokenUsageCredentialCalls'
import { AddTokenUsageCredentialCalls1765900000000 as PostgresAddTokenUsageCredentialCalls1765900000000 } from '../../src/enterprise/database/migrations/postgres/1765900000000-AddTokenUsageCredentialCalls'
import { AddTokenUsageCredentialCalls1765900000000 as SqliteAddTokenUsageCredentialCalls1765900000000 } from '../../src/enterprise/database/migrations/sqlite/1765900000000-AddTokenUsageCredentialCalls'

describe('migration registry', () => {
    it('registers token usage credential call migrations for every relational database', () => {
        expect(sqliteMigrations).toContain(SqliteAddTokenUsageCredentialCalls1765900000000)
        expect(postgresMigrations).toContain(PostgresAddTokenUsageCredentialCalls1765900000000)
        expect(mysqlMigrations).toContain(MysqlAddTokenUsageCredentialCalls1765900000000)
        expect(mariadbMigrations).toContain(MariadbAddTokenUsageCredentialCalls1765900000000)
    })
})
