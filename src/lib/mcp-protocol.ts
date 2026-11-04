/**
 * A small Model Context Protocol server core (Streamable HTTP, JSON responses only). It knows
 * nothing about the database: tools are passed in, so it can be tested on its own.
 */
export const SUPPORTED_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;

export type ToolResult = { text: string; isError?: boolean };
export type Tool<C> = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly: boolean;
  /** Whether this caller may see and use the tool. */
  allowed: (ctx: C) => boolean;
  run: (args: unknown, ctx: C) => Promise<ToolResult>;
};

type Id = string | number | null;
export type RpcResponse = { jsonrpc: "2.0"; id: Id; result: unknown } | { jsonrpc: "2.0"; id: Id; error: { code: number; message: string } };

const fail = (id: Id, code: number, message: string): RpcResponse => ({ jsonrpc: "2.0", id, error: { code, message } });
const ok = (id: Id, result: unknown): RpcResponse => ({ jsonrpc: "2.0", id, result });

type Info = { name: string; version: string; instructions: string };

/** Handles one JSON-RPC message. Returns null for notifications and responses, which need no reply. */
export async function handleMessage<C>(raw: unknown, ctx: C, tools: Tool<C>[], info: Info): Promise<RpcResponse | null> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail(null, -32600, "Send a JSON-RPC 2.0 message.");
  const msg = raw as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
  const hasId = typeof msg.id === "string" || typeof msg.id === "number";
  if (msg.jsonrpc !== "2.0") return fail(hasId ? (msg.id as Id) : null, -32600, "jsonrpc must be \"2.0\".");
  if (typeof msg.method !== "string") return hasId ? fail(msg.id as Id, -32600, "Missing method.") : null; // a response from the client
  if (!hasId) return null; // notification, such as notifications/initialized
  const id = msg.id as Id;
  const params = (msg.params && typeof msg.params === "object" ? msg.params : {}) as Record<string, unknown>;

  switch (msg.method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      const version = (SUPPORTED_VERSIONS as readonly string[]).includes(asked) ? asked : SUPPORTED_VERSIONS[0];
      return ok(id, { protocolVersion: version, capabilities: { tools: { listChanged: false } }, serverInfo: { name: info.name, version: info.version }, instructions: info.instructions });
    }
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, {
        tools: tools.filter((t) => t.allowed(ctx)).map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: { readOnlyHint: t.readOnly, openWorldHint: false },
        })),
      });
    case "tools/call": {
      const tool = tools.find((t) => t.name === params.name);
      if (!tool) return fail(id, -32602, `Unknown tool: ${String(params.name)}`);
      if (!tool.allowed(ctx)) return ok(id, { isError: true, content: [{ type: "text", text: "This API key doesn't have permission to use that tool." }] });
      try {
        const r = await tool.run(params.arguments ?? {}, ctx);
        return ok(id, { content: [{ type: "text", text: r.text }], ...(r.isError ? { isError: true } : {}) });
      } catch {
        return ok(id, { isError: true, content: [{ type: "text", text: "Something went wrong on the server. Try again." }] });
      }
    }
    default:
      return fail(id, -32601, `Method not found: ${msg.method}`);
  }
}
