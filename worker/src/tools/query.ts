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
  // Validate table name to prevent injection via bracket escape
  if (/[;\]'"--]/.test(tableName)) {
    return `Invalid table name: '${tableName}'. Table names must not contain special characters.`;
  }
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
  if (sql.includes(";")) {
    throw new Error("Only single SELECT statements are allowed. Remove the semicolon.");
  }
  const { results } = await db.prepare(sql).all();
  if (!results.length) return "No results.";
  return JSON.stringify(results, null, 2);
}
