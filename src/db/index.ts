import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as path from 'path';
import * as os from 'os';
import * as schema from './schema';

export { schema };
export type Db = BetterSQLite3Database<typeof schema>;

export const DATA_DIR = path.join(os.homedir(), '.openvault');

const DB_PATH = path.join(DATA_DIR, 'data.db');

export function openDb(): { db: Db; close: () => void } {
  const sqlite = new Database(DB_PATH);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.join(process.cwd(), 'src/db/migrations') });
  return { db, close: () => sqlite.close() };
}
