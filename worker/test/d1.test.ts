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
