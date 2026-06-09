import { describe, it, expect, vi } from "vitest";
import { handleIngestBatch } from "../src/ingest-batch";
import type { Env } from "../src/index";

function makeDb(): D1Database {
  const run = vi.fn().mockResolvedValue({});
  const bind = vi.fn(() => ({ run }));
  const prepare = vi.fn(() => ({ run, bind }));
  const batch = vi.fn().mockResolvedValue([]);
  return { prepare, batch } as unknown as D1Database;
}

function makeEnv(overrides: Partial<Env> = {}): Env {
  return { API_KEY: "test-key", DB: makeDb(), ...overrides };
}

function makeReq(body: unknown, key = "test-key") {
  return new Request("https://x/ingest-batch", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  });
}

describe("handleIngestBatch", () => {
  it("returns 401 without Authorization header", async () => {
    const req = new Request("https://x/ingest-batch", { method: "POST", body: "{}" });
    expect((await handleIngestBatch(req, makeEnv())).status).toBe(401);
  });

  it("returns 401 with wrong API key", async () => {
    expect((await handleIngestBatch(makeReq({}, "wrong"), makeEnv())).status).toBe(401);
  });

  it("returns 400 for invalid JSON body", async () => {
    const req = new Request("https://x/ingest-batch", {
      method: "POST",
      body: "not json",
      headers: { Authorization: "Bearer test-key" },
    });
    expect((await handleIngestBatch(req, makeEnv())).status).toBe(400);
  });

  it("returns 400 for invalid table name", async () => {
    const res = await handleIngestBatch(
      makeReq({ table: "bad-name!", rows: [] }),
      makeEnv()
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for table name with semicolon", async () => {
    const res = await handleIngestBatch(
      makeReq({ table: "foo;DROP TABLE bar", rows: [] }),
      makeEnv()
    );
    expect(res.status).toBe(400);
  });

  it("returns 200 and inserts rows", async () => {
    const res = await handleIngestBatch(
      makeReq({ table: "steps_record_table", rows: [{ row_id: 1, steps: 5000 }] }),
      makeEnv()
    );
    expect(res.status).toBe(200);
    const json = await res.json() as { success: boolean; inserted: number };
    expect(json.success).toBe(true);
    expect(json.inserted).toBe(1);
  });

  it("returns 200 for empty rows array", async () => {
    const res = await handleIngestBatch(
      makeReq({ table: "test_table", rows: [] }),
      makeEnv()
    );
    expect(res.status).toBe(200);
    const json = await res.json() as { inserted: number };
    expect(json.inserted).toBe(0);
  });

  it("writes sync log when done=true", async () => {
    const db = makeDb();
    const res = await handleIngestBatch(
      makeReq({ table: "test_table", rows: [], syncId: "2024-01-01T00:00:00Z", done: true }),
      { API_KEY: "test-key", DB: db }
    );
    expect(res.status).toBe(200);
    // ensureSyncLog + writeSyncLog both call db.prepare
    expect(db.prepare).toHaveBeenCalled();
  });

  it("infers INTEGER type for integer values", async () => {
    const db = makeDb();
    await handleIngestBatch(
      makeReq({ table: "test_table", rows: [{ id: 42, name: "foo" }] }),
      { API_KEY: "test-key", DB: db }
    );
    const createCall = (db.prepare as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => String(c[0]).includes("CREATE TABLE IF NOT EXISTS [test_table]")
    );
    expect(createCall).toBeDefined();
    expect(createCall![0]).toContain("INTEGER");
    expect(createCall![0]).toContain("TEXT");
  });

  it("infers REAL type for float values", async () => {
    const db = makeDb();
    await handleIngestBatch(
      makeReq({ table: "test_table", rows: [{ temp: 36.5 }] }),
      { API_KEY: "test-key", DB: db }
    );
    const createCall = (db.prepare as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => String(c[0]).includes("CREATE TABLE IF NOT EXISTS [test_table]")
    );
    expect(createCall).toBeDefined();
    expect(createCall![0]).toContain("REAL");
  });
});
