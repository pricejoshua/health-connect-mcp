import type { Column, Row } from "./sqlite";

const BATCH_SIZE = 100;

export function buildCreateTableSql(tableName: string, columns: Column[]): string {
  const colDefs = columns.map(c => `[${c.name}] ${c.type || "TEXT"}`).join(", ");
  return `CREATE TABLE IF NOT EXISTS [${tableName}] (${colDefs})`;
}

export function buildUpsertSql(tableName: string, columnNames: string[]): string {
  const cols = columnNames.map(c => `[${c}]`).join(", ");
  const placeholders = columnNames.map(() => "?").join(", ");
  return `INSERT OR REPLACE INTO [${tableName}] (${cols}) VALUES (${placeholders})`;
}

export async function ensureTable(
  db: D1Database,
  tableName: string,
  columns: Column[]
): Promise<void> {
  const sql = buildCreateTableSql(tableName, columns);
  await db.prepare(sql).run();
}

export async function ensureSyncLog(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS _sync_log (
        sync_id INTEGER PRIMARY KEY AUTOINCREMENT,
        synced_at TEXT NOT NULL,
        status TEXT NOT NULL,
        tables_json TEXT NOT NULL
      )`
    )
    .run();
}

export async function writeSyncLog(
  db: D1Database,
  status: string,
  tables: Record<string, unknown>
): Promise<void> {
  await ensureSyncLog(db);
  await db
    .prepare(`INSERT INTO _sync_log (synced_at, status, tables_json) VALUES (?, ?, ?)`)
    .bind(new Date().toISOString(), status, JSON.stringify(tables))
    .run();
}

export async function upsertRows(
  db: D1Database,
  tableName: string,
  rows: Row[]
): Promise<void> {
  if (rows.length === 0) return;
  const columnNames = Object.keys(rows[0]);
  const sql = buildUpsertSql(tableName, columnNames);
  const stmt = db.prepare(sql);

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    const statements = chunk.map(row =>
      stmt.bind(...columnNames.map(col => row[col] ?? null))
    );
    await db.batch(statements);
  }
}
