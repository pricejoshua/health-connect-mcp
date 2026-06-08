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
