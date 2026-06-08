import initSqlJs, { Database } from "sql.js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { join, dirname } from "path";

export type Column = { name: string; type: string };
export type Row = Record<string, string | number | null>;

let sqlJsInstance: Awaited<ReturnType<typeof initSqlJs>> | null = null;

async function getSqlJs() {
  if (!sqlJsInstance) {
    let wasmBinary: ArrayBuffer | undefined;
    try {
      // Node.js / Vitest environment — load WASM from filesystem
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      const wasmPath = join(__dirname, "sql-wasm.wasm");
      wasmBinary = readFileSync(wasmPath).buffer as ArrayBuffer;
    } catch {
      // Workers runtime — wrangler handles WASM bundling
      wasmBinary = undefined;
    }
    sqlJsInstance = await initSqlJs(wasmBinary ? { wasmBinary } : {});
  }
  return sqlJsInstance;
}

export async function openDb(data: Uint8Array): Promise<Database> {
  const SQL = await getSqlJs();
  return new SQL.Database(data);
}

export function listTables(db: Database): string[] {
  const result = db.exec(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  );
  if (!result.length) return [];
  return result[0].values.map((row) => row[0] as string);
}

export function getTableSchema(db: Database, tableName: string): Column[] {
  const result = db.exec(`PRAGMA table_info([${tableName}])`);
  if (!result.length) return [];
  return result[0].values.map((row) => ({
    name: row[1] as string,
    type: (row[2] as string) || "TEXT",
  }));
}

export function readAllRows(db: Database, tableName: string): Row[] {
  const result = db.exec(`SELECT * FROM [${tableName}]`);
  if (!result.length) return [];
  const { columns, values } = result[0];
  return values.map((row) =>
    Object.fromEntries(
      columns.map((col, i) => [col, row[i] as string | number | null])
    )
  );
}
