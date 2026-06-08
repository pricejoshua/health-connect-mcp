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
