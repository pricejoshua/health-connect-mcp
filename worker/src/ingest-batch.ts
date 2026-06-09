import { authenticate } from "./auth";
import { ensureTable, ensureSyncLog, writeSyncLog, upsertRows } from "./d1";
import type { Column, Row } from "./d1";
import type { Env } from "./index";

const TABLE_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function inferType(value: unknown): string {
  if (typeof value === "number") {
    return Number.isInteger(value) ? "INTEGER" : "REAL";
  }
  return "TEXT";
}

export async function handleIngestBatch(
  request: Request,
  env: Env
): Promise<Response> {
  if (!authenticate(request, env.API_KEY)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { table?: unknown; rows?: unknown; syncId?: unknown; done?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const table = body.table as string;
  const rows = body.rows as Row[];
  const syncId = body.syncId as string;
  const done = body.done as boolean;

  if (!table || !TABLE_NAME_RE.test(table)) {
    return Response.json({ error: "Invalid table name" }, { status: 400 });
  }

  await ensureSyncLog(env.DB);

  if (Array.isArray(rows) && rows.length > 0) {
    const firstRow = rows[0];
    const columns: Column[] = Object.keys(firstRow).map((name) => ({
      name,
      type: inferType(firstRow[name]),
    }));
    await ensureTable(env.DB, table, columns);
    await upsertRows(env.DB, table, rows);
  }

  if (done) {
    const id = typeof syncId === "string" ? syncId : new Date().toISOString();
    await writeSyncLog(env.DB, "success", { syncId: id });
  }

  return Response.json({
    success: true,
    inserted: Array.isArray(rows) ? rows.length : 0,
  });
}
