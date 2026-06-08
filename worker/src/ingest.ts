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
