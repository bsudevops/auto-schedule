import { describe, expect, it } from "vitest";
import { handleMessage, type Tool } from "./mcp-protocol";

type Ctx = { scopes: string[] };
const info = { name: "t", version: "1", instructions: "hi" };
const tools: Tool<Ctx>[] = [
  { name: "read", title: "Read", description: "r", inputSchema: { type: "object" }, readOnly: true, allowed: () => true, run: async () => ({ text: "ok" }) },
  { name: "write", title: "Write", description: "w", inputSchema: { type: "object" }, readOnly: false, allowed: (c) => c.scopes.includes("w"), run: async (a) => ({ text: JSON.stringify(a) }) },
  { name: "boom", title: "Boom", description: "b", inputSchema: { type: "object" }, readOnly: true, allowed: () => true, run: async () => { throw new Error("secret detail"); } },
];
const call = (m: unknown, scopes: string[] = []) => handleMessage(m, { scopes }, tools, info);
const rpc = (method: string, params?: unknown, id: number | null = 1) => ({ jsonrpc: "2.0", id, method, params });

describe("mcp protocol", () => {
  it("negotiates the protocol version", async () => {
    const a = (await call(rpc("initialize", { protocolVersion: "2025-03-26" }))) as { result: { protocolVersion: string; capabilities: object } };
    expect(a.result.protocolVersion).toBe("2025-03-26");
    expect(a.result.capabilities).toHaveProperty("tools");
    const b = (await call(rpc("initialize", { protocolVersion: "1999-01-01" }))) as { result: { protocolVersion: string } };
    expect(b.result.protocolVersion).toBe("2025-06-18");
  });
  it("sends no reply to notifications", async () => {
    expect(await call({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
  });
  it("answers ping", async () => {
    expect(await call(rpc("ping"))).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
  });
  it("lists only the tools the key may use", async () => {
    const names = async (scopes: string[]) => ((await call(rpc("tools/list"), scopes)) as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name);
    expect(await names([])).toEqual(["read", "boom"]);
    expect(await names(["w"])).toEqual(["read", "write", "boom"]);
  });
  it("refuses a tool the key may not use", async () => {
    const r = (await call(rpc("tools/call", { name: "write", arguments: {} }))) as { result: { isError: boolean } };
    expect(r.result.isError).toBe(true);
  });
  it("runs a tool with its arguments", async () => {
    const r = (await call(rpc("tools/call", { name: "write", arguments: { a: 1 } }), ["w"])) as { result: { content: { text: string }[]; isError?: boolean } };
    expect(r.result.content[0]!.text).toBe('{"a":1}');
    expect(r.result.isError).toBeUndefined();
  });
  it("does not leak error details from a failing tool", async () => {
    const r = (await call(rpc("tools/call", { name: "boom" }))) as { result: { isError: boolean; content: { text: string }[] } };
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0]!.text).not.toContain("secret");
  });
  it("reports unknown tools and methods as protocol errors", async () => {
    expect(((await call(rpc("tools/call", { name: "nope" }))) as { error: { code: number } }).error.code).toBe(-32602);
    expect(((await call(rpc("nope"))) as { error: { code: number } }).error.code).toBe(-32601);
  });
  it("rejects messages that are not JSON-RPC", async () => {
    expect(((await call("hello")) as { error: { code: number } }).error.code).toBe(-32600);
    expect(((await call({ id: 1, method: "ping" })) as { error: { code: number } }).error.code).toBe(-32600);
  });
});
