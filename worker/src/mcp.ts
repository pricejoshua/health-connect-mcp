import type { Env } from "./index";
import { authenticate } from "./auth";
import { TOOL_DEFINITIONS, callTool } from "./tools/index";

type JsonRpcId = number | string | null;

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function rpcOk(id: JsonRpcId, result: unknown): Response {
  return jsonResponse({ jsonrpc: "2.0", id, result });
}

function rpcErr(id: JsonRpcId, code: number, message: string): Response {
  return jsonResponse({ jsonrpc: "2.0", id, error: { code, message } });
}

export async function handleMcp(request: Request, env: Env): Promise<Response> {
  if (!authenticate(request, env.API_KEY)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let rpc: JsonRpcRequest;
  try {
    rpc = (await request.json()) as JsonRpcRequest;
  } catch {
    return rpcErr(null, -32700, "Parse error");
  }

  const { id, method, params = {} } = rpc;

  switch (method) {
    case "initialize":
      return rpcOk(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "health-connect-mcp", version: "1.0.0" },
      });

    case "tools/list":
      return rpcOk(id, { tools: TOOL_DEFINITIONS });

    case "tools/call": {
      const { name, arguments: toolArgs = {} } = params as {
        name: string;
        arguments: Record<string, string>;
      };
      try {
        const text = await callTool(name, toolArgs, env.DB);
        return rpcOk(id, { content: [{ type: "text", text }] });
      } catch (e) {
        return rpcOk(id, {
          content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        });
      }
    }

    case "notifications/initialized":
      return rpcOk(id, {});

    default:
      return rpcErr(id, -32601, `Method not found: ${method}`);
  }
}
