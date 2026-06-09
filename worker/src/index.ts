export interface Env {
  DB: D1Database;
  API_KEY: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/ingest-batch") {
      const { handleIngestBatch } = await import("./ingest-batch");
      return handleIngestBatch(request, env);
    }

    if (request.method === "POST" && url.pathname === "/mcp") {
      const { handleMcp } = await import("./mcp");
      return handleMcp(request, env);
    }

    return new Response("Not Found", { status: 404 });
  },
};
