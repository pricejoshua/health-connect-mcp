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
