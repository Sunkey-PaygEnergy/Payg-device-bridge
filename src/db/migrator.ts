import { pool, withTransaction } from './index.js';

export interface Migration {
  id: string;
  name: string;
  up: string;
  down?: string;
}

export class MigrationRunner {
  private migrations: Migration[] = [];

  public register(migration: Migration): void {
    this.migrations.push(migration);
  }

  public async initMigrationTable(): Promise<void> {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        executed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  public async getExecutedMigrations(): Promise<string[]> {
    await this.initMigrationTable();
    const result = await pool.query<{ id: string }>('SELECT id FROM schema_migrations ORDER BY executed_at ASC');
    return result.rows.map((r) => r.id);
  }

  public async up(): Promise<string[]> {
    await this.initMigrationTable();
    const executed = await this.getExecutedMigrations();
    const executedNow: string[] = [];

    for (const migration of this.migrations) {
      if (!executed.includes(migration.id)) {
        console.log(`Applying migration: ${migration.id} - ${migration.name}`);
        await withTransaction(async (client) => {
          await client.query(migration.up);
          await client.query(
            'INSERT INTO schema_migrations (id, name) VALUES ($1, $2)',
            [migration.id, migration.name]
          );
        });
        executedNow.push(migration.id);
      }
    }

    return executedNow;
  }
}

export const migrator = new MigrationRunner();
