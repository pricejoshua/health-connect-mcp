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
