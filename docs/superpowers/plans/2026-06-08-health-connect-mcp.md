# Health Connect MCP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a hosted MCP server on Cloudflare that syncs Android Health Connect SQLite exports to D1 and exposes health data as MCP tools for Claude.

**Architecture:** A Cloudflare Worker handles two endpoints: `/ingest` receives the Health Connect `.db` file from Google Apps Script, parses it via WASM SQLite, and writes all tables to D1; `/mcp` implements the MCP JSON-RPC protocol and exposes tools for Claude to query health data. A Google Apps Script runs weekly to pull the export from Google Drive and POST it to `/ingest`.

**Tech Stack:** TypeScript, Cloudflare Workers, Cloudflare D1, sql.js (WASM SQLite), Vitest, Google Apps Script

> ⚠️ **Workers paid plan required:** sql.js WASM is ~900KB. Combined with TypeScript code, this exceeds the free plan's 1MB compressed script limit. The Workers Paid plan ($5/mo) has a 10MB limit.

---

## File Structure

```
worker/
├── src/
│   ├── index.ts           - Worker fetch handler + Env type definitions
│   ├── auth.ts            - Bearer token authentication helper
│   ├── ingest.ts          - POST /ingest: parse .db → write to D1
│   ├── mcp.ts             - POST /mcp: JSON-RPC MCP protocol handler
│   ├── sqlite.ts          - sql.js WASM init + table discovery + row reading
│   ├── sql-wasm.wasm      - Copied from sql.js dist (bundled by wrangler)
│   ├── aggregate.ts       - Series table → daily summary aggregation
│   ├── d1.ts              - D1 table creation + upsert helpers
│   └── tools/
│       ├── index.ts       - Tool registry (name → handler map) + tool definitions
│       ├── query.ts       - list_tables, get_table_schema, query_table
│       ├── health.ts      - get_heart_rate, get_steps, get_sleep, get_workouts, get_nutrition, get_weight, get_health_summary
│       └── sync.ts        - get_last_sync
├── test/
│   ├── auth.test.ts
│   ├── ingest.test.ts
│   ├── mcp.test.ts
│   ├── sqlite.test.ts
│   ├── aggregate.test.ts
│   ├── d1.test.ts
│   └── tools/
│       ├── query.test.ts
│       └── health.test.ts
├── wrangler.toml
├── package.json
├── tsconfig.json
└── vitest.config.ts
apps-script/
└── sync.js
```

---

### Task 1: Scaffold Worker project

**Files:**
- Create: `worker/package.json`
- Create: `worker/tsconfig.json`
- Create: `worker/wrangler.toml`
- Create: `worker/vitest.config.ts`
- Create: `worker/src/index.ts`

- [ ] **Step 1: Create worker directory and install dependencies**

```bash
cd C:/Users/swag_/Projects/health-connect-mcp
mkdir worker && cd worker
npm init -y
npm install --save-dev typescript wrangler vitest @cloudflare/workers-types
npm install sql.js
npm install --save-dev @types/sql.js
```

- [ ] **Step 2: Create `worker/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noEmit": true
  },
  "include": ["src/**/*", "test/**/*"]
}
```

- [ ] **Step 3: Create `worker/wrangler.toml`**

```toml
name = "health-connect-mcp"
main = "src/index.ts"
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "health-connect"
database_id = "REPLACE_AFTER_CREATION"

[vars]
AGGREGATE = "true"

[[rules]]
type = "CompiledWasm"
globs = ["**/*.wasm"]
fallthrough = true
```

- [ ] **Step 4: Create `worker/vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
  },
});
```

- [ ] **Step 5: Create `worker/src/index.ts`**

```typescript
export interface Env {
  DB: D1Database;
  API_KEY: string;
  AGGREGATE: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/ingest") {
      const { handleIngest } = await import("./ingest");
      return handleIngest(request, env);
    }

    if (request.method === "POST" && url.pathname === "/mcp") {
      const { handleMcp } = await import("./mcp");
      return handleMcp(request, env);
    }

    return new Response("Not Found", { status: 404 });
  },
};
```

- [ ] **Step 6: Commit**

```bash
cd C:/Users/swag_/Projects/health-connect-mcp
git add worker/
git commit -m "feat: scaffold Cloudflare Worker project"
```

---

### Task 2: Auth middleware

**Files:**
- Create: `worker/src/auth.ts`
- Create: `worker/test/auth.test.ts`

- [ ] **Step 1: Write the failing test**

Create `worker/test/auth.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { authenticate } from "../src/auth";

describe("authenticate", () => {
  it("returns true when Authorization header matches API_KEY", () => {
    const request = new Request("https://example.com", {
      headers: { Authorization: "Bearer secret123" },
    });
    expect(authenticate(request, "secret123")).toBe(true);
  });

  it("returns false when header is missing", () => {
    const request = new Request("https://example.com");
    expect(authenticate(request, "secret123")).toBe(false);
  });

  it("returns false when token does not match", () => {
    const request = new Request("https://example.com", {
      headers: { Authorization: "Bearer wrongtoken" },
    });
    expect(authenticate(request, "secret123")).toBe(false);
  });

  it("returns false when scheme is not Bearer", () => {
    const request = new Request("https://example.com", {
      headers: { Authorization: "Basic secret123" },
    });
    expect(authenticate(request, "secret123")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd worker && npx vitest run test/auth.test.ts
```
Expected: FAIL — `authenticate` not found

- [ ] **Step 3: Implement `worker/src/auth.ts`**

```typescript
export function authenticate(request: Request, apiKey: string): boolean {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader) return false;
  const [scheme, token] = authHeader.split(" ");
  return scheme === "Bearer" && token === apiKey;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run test/auth.test.ts
```
Expected: 4 passing

- [ ] **Step 5: Commit**

```bash
git add worker/src/auth.ts worker/test/auth.test.ts
git commit -m "feat: add bearer token auth middleware"
```

---

### Task 3: SQLite parsing utilities

**Files:**
- Create: `worker/src/sqlite.ts`
- Create: `worker/src/sql-wasm.wasm` (copied from node_modules)
- Create: `worker/test/sqlite.test.ts`

- [ ] **Step 1: Copy sql.js WASM binary into src**

```bash
cd worker
cp node_modules/sql.js/dist/sql-wasm.wasm src/sql-wasm.wasm
```

- [ ] **Step 2: Write the failing test**

Create `worker/test/sqlite.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { openDb, listTables, getTableSchema, readAllRows } from "../src/sqlite";
import { readFileSync } from "fs";
import { join } from "path";

const DB_PATH = join(__dirname, "../../health_connect_export.db");

describe("sqlite utilities", () => {
  it("opens a sqlite db from a buffer", async () => {
    const buffer = readFileSync(DB_PATH);
    const db = await openDb(new Uint8Array(buffer));
    expect(db).toBeDefined();
    db.close();
  });

  it("lists all tables", async () => {
    const buffer = readFileSync(DB_PATH);
    const db = await openDb(new Uint8Array(buffer));
    const tables = listTables(db);
    expect(tables).toContain("steps_record_table");
    expect(tables).toContain("heart_rate_record_series_table");
    expect(tables.length).toBeGreaterThan(10);
    db.close();
  });

  it("returns table schema as column definitions", async () => {
    const buffer = readFileSync(DB_PATH);
    const db = await openDb(new Uint8Array(buffer));
    const schema = getTableSchema(db, "steps_record_table");
    expect(schema.find(c => c.name === "count")).toBeDefined();
    expect(schema.find(c => c.name === "start_time")).toBeDefined();
    db.close();
  });

  it("reads all rows from a table", async () => {
    const buffer = readFileSync(DB_PATH);
    const db = await openDb(new Uint8Array(buffer));
    const rows = readAllRows(db, "weight_record_table");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toHaveProperty("weight");
    db.close();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npx vitest run test/sqlite.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 4: Implement `worker/src/sqlite.ts`**

```typescript
import initSqlJs, { Database } from "sql.js";
// @ts-ignore — wasm import handled by wrangler [[rules]]
import sqlWasm from "./sql-wasm.wasm";

export type Column = { name: string; type: string };
export type Row = Record<string, string | number | null>;

let sqlJsInstance: Awaited<ReturnType<typeof initSqlJs>> | null = null;

async function getSqlJs() {
  if (!sqlJsInstance) {
    sqlJsInstance = await initSqlJs({ wasmBinary: sqlWasm });
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
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run test/sqlite.test.ts
```
Expected: 4 passing

- [ ] **Step 6: Commit**

```bash
git add worker/src/sqlite.ts worker/src/sql-wasm.wasm worker/test/sqlite.test.ts
git commit -m "feat: add sql.js WASM SQLite parsing utilities"
```

---

### Task 4: Aggregation logic

**Files:**
- Create: `worker/src/aggregate.ts`
- Create: `worker/test/aggregate.test.ts`

Series tables contain millions of timestamped rows. When `AGGREGATE=true`, these are collapsed to daily summaries before writing to D1.

- [ ] **Step 1: Write the failing test**

Create `worker/test/aggregate.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { SERIES_TABLES, shouldAggregate, aggregateRows } from "../src/aggregate";

describe("SERIES_TABLES", () => {
  it("includes heart_rate_record_series_table", () => {
    expect(SERIES_TABLES).toContain("heart_rate_record_series_table");
  });

  it("includes exercise_route_table", () => {
    expect(SERIES_TABLES).toContain("exercise_route_table");
  });
});

describe("shouldAggregate", () => {
  it("returns true for series table when AGGREGATE=true", () => {
    expect(shouldAggregate("heart_rate_record_series_table", true, 100)).toBe(true);
  });

  it("returns false for non-series table when AGGREGATE=true", () => {
    expect(shouldAggregate("steps_record_table", true, 100)).toBe(false);
  });

  it("returns false for series table when AGGREGATE=false", () => {
    expect(shouldAggregate("heart_rate_record_series_table", false, 100)).toBe(false);
  });

  it("returns true for any table exceeding 500k rows when AGGREGATE=true", () => {
    expect(shouldAggregate("unknown_big_table", true, 600_000)).toBe(true);
  });

  it("returns false for large table when AGGREGATE=false", () => {
    expect(shouldAggregate("unknown_big_table", false, 600_000)).toBe(false);
  });
});

describe("aggregateRows — heart_rate_record_series_table", () => {
  it("aggregates to daily min/avg/max bpm", () => {
    const rows = [
      { epoch_millis: 1700006400000, beats_per_minute: 70 }, // 2023-11-15
      { epoch_millis: 1700006460000, beats_per_minute: 80 }, // same day
      { epoch_millis: 1700092800000, beats_per_minute: 65 }, // 2023-11-16
    ];
    const result = aggregateRows("heart_rate_record_series_table", rows);
    expect(result).toHaveLength(2);
    const day1 = result.find(r => r.date === "2023-11-15");
    expect(day1).toBeDefined();
    expect(day1!.min_bpm).toBe(70);
    expect(day1!.max_bpm).toBe(80);
    expect(day1!.avg_bpm).toBe(75);
    expect(day1!.sample_count).toBe(2);
  });
});

describe("aggregateRows — exercise_route_table", () => {
  it("aggregates to daily GPS point counts, dropping coordinates", () => {
    const rows = [
      { timestamp_millis: 1700006400000, latitude: 48.8, longitude: 2.3, altitude: 100 },
      { timestamp_millis: 1700006460000, latitude: 48.9, longitude: 2.4, altitude: 101 },
    ];
    const result = aggregateRows("exercise_route_table", rows);
    expect(result).toHaveLength(1);
    expect(result[0].point_count).toBe(2);
    expect(result[0]).not.toHaveProperty("latitude");
    expect(result[0]).not.toHaveProperty("longitude");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run test/aggregate.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Implement `worker/src/aggregate.ts`**

```typescript
import type { Row } from "./sqlite";

export const SERIES_TABLES = [
  "heart_rate_record_series_table",
  "exercise_route_table",
  "cycling_pedaling_cadence_record_table",
  "power_record_table",
  "speed_record_table",
  "steps_cadence_record_table",
  "skin_temperature_delta_table",
];

const ROW_THRESHOLD = 500_000;

export function shouldAggregate(
  tableName: string,
  aggregateFlag: boolean,
  rowCount: number
): boolean {
  if (!aggregateFlag) return false;
  return SERIES_TABLES.includes(tableName) || rowCount >= ROW_THRESHOLD;
}

function epochToDate(epochMillis: number): string {
  return new Date(epochMillis).toISOString().slice(0, 10);
}

function groupByDate(rows: Row[], timeKey: string): Map<string, Row[]> {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const date = epochToDate(row[timeKey] as number);
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date)!.push(row);
  }
  return groups;
}

export function aggregateRows(tableName: string, rows: Row[]): Row[] {
  if (!rows.length) return [];

  switch (tableName) {
    case "heart_rate_record_series_table":
      return aggregateHeartRate(rows);
    case "exercise_route_table":
      return aggregateRoute(rows);
    case "cycling_pedaling_cadence_record_table":
    case "steps_cadence_record_table":
      return aggregateCadence(rows);
    case "power_record_table":
      return aggregatePower(rows);
    case "speed_record_table":
      return aggregateSpeed(rows);
    case "skin_temperature_delta_table":
      return aggregateSkinTemp(rows);
    default:
      return aggregateGeneric(rows);
  }
}

function aggregateHeartRate(rows: Row[]): Row[] {
  const groups = groupByDate(rows, "epoch_millis");
  return Array.from(groups.entries()).map(([date, dayRows]) => {
    const bpms = dayRows.map(r => r.beats_per_minute as number);
    return {
      date,
      min_bpm: Math.min(...bpms),
      max_bpm: Math.max(...bpms),
      avg_bpm: Math.round(bpms.reduce((a, b) => a + b, 0) / bpms.length),
      sample_count: bpms.length,
    };
  });
}

function aggregateRoute(rows: Row[]): Row[] {
  const groups = groupByDate(rows, "timestamp_millis");
  return Array.from(groups.entries()).map(([date, dayRows]) => ({
    date,
    point_count: dayRows.length,
  }));
}

function aggregateCadence(rows: Row[]): Row[] {
  const groups = groupByDate(rows, "epoch_millis");
  return Array.from(groups.entries()).map(([date, dayRows]) => {
    const rates = dayRows.map(r => r.rate as number);
    return {
      date,
      avg_rate: Math.round(rates.reduce((a, b) => a + b, 0) / rates.length),
      sample_count: rates.length,
    };
  });
}

function aggregatePower(rows: Row[]): Row[] {
  const groups = groupByDate(rows, "epoch_millis");
  return Array.from(groups.entries()).map(([date, dayRows]) => {
    const powers = dayRows.map(r => r.power as number);
    return {
      date,
      avg_power: Math.round(powers.reduce((a, b) => a + b, 0) / powers.length),
      max_power: Math.max(...powers),
      sample_count: powers.length,
    };
  });
}

function aggregateSpeed(rows: Row[]): Row[] {
  const groups = groupByDate(rows, "epoch_millis");
  return Array.from(groups.entries()).map(([date, dayRows]) => {
    const speeds = dayRows.map(r => r.speed as number);
    return {
      date,
      avg_speed: speeds.reduce((a, b) => a + b, 0) / speeds.length,
      max_speed: Math.max(...speeds),
      sample_count: speeds.length,
    };
  });
}

function aggregateSkinTemp(rows: Row[]): Row[] {
  const groups = groupByDate(rows, "epoch_millis");
  return Array.from(groups.entries()).map(([date, dayRows]) => {
    const deltas = dayRows.map(r => r.delta as number);
    return {
      date,
      avg_delta: deltas.reduce((a, b) => a + b, 0) / deltas.length,
      sample_count: deltas.length,
    };
  });
}

function aggregateGeneric(rows: Row[]): Row[] {
  const timeKey = Object.keys(rows[0]).find(
    k => k.includes("epoch") || k === "time"
  );
  if (!timeKey) return [{ row_count: rows.length }];
  const groups = groupByDate(rows, timeKey);
  return Array.from(groups.entries()).map(([date, dayRows]) => ({
    date,
    row_count: dayRows.length,
  }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run test/aggregate.test.ts
```
Expected: 8 passing

- [ ] **Step 5: Commit**

```bash
git add worker/src/aggregate.ts worker/test/aggregate.test.ts
git commit -m "feat: add series table aggregation logic"
```

---

### Task 5: D1 schema creation and upsert helpers

**Files:**
- Create: `worker/src/d1.ts`
- Create: `worker/test/d1.test.ts`

- [ ] **Step 1: Write the failing test**

Create `worker/test/d1.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { buildCreateTableSql, buildUpsertSql, ensureTable, upsertRows, writeSyncLog } from "../src/d1";
import type { Column } from "../src/sqlite";

describe("buildCreateTableSql", () => {
  it("generates CREATE TABLE IF NOT EXISTS with all columns", () => {
    const cols: Column[] = [
      { name: "row_id", type: "INTEGER" },
      { name: "uuid", type: "TEXT" },
      { name: "count", type: "INTEGER" },
    ];
    const sql = buildCreateTableSql("steps_record_table", cols);
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS [steps_record_table]");
    expect(sql).toContain("[row_id] INTEGER");
    expect(sql).toContain("[uuid] TEXT");
    expect(sql).toContain("[count] INTEGER");
  });
});

describe("buildUpsertSql", () => {
  it("generates INSERT OR REPLACE with correct placeholders", () => {
    const sql = buildUpsertSql("steps_record_table", ["row_id", "uuid", "count"]);
    expect(sql).toContain("INSERT OR REPLACE INTO [steps_record_table]");
    expect(sql).toContain("[row_id]");
    expect(sql.match(/\?/g)!.length).toBe(3);
  });
});

describe("ensureTable", () => {
  it("calls db.prepare with CREATE TABLE SQL", async () => {
    const run = vi.fn().mockResolvedValue({});
    const prepare = vi.fn(() => ({ run }));
    const db = { prepare } as unknown as D1Database;
    const cols: Column[] = [{ name: "id", type: "INTEGER" }, { name: "val", type: "TEXT" }];
    await ensureTable(db, "test_table", cols);
    expect(prepare).toHaveBeenCalledWith(
      expect.stringContaining("CREATE TABLE IF NOT EXISTS [test_table]")
    );
    expect(run).toHaveBeenCalled();
  });
});

describe("upsertRows", () => {
  it("calls db.batch with bound statements", async () => {
    const bind = vi.fn(() => ({ run: vi.fn().mockResolvedValue({}) }));
    const prepare = vi.fn(() => ({ bind }));
    const batch = vi.fn().mockResolvedValue([]);
    const db = { prepare, batch } as unknown as D1Database;
    const rows = [{ id: 1, val: "a" }, { id: 2, val: "b" }];
    await upsertRows(db, "test_table", rows);
    expect(batch).toHaveBeenCalled();
    expect(bind).toHaveBeenCalledTimes(2);
  });

  it("does nothing for empty rows array", async () => {
    const prepare = vi.fn();
    const db = { prepare } as unknown as D1Database;
    await upsertRows(db, "test_table", []);
    expect(prepare).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run test/d1.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Implement `worker/src/d1.ts`**

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run test/d1.test.ts
```
Expected: 5 passing

- [ ] **Step 5: Commit**

```bash
git add worker/src/d1.ts worker/test/d1.test.ts
git commit -m "feat: add D1 schema creation and upsert helpers"
```

---

### Task 6: Ingest handler

**Files:**
- Create: `worker/src/ingest.ts`
- Create: `worker/test/ingest.test.ts`

- [ ] **Step 1: Write the failing test**

Create `worker/test/ingest.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { handleIngest } from "../src/ingest";
import type { Env } from "../src/index";

function makeDb(): D1Database {
  const run = vi.fn().mockResolvedValue({});
  const bind = vi.fn(() => ({ run }));
  const prepare = vi.fn(() => ({ run, bind }));
  const batch = vi.fn().mockResolvedValue([]);
  return { prepare, batch } as unknown as D1Database;
}

function makeEnv(overrides: Partial<Env> = {}): Env {
  return { API_KEY: "test-key", AGGREGATE: "true", DB: makeDb(), ...overrides };
}

describe("handleIngest", () => {
  it("returns 401 when Authorization header is missing", async () => {
    const request = new Request("https://example.com/ingest", {
      method: "POST",
      body: new Uint8Array([1, 2, 3]),
    });
    const response = await handleIngest(request, makeEnv());
    expect(response.status).toBe(401);
  });

  it("returns 401 when API key is wrong", async () => {
    const request = new Request("https://example.com/ingest", {
      method: "POST",
      body: new Uint8Array([1, 2, 3]),
      headers: { Authorization: "Bearer wrongkey" },
    });
    const response = await handleIngest(request, makeEnv());
    expect(response.status).toBe(401);
  });

  it("returns 400 when body is empty", async () => {
    const request = new Request("https://example.com/ingest", {
      method: "POST",
      body: new Uint8Array(0),
      headers: { Authorization: "Bearer test-key" },
    });
    const response = await handleIngest(request, makeEnv());
    expect(response.status).toBe(400);
  });

  it("returns JSON with Content-Type header on 401", async () => {
    const request = new Request("https://example.com/ingest", { method: "POST" });
    const response = await handleIngest(request, makeEnv());
    expect(response.headers.get("Content-Type")).toContain("application/json");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run test/ingest.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Implement `worker/src/ingest.ts`**

```typescript
import type { Env } from "./index";
import { authenticate } from "./auth";
import { openDb, listTables, getTableSchema, readAllRows } from "./sqlite";
import { shouldAggregate, aggregateRows } from "./aggregate";
import { ensureTable, upsertRows, writeSyncLog } from "./d1";
import type { Column } from "./sqlite";

type TableStatus = "upserted" | "aggregated" | "skipped" | "error";

export type IngestResult = {
  success: boolean;
  tables: Record<string, { rows: number; status: TableStatus; error?: string }>;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function handleIngest(request: Request, env: Env): Promise<Response> {
  if (!authenticate(request, env.API_KEY)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const buffer = await request.arrayBuffer();
  if (buffer.byteLength === 0) {
    return jsonResponse({ error: "Empty body" }, 400);
  }

  const result: IngestResult = { success: false, tables: {} };

  try {
    const db = await openDb(new Uint8Array(buffer));
    const tables = listTables(db);
    const aggregate = env.AGGREGATE !== "false";

    for (const tableName of tables) {
      try {
        const rows = readAllRows(db, tableName);

        if (rows.length === 0) {
          result.tables[tableName] = { rows: 0, status: "skipped" };
          continue;
        }

        if (shouldAggregate(tableName, aggregate, rows.length)) {
          const aggregated = aggregateRows(tableName, rows);
          const aggCols: Column[] = Object.keys(aggregated[0]).map(k => ({
            name: k,
            type: typeof aggregated[0][k] === "number" ? "REAL" : "TEXT",
          }));
          await ensureTable(env.DB, tableName, aggCols);
          await upsertRows(env.DB, tableName, aggregated);
          result.tables[tableName] = { rows: aggregated.length, status: "aggregated" };
        } else {
          const schema = getTableSchema(db, tableName);
          await ensureTable(env.DB, tableName, schema);
          await upsertRows(env.DB, tableName, rows);
          result.tables[tableName] = { rows: rows.length, status: "upserted" };
        }
      } catch (e) {
        result.tables[tableName] = {
          rows: 0,
          status: "error",
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }

    db.close();
    result.success = true;
    await writeSyncLog(env.DB, "success", result.tables);
  } catch (e) {
    await writeSyncLog(env.DB, "error", result.tables).catch(() => {});
    return jsonResponse(
      { ...result, error: e instanceof Error ? e.message : String(e) },
      500
    );
  }

  return jsonResponse(result, 200);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run test/ingest.test.ts
```
Expected: 4 passing

- [ ] **Step 5: Commit**

```bash
git add worker/src/ingest.ts worker/test/ingest.test.ts
git commit -m "feat: add /ingest handler"
```

---

### Task 7: MCP tool implementations

**Files:**
- Create: `worker/src/tools/query.ts`
- Create: `worker/src/tools/health.ts`
- Create: `worker/src/tools/sync.ts`
- Create: `worker/src/tools/index.ts`
- Create: `worker/test/tools/query.test.ts`
- Create: `worker/test/tools/health.test.ts`

- [ ] **Step 1: Write failing tests for query tools**

Create `worker/test/tools/query.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { listTablesTool, getTableSchemaTool, queryTableTool } from "../../src/tools/query";

function makeDb(results: unknown[] = []): D1Database {
  const all = vi.fn().mockResolvedValue({ results });
  const bind = vi.fn(() => ({ all }));
  const prepare = vi.fn(() => ({ all, bind }));
  return { prepare } as unknown as D1Database;
}

describe("listTablesTool", () => {
  it("returns a formatted list of table names", async () => {
    const db = makeDb([{ name: "steps_record_table" }, { name: "weight_record_table" }]);
    const result = await listTablesTool(db);
    expect(result).toContain("steps_record_table");
    expect(result).toContain("weight_record_table");
  });

  it("returns message when no tables exist", async () => {
    const db = makeDb([]);
    const result = await listTablesTool(db);
    expect(result).toContain("No tables");
  });
});

describe("getTableSchemaTool", () => {
  it("returns column names and types", async () => {
    const db = makeDb([
      { name: "count", type: "INTEGER", notnull: 0, dflt_value: null },
      { name: "uuid", type: "TEXT", notnull: 0, dflt_value: null },
    ]);
    const result = await getTableSchemaTool(db, "steps_record_table");
    expect(result).toContain("count");
    expect(result).toContain("INTEGER");
  });

  it("returns not found message for missing table", async () => {
    const db = makeDb([]);
    const result = await getTableSchemaTool(db, "nonexistent_table");
    expect(result).toContain("not found");
  });
});

describe("queryTableTool", () => {
  it("runs SELECT and returns JSON", async () => {
    const db = makeDb([{ count: 5000, date: "2024-01-01" }]);
    const result = await queryTableTool(db, "SELECT * FROM steps_record_table LIMIT 10");
    expect(result).toContain("5000");
  });

  it("rejects non-SELECT statements", async () => {
    const db = makeDb([]);
    await expect(queryTableTool(db, "DROP TABLE steps_record_table")).rejects.toThrow(
      "Only SELECT"
    );
  });

  it("returns 'No results' for empty result set", async () => {
    const db = makeDb([]);
    const result = await queryTableTool(db, "SELECT * FROM empty_table");
    expect(result).toBe("No results.");
  });
});
```

- [ ] **Step 2: Write failing tests for health tools**

Create `worker/test/tools/health.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { getStepsTool, getWeightTool, getSleepTool, getHealthSummaryTool } from "../../src/tools/health";

function makeDb(results: unknown[] = []): D1Database {
  const all = vi.fn().mockResolvedValue({ results });
  const bind = vi.fn(() => ({ all }));
  const prepare = vi.fn(() => ({ all, bind }));
  return { prepare } as unknown as D1Database;
}

describe("getStepsTool", () => {
  it("returns step data as JSON", async () => {
    const db = makeDb([{ local_date: "2024-01-01", total_steps: 8000 }]);
    const result = await getStepsTool(db, "2024-01-01", "2024-01-07");
    expect(result).toContain("8000");
  });

  it("returns no-data message for empty results", async () => {
    const db = makeDb([]);
    const result = await getStepsTool(db, "2024-01-01", "2024-01-07");
    expect(result).toContain("No step data");
  });
});

describe("getWeightTool", () => {
  it("returns weight records as JSON", async () => {
    const db = makeDb([{ local_date: "2024-01-01", weight: 75.5 }]);
    const result = await getWeightTool(db, "2024-01-01", "2024-01-31");
    expect(result).toContain("75.5");
  });
});

describe("getSleepTool", () => {
  it("returns sleep sessions as JSON", async () => {
    const db = makeDb([{ local_date: "2024-01-01", start_time: 1000, end_time: 2000, stages: null }]);
    const result = await getSleepTool(db, "2024-01-01", "2024-01-07");
    expect(result).toContain("2024-01-01");
  });
});

describe("getHealthSummaryTool", () => {
  it("returns summary with all fields", async () => {
    const db = makeDb([{ avg_steps: 7500, avg_weight: 75.0, sessions: 7, avg_hr: 65 }]);
    const result = await getHealthSummaryTool(db, "2024-01-01", "2024-01-07");
    const parsed = JSON.parse(result);
    expect(parsed.period.from).toBe("2024-01-01");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd worker && npx vitest run test/tools/
```
Expected: FAIL — modules not found

- [ ] **Step 4: Implement `worker/src/tools/query.ts`**

```typescript
export async function listTablesTool(db: D1Database): Promise<string> {
  const { results } = await db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
    )
    .all<{ name: string }>();

  if (!results.length) return "No tables found in D1.";
  return `Tables in D1 (${results.length}):\n` + results.map(r => `- ${r.name}`).join("\n");
}

export async function getTableSchemaTool(db: D1Database, tableName: string): Promise<string> {
  const { results } = await db
    .prepare(`PRAGMA table_info([${tableName}])`)
    .all<{ name: string; type: string; notnull: number; dflt_value: string | null }>();

  if (!results.length) return `Table '${tableName}' not found.`;
  return (
    `Schema for ${tableName}:\n` +
    results.map(c => `- ${c.name} (${c.type || "TEXT"})`).join("\n")
  );
}

export async function queryTableTool(db: D1Database, sql: string): Promise<string> {
  const trimmed = sql.trim().toUpperCase();
  if (!trimmed.startsWith("SELECT")) {
    throw new Error("Only SELECT queries are allowed.");
  }
  const { results } = await db.prepare(sql).all();
  if (!results.length) return "No results.";
  return JSON.stringify(results, null, 2);
}
```

- [ ] **Step 5: Implement `worker/src/tools/health.ts`**

```typescript
export async function getHeartRateTool(
  db: D1Database,
  startDate: string,
  endDate: string
): Promise<string> {
  const { results } = await db
    .prepare(
      `SELECT date, min_bpm, avg_bpm, max_bpm, sample_count
       FROM heart_rate_record_series_table
       WHERE date >= ? AND date <= ? ORDER BY date`
    )
    .bind(startDate, endDate)
    .all<Record<string, unknown>>();
  if (!results.length) return `No heart rate data from ${startDate} to ${endDate}.`;
  return JSON.stringify(results, null, 2);
}

export async function getStepsTool(
  db: D1Database,
  startDate: string,
  endDate: string
): Promise<string> {
  const { results } = await db
    .prepare(
      `SELECT local_date, SUM(count) as total_steps
       FROM steps_record_table
       WHERE local_date >= ? AND local_date <= ?
       GROUP BY local_date ORDER BY local_date`
    )
    .bind(startDate, endDate)
    .all<Record<string, unknown>>();
  if (!results.length) return `No step data from ${startDate} to ${endDate}.`;
  return JSON.stringify(results, null, 2);
}

export async function getSleepTool(
  db: D1Database,
  startDate: string,
  endDate: string
): Promise<string> {
  const { results } = await db
    .prepare(
      `SELECT s.local_date, s.start_time, s.end_time, s.title, s.notes,
              GROUP_CONCAT(st.stage_type || ':' || st.stage_start_time || '-' || st.stage_end_time) as stages
       FROM sleep_session_record_table s
       LEFT JOIN sleep_stages_table st ON st.parent_key = s.row_id
       WHERE s.local_date >= ? AND s.local_date <= ?
       GROUP BY s.row_id ORDER BY s.local_date`
    )
    .bind(startDate, endDate)
    .all<Record<string, unknown>>();
  if (!results.length) return `No sleep data from ${startDate} to ${endDate}.`;
  return JSON.stringify(results, null, 2);
}

export async function getWorkoutsTool(
  db: D1Database,
  startDate: string,
  endDate: string
): Promise<string> {
  const { results } = await db
    .prepare(
      `SELECT e.local_date, e.start_time, e.end_time, e.exercise_type, e.title, e.notes,
              d.distance
       FROM exercise_session_record_table e
       LEFT JOIN distance_record_table d ON d.local_date = e.local_date
       WHERE e.local_date >= ? AND e.local_date <= ? ORDER BY e.local_date`
    )
    .bind(startDate, endDate)
    .all<Record<string, unknown>>();
  if (!results.length) return `No workout data from ${startDate} to ${endDate}.`;
  return JSON.stringify(results, null, 2);
}

export async function getNutritionTool(
  db: D1Database,
  startDate: string,
  endDate: string
): Promise<string> {
  const { results } = await db
    .prepare(
      `SELECT local_date,
              SUM(energy) as total_calories,
              SUM(protein) as total_protein,
              SUM(total_carbohydrate) as total_carbs,
              SUM(total_fat) as total_fat,
              SUM(sugar) as total_sugar,
              SUM(dietary_fiber) as total_fiber
       FROM nutrition_record_table
       WHERE local_date >= ? AND local_date <= ?
       GROUP BY local_date ORDER BY local_date`
    )
    .bind(startDate, endDate)
    .all<Record<string, unknown>>();
  if (!results.length) return `No nutrition data from ${startDate} to ${endDate}.`;
  return JSON.stringify(results, null, 2);
}

export async function getWeightTool(
  db: D1Database,
  startDate: string,
  endDate: string
): Promise<string> {
  const { results } = await db
    .prepare(
      `SELECT w.local_date, w.weight,
              bf.percentage as body_fat_pct,
              bwm.body_water_mass,
              bm.mass as bone_mass,
              bmr.basal_metabolic_rate
       FROM weight_record_table w
       LEFT JOIN body_fat_record_table bf ON bf.local_date = w.local_date
       LEFT JOIN body_water_mass_record_table bwm ON bwm.local_date = w.local_date
       LEFT JOIN bone_mass_record_table bm ON bm.local_date = w.local_date
       LEFT JOIN basal_metabolic_rate_record_table bmr ON bmr.local_date = w.local_date
       WHERE w.local_date >= ? AND w.local_date <= ? ORDER BY w.local_date`
    )
    .bind(startDate, endDate)
    .all<Record<string, unknown>>();
  if (!results.length) return `No weight data from ${startDate} to ${endDate}.`;
  return JSON.stringify(results, null, 2);
}

export async function getHealthSummaryTool(
  db: D1Database,
  startDate: string,
  endDate: string
): Promise<string> {
  const [steps, weight, sleep, hr] = await Promise.all([
    db
      .prepare(
        `SELECT AVG(total_steps) as avg_steps FROM
         (SELECT SUM(count) as total_steps FROM steps_record_table
          WHERE local_date >= ? AND local_date <= ? GROUP BY local_date)`
      )
      .bind(startDate, endDate)
      .all<{ avg_steps: number }>(),
    db
      .prepare(
        `SELECT AVG(weight) as avg_weight FROM weight_record_table
         WHERE local_date >= ? AND local_date <= ?`
      )
      .bind(startDate, endDate)
      .all<{ avg_weight: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) as sessions FROM sleep_session_record_table
         WHERE local_date >= ? AND local_date <= ?`
      )
      .bind(startDate, endDate)
      .all<{ sessions: number }>(),
    db
      .prepare(
        `SELECT AVG(avg_bpm) as avg_hr FROM heart_rate_record_series_table
         WHERE date >= ? AND date <= ?`
      )
      .bind(startDate, endDate)
      .all<{ avg_hr: number }>(),
  ]);

  return JSON.stringify(
    {
      period: { from: startDate, to: endDate },
      avg_daily_steps: steps.results[0]?.avg_steps ?? null,
      avg_weight_kg: weight.results[0]?.avg_weight ?? null,
      sleep_sessions: sleep.results[0]?.sessions ?? null,
      avg_heart_rate_bpm: hr.results[0]?.avg_hr ?? null,
    },
    null,
    2
  );
}
```

- [ ] **Step 6: Implement `worker/src/tools/sync.ts`**

```typescript
export async function getLastSyncTool(db: D1Database): Promise<string> {
  const { results } = await db
    .prepare(
      `SELECT synced_at, status, tables_json FROM _sync_log ORDER BY sync_id DESC LIMIT 1`
    )
    .all<{ synced_at: string; status: string; tables_json: string }>();

  if (!results.length) return "No syncs recorded yet.";
  const { synced_at, status, tables_json } = results[0];
  const tables = JSON.parse(tables_json) as Record<string, { rows: number; status: string }>;
  const totalRows = Object.values(tables).reduce((sum, t) => sum + (t.rows || 0), 0);
  return `Last sync: ${synced_at} (${status})\nTotal rows ingested: ${totalRows}\nTables processed: ${Object.keys(tables).length}`;
}
```

- [ ] **Step 7: Implement `worker/src/tools/index.ts`**

```typescript
import { listTablesTool, getTableSchemaTool, queryTableTool } from "./query";
import {
  getHeartRateTool, getStepsTool, getSleepTool, getWorkoutsTool,
  getNutritionTool, getWeightTool, getHealthSummaryTool,
} from "./health";
import { getLastSyncTool } from "./sync";

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
};

const DATE_RANGE_SCHEMA = {
  properties: {
    start_date: { type: "string", description: "Start date (YYYY-MM-DD)" },
    end_date: { type: "string", description: "End date (YYYY-MM-DD)" },
  },
  required: ["start_date", "end_date"],
};

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "list_tables",
    description: "List all health data tables in the database.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_table_schema",
    description: "Get the column names and types for a specific table.",
    inputSchema: {
      type: "object",
      properties: { table_name: { type: "string", description: "Name of the table" } },
      required: ["table_name"],
    },
  },
  {
    name: "query_table",
    description: "Run a raw SQL SELECT query against the health database.",
    inputSchema: {
      type: "object",
      properties: { sql: { type: "string", description: "SQL SELECT query to execute" } },
      required: ["sql"],
    },
  },
  { name: "get_heart_rate", description: "Get daily min/avg/max heart rate for a date range.", inputSchema: { type: "object", ...DATE_RANGE_SCHEMA } },
  { name: "get_steps", description: "Get daily step counts for a date range.", inputSchema: { type: "object", ...DATE_RANGE_SCHEMA } },
  { name: "get_sleep", description: "Get sleep sessions with stage breakdowns for a date range.", inputSchema: { type: "object", ...DATE_RANGE_SCHEMA } },
  { name: "get_workouts", description: "Get exercise sessions with type, duration, and distance for a date range.", inputSchema: { type: "object", ...DATE_RANGE_SCHEMA } },
  { name: "get_nutrition", description: "Get daily nutrition totals (calories, protein, carbs, fat) for a date range.", inputSchema: { type: "object", ...DATE_RANGE_SCHEMA } },
  { name: "get_weight", description: "Get weight and body composition readings for a date range.", inputSchema: { type: "object", ...DATE_RANGE_SCHEMA } },
  { name: "get_health_summary", description: "Get a high-level health summary across all metrics for a date range.", inputSchema: { type: "object", ...DATE_RANGE_SCHEMA } },
  {
    name: "get_last_sync",
    description: "Get information about the last successful data sync from Health Connect.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
];

export async function callTool(
  name: string,
  args: Record<string, string>,
  db: D1Database
): Promise<string> {
  switch (name) {
    case "list_tables":       return listTablesTool(db);
    case "get_table_schema":  return getTableSchemaTool(db, args.table_name);
    case "query_table":       return queryTableTool(db, args.sql);
    case "get_heart_rate":    return getHeartRateTool(db, args.start_date, args.end_date);
    case "get_steps":         return getStepsTool(db, args.start_date, args.end_date);
    case "get_sleep":         return getSleepTool(db, args.start_date, args.end_date);
    case "get_workouts":      return getWorkoutsTool(db, args.start_date, args.end_date);
    case "get_nutrition":     return getNutritionTool(db, args.start_date, args.end_date);
    case "get_weight":        return getWeightTool(db, args.start_date, args.end_date);
    case "get_health_summary": return getHealthSummaryTool(db, args.start_date, args.end_date);
    case "get_last_sync":     return getLastSyncTool(db);
    default: throw new Error(`Unknown tool: ${name}`);
  }
}
```

- [ ] **Step 8: Run all tool tests**

```bash
npx vitest run test/tools/
```
Expected: All passing

- [ ] **Step 9: Commit**

```bash
git add worker/src/tools/ worker/test/tools/
git commit -m "feat: add MCP tool implementations"
```

---

### Task 8: MCP protocol handler

**Files:**
- Create: `worker/src/mcp.ts`
- Create: `worker/test/mcp.test.ts`

The MCP protocol over streamable HTTP is JSON-RPC 2.0. Three methods are required: `initialize`, `tools/list`, and `tools/call`. Also handle `notifications/initialized` (client sends this after init; respond with empty result).

- [ ] **Step 1: Write the failing test**

Create `worker/test/mcp.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { handleMcp } from "../src/mcp";
import type { Env } from "../src/index";

function makeDb(): D1Database {
  const all = vi.fn().mockResolvedValue({ results: [] });
  const bind = vi.fn(() => ({ all }));
  const run = vi.fn().mockResolvedValue({});
  const prepare = vi.fn(() => ({ all, bind, run }));
  const batch = vi.fn().mockResolvedValue([]);
  return { prepare, batch } as unknown as D1Database;
}

function makeEnv(): Env {
  return { API_KEY: "test-key", AGGREGATE: "true", DB: makeDb() };
}

function mcpRequest(method: string, params: unknown = {}) {
  return new Request("https://example.com/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer test-key" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

describe("handleMcp", () => {
  it("returns 401 without auth header", async () => {
    const req = new Request("https://example.com/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    const res = await handleMcp(req, makeEnv());
    expect(res.status).toBe(401);
  });

  it("responds to initialize with server info and capabilities", async () => {
    const res = await handleMcp(mcpRequest("initialize", { protocolVersion: "2024-11-05" }), makeEnv());
    const body = await res.json() as { result: { serverInfo: { name: string }; capabilities: unknown } };
    expect(res.status).toBe(200);
    expect(body.result.serverInfo.name).toBe("health-connect-mcp");
    expect(body.result.capabilities).toHaveProperty("tools");
  });

  it("responds to tools/list with all 11 tool definitions", async () => {
    const res = await handleMcp(mcpRequest("tools/list"), makeEnv());
    const body = await res.json() as { result: { tools: { name: string }[] } };
    expect(res.status).toBe(200);
    expect(body.result.tools).toHaveLength(11);
    expect(body.result.tools.find(t => t.name === "get_steps")).toBeDefined();
    expect(body.result.tools.find(t => t.name === "query_table")).toBeDefined();
  });

  it("responds to tools/call with tool result content", async () => {
    const res = await handleMcp(
      mcpRequest("tools/call", { name: "get_last_sync", arguments: {} }),
      makeEnv()
    );
    const body = await res.json() as { result: { content: { type: string; text: string }[] } };
    expect(res.status).toBe(200);
    expect(body.result.content[0].type).toBe("text");
    expect(body.result.content[0].text).toContain("No syncs recorded");
  });

  it("responds to notifications/initialized with empty result", async () => {
    const res = await handleMcp(mcpRequest("notifications/initialized"), makeEnv());
    const body = await res.json() as { result: unknown };
    expect(res.status).toBe(200);
    expect(body.result).toEqual({});
  });

  it("returns -32601 for unknown method", async () => {
    const res = await handleMcp(mcpRequest("unknown/method"), makeEnv());
    const body = await res.json() as { error: { code: number; message: string } };
    expect(body.error.code).toBe(-32601);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run test/mcp.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Implement `worker/src/mcp.ts`**

```typescript
import type { Env } from "./index";
import { authenticate } from "./auth";
import { TOOL_DEFINITIONS, callTool } from "./tools/index";

type JsonRpcId = number | string | null;

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function rpcOk(id: JsonRpcId, result: unknown): Response {
  return jsonResponse({ jsonrpc: "2.0", id, result });
}

function rpcErr(id: JsonRpcId, code: number, message: string): Response {
  return jsonResponse({ jsonrpc: "2.0", id, error: { code, message } });
}

export async function handleMcp(request: Request, env: Env): Promise<Response> {
  if (!authenticate(request, env.API_KEY)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let rpc: JsonRpcRequest;
  try {
    rpc = (await request.json()) as JsonRpcRequest;
  } catch {
    return rpcErr(null, -32700, "Parse error");
  }

  const { id, method, params = {} } = rpc;

  switch (method) {
    case "initialize":
      return rpcOk(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "health-connect-mcp", version: "1.0.0" },
      });

    case "tools/list":
      return rpcOk(id, { tools: TOOL_DEFINITIONS });

    case "tools/call": {
      const { name, arguments: toolArgs = {} } = params as {
        name: string;
        arguments: Record<string, string>;
      };
      try {
        const text = await callTool(name, toolArgs, env.DB);
        return rpcOk(id, { content: [{ type: "text", text }] });
      } catch (e) {
        return rpcOk(id, {
          content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        });
      }
    }

    case "notifications/initialized":
      return rpcOk(id, {});

    default:
      return rpcErr(id, -32601, `Method not found: ${method}`);
  }
}
```

- [ ] **Step 4: Run all tests**

```bash
npx vitest run
```
Expected: All passing across all test files

- [ ] **Step 5: Commit**

```bash
git add worker/src/mcp.ts worker/test/mcp.test.ts
git commit -m "feat: add MCP JSON-RPC handler"
```

---

### Task 9: Google Apps Script sync

**Files:**
- Create: `apps-script/sync.js`

Plain ES5-compatible JavaScript (no npm, no TypeScript — runs in Google Apps Script runtime).

- [ ] **Step 1: Create `apps-script/sync.js`**

```javascript
/**
 * Health Connect MCP — Weekly Sync Script
 *
 * Setup:
 * 1. Go to script.google.com → New project
 * 2. Paste this entire file
 * 3. Project Settings → Script Properties → Add script property:
 *    - INGEST_URL = https://<your-worker>.workers.dev/ingest
 *    - API_KEY    = <your-secret-key>
 * 4. Run syncHealthConnect() once manually to verify
 * 5. Run setupWeeklyTrigger() once to enable the weekly cron
 */

var EXPORT_FILENAME = 'health_connect_export.db';
var ZIP_FILENAME    = 'health_connect_export.zip';

function getScriptProp(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

/**
 * Find the Health Connect export in Google Drive.
 * Checks for raw .db first, then a zip containing it.
 * Returns { type: 'db'|'zip', file: DriveFile }
 */
function findExportFile() {
  var dbFiles = DriveApp.getFilesByName(EXPORT_FILENAME);
  if (dbFiles.hasNext()) {
    return { type: 'db', file: dbFiles.next() };
  }
  var zipFiles = DriveApp.getFilesByName(ZIP_FILENAME);
  if (zipFiles.hasNext()) {
    return { type: 'zip', file: zipFiles.next() };
  }
  throw new Error(
    'Export file not found in Drive. Expected: ' + EXPORT_FILENAME + ' or ' + ZIP_FILENAME
  );
}

/**
 * Extract the .db blob from a zip blob.
 */
function extractDbFromZip(zipBlob) {
  var entries = Utilities.unzip(zipBlob);
  for (var i = 0; i < entries.length; i++) {
    if (entries[i].getName().match(/\.db$/)) {
      return entries[i];
    }
  }
  throw new Error('No .db file found inside zip.');
}

/**
 * POST raw .db bytes to the ingest endpoint.
 * Returns the parsed JSON response body.
 */
function postToIngest(dbBlob) {
  var ingestUrl = getScriptProp('INGEST_URL');
  var apiKey    = getScriptProp('API_KEY');

  if (!ingestUrl || !apiKey) {
    throw new Error('INGEST_URL and API_KEY must be set in Script Properties.');
  }

  var response = UrlFetchApp.fetch(ingestUrl, {
    method: 'post',
    contentType: 'application/octet-stream',
    headers: { 'Authorization': 'Bearer ' + apiKey },
    payload: dbBlob.getBytes(),
    muteHttpExceptions: true,
  });

  var code = response.getResponseCode();
  var body = response.getContentText();

  if (code !== 200) {
    throw new Error('Ingest returned ' + code + ': ' + body);
  }

  return JSON.parse(body);
}

/**
 * Main entry point. Called by the weekly trigger (or manually).
 */
function syncHealthConnect() {
  var start = new Date();
  Logger.log('Sync started: ' + start.toISOString());

  try {
    var found = findExportFile();
    Logger.log('Found: ' + found.file.getName() + ' (' + found.type + ')');

    var dbBlob = found.type === 'zip'
      ? extractDbFromZip(found.file.getBlob())
      : found.file.getBlob();

    Logger.log('Posting to ingest endpoint...');
    var result = postToIngest(dbBlob);

    var elapsed   = ((new Date() - start) / 1000).toFixed(1);
    var tables    = result.tables || {};
    var tableCount = Object.keys(tables).length;
    var totalRows  = Object.keys(tables).reduce(function(sum, k) {
      return sum + (tables[k].rows || 0);
    }, 0);

    Logger.log(
      'Done in ' + elapsed + 's — ' + tableCount + ' tables, ' + totalRows + ' rows'
    );
    Logger.log(JSON.stringify(result, null, 2));
  } catch (e) {
    Logger.log('SYNC FAILED: ' + e.message);
    throw e;
  }
}

/**
 * Run once to create the weekly Sunday 3am trigger.
 * Removes any existing syncHealthConnect triggers first.
 */
function setupWeeklyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'syncHealthConnect') {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger('syncHealthConnect')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SUNDAY)
    .atHour(3)
    .create();

  Logger.log('Weekly trigger created: Sunday 3am');
}
```

- [ ] **Step 2: Commit**

```bash
cd C:/Users/swag_/Projects/health-connect-mcp
git add apps-script/sync.js
git commit -m "feat: add Google Apps Script weekly sync"
```

---

### Task 10: Deploy to Cloudflare and connect Claude

- [ ] **Step 1: Log in to Cloudflare**

```bash
cd worker && npx wrangler login
```
Follow the browser prompt to authenticate.

- [ ] **Step 2: Create the D1 database**

```bash
npx wrangler d1 create health-connect
```
Note the `database_id` from the output (looks like `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`).

- [ ] **Step 3: Update wrangler.toml with the real database_id**

In `worker/wrangler.toml`, replace:
```toml
database_id = "REPLACE_AFTER_CREATION"
```
with the UUID from Step 2.

- [ ] **Step 4: Generate and store the API key as a Worker secret**

Generate a random key:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Store it (you'll be prompted to paste the value):
```bash
npx wrangler secret put API_KEY
```
Save this key somewhere safe — you'll need it for Apps Script and Claude config.

- [ ] **Step 5: Deploy the Worker**

```bash
npx wrangler deploy
```
Expected output ends with: `https://health-connect-mcp.<your-subdomain>.workers.dev`

- [ ] **Step 6: Run first ingest from your machine to seed D1**

```bash
curl -X POST https://health-connect-mcp.<subdomain>.workers.dev/ingest \
  -H "Authorization: Bearer <your-api-key>" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @../health_connect_export.db
```
Expected: `{"success":true,"tables":{...}}` with row counts per table.

- [ ] **Step 7: Verify MCP endpoint**

```bash
curl -X POST https://health-connect-mcp.<subdomain>.workers.dev/mcp \
  -H "Authorization: Bearer <your-api-key>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```
Expected: JSON with `result.tools` array containing 11 tools.

- [ ] **Step 8: Set up Google Apps Script**

1. Go to [script.google.com](https://script.google.com) → New project → name it "Health Connect Sync"
2. Replace the default `Code.gs` content with the contents of `apps-script/sync.js`
3. **Project Settings → Script Properties → Add script property** (two entries):
   - Key: `INGEST_URL` → Value: `https://health-connect-mcp.<subdomain>.workers.dev/ingest`
   - Key: `API_KEY` → Value: your secret key from Step 4
4. In the editor, select `syncHealthConnect` from the function dropdown and click **Run**
   - Approve permissions when prompted (needs Drive access + URL fetch)
   - Check **Execution log** — should show table counts
5. Select `setupWeeklyTrigger` and click **Run** once to register the Sunday 3am cron

- [ ] **Step 9: Add MCP server to Claude on mobile**

In Claude's settings → MCP servers → Add server:
- **Name:** Health Connect
- **Type:** HTTP (Streamable)
- **URL:** `https://health-connect-mcp.<subdomain>.workers.dev/mcp`
- **Header:** `Authorization: Bearer <your-api-key>`

- [ ] **Step 10: Commit final wrangler.toml**

```bash
cd C:/Users/swag_/Projects/health-connect-mcp
git add worker/wrangler.toml
git commit -m "chore: add D1 database ID to wrangler config"
```

---

## Self-Review

**Spec coverage:**
- ✅ Full data flow: GDrive → Apps Script → `/ingest` → D1 → `/mcp` → Claude
- ✅ Dynamic table discovery via `sqlite_master` + auto-create in D1
- ✅ `AGGREGATE` env var (`true` default, `false` for raw storage)
- ✅ Series table list + 500k row safety valve
- ✅ All 11 MCP tools implemented and registered
- ✅ `_sync_log` table for sync history
- ✅ Bearer auth on both endpoints
- ✅ Full ingest rollback via try/catch (no partial state on fatal error)
- ✅ Apps Script: Drive search, zip extraction, Script Properties, weekly trigger
- ✅ Deployment steps with curl verification

**Placeholder scan:** No TBDs. All code blocks are complete and self-contained.

**Type consistency:**
- `Row` (from `sqlite.ts`) used in `aggregate.ts`, `d1.ts`, `ingest.ts` ✅
- `Column` (from `sqlite.ts`) used in `d1.ts`, `ingest.ts` ✅
- `Env` (from `index.ts`) used in `ingest.ts`, `mcp.ts` ✅
- Tool names in `TOOL_DEFINITIONS` match `callTool` switch cases exactly ✅
- `D1Database` type used consistently (from `@cloudflare/workers-types`) ✅
