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
