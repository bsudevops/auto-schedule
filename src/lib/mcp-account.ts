import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { orgMembers, organizations, workspaceMembers, workspaces } from "@/db/schema";
import type { AccountContext, ApiContext } from "./api-auth";
import type { Tool } from "./mcp-protocol";
import { mcpTools } from "./mcp-tools";
import { addWorkspaceToOrg } from "./org-workspaces";
import { can } from "./permissions";
import { TIMEZONES } from "./validation";

/**
 * Tools for a connection that covers every workspace the person owns or manages (one per client).
 * The workspace tools are the same as for a single workspace, plus a "workspace" argument.
 */

const json = (v: unknown) => ({ text: JSON.stringify(v, null, 2) });
const bad = (text: string) => ({ text, isError: true as const });

/** Workspaces this connection can reach: those the person owns or manages, in organizations that aren't being deleted. */
async function reachable(userId: string) {
  const rows = await db
    .select({ workspace: workspaces, orgName: organizations.name, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .innerJoin(organizations, eq(organizations.id, workspaces.orgId))
    .where(and(eq(workspaceMembers.userId, userId), isNull(workspaces.archivedAt), isNull(organizations.deletionRequestedAt)))
    .orderBy(asc(workspaces.name));
  return rows.filter((r) => can({ userId, role: r.role, active: true }, "manage_api"));
}

/** Finds the workspace a tool call names, by ID or by name (any case). With only one workspace, it may be left out. */
export async function resolveWorkspace(c: AccountContext, ref: unknown): Promise<ApiContext | string> {
  const all = await reachable(c.userId);
  if (!all.length) return "You don't own or manage any workspace yet. Use create_workspace to add one.";
  const names = all.map((w) => w.workspace.name).join(", ");
  let hit: (typeof all)[number] | undefined;
  if (typeof ref === "string" && ref.trim()) {
    const want = ref.trim().toLowerCase();
    hit = all.find((w) => w.workspace.id === ref.trim());
    if (!hit) {
      const byName = all.filter((w) => w.workspace.name.toLowerCase() === want);
      if (byName.length > 1) return `More than one workspace is called "${ref}". Use its ID from list_workspaces.`;
      hit = byName[0];
    }
    if (!hit) return `No workspace called "${ref}". You can use: ${names}.`;
  } else if (all.length === 1) {
    hit = all[0];
  } else {
    return `Say which workspace (client) to use. You can use: ${names}.`;
  }
  return { keyId: c.keyId, member: { userId: c.userId, role: hit!.role, active: true }, workspace: hit!.workspace, scopes: c.scopes };
}

const WORKSPACE_ARG = { type: "string", description: "The workspace (client) to work in: its name or ID from list_workspaces. Can be left out when there is only one." };

/** Wraps a single-workspace tool so it takes a "workspace" argument. */
function perWorkspace(t: Tool<ApiContext>): Tool<AccountContext> {
  const schema = t.inputSchema as { properties?: Record<string, unknown> };
  return {
    ...t,
    description: `${t.description} Pass the workspace (client) by name or ID.`,
    inputSchema: { ...t.inputSchema, properties: { workspace: WORKSPACE_ARG, ...(schema.properties ?? {}) } },
    allowed: (c) => t.allowed({ scopes: c.scopes } as ApiContext),
    run: async (args, c) => {
      const ws = await resolveWorkspace(c, (args as { workspace?: unknown } | null)?.workspace);
      if (typeof ws === "string") return bad(ws);
      const rest = { ...(args as Record<string, unknown>) };
      delete rest.workspace;
      return t.run(rest, ws);
    },
  };
}

export const accountTools: Tool<AccountContext>[] = [
  {
    name: "list_workspaces",
    title: "List workspaces",
    description: "Lists the workspaces (one per client or brand) this connection can use, with their organization, time zone and your role. Call this first, then pass the workspace name or ID to the other tools.",
    inputSchema: { type: "object", properties: {} },
    readOnly: true,
    allowed: () => true,
    run: async (_a, c) =>
      json({
        workspaces: (await reachable(c.userId)).map((r) => ({ id: r.workspace.id, name: r.workspace.name, organization: r.orgName, timezone: r.workspace.timezone, role: r.role })),
        scopes: c.scopes,
      }),
  },
  {
    name: "create_workspace",
    title: "Create workspace",
    description: "Adds a new workspace for a client or brand. Only organization owners and admins can. Only do this when the person asked for it.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "The client or brand name." },
        timezone: { type: "string", description: "IANA time zone, such as Asia/Kolkata. Defaults to the time zone of your other workspaces." },
        organization: { type: "string", description: "Organization name or ID. Can be left out when you belong to only one." },
      },
      required: ["name"],
    },
    readOnly: false,
    allowed: (c) => c.scopes.includes("workspaces:create"),
    run: async (args, c) => {
      const p = z.object({ name: z.string(), timezone: z.string().optional(), organization: z.string().optional() }).safeParse(args);
      if (!p.success) return bad("name is required.");
      const orgs = await db
        .select({ id: organizations.id, name: organizations.name, role: orgMembers.role })
        .from(orgMembers)
        .innerJoin(organizations, eq(organizations.id, orgMembers.orgId))
        .where(and(eq(orgMembers.userId, c.userId), isNull(organizations.deletionRequestedAt)));
      const admin = orgs.filter((o) => o.role !== "member");
      if (!admin.length) return bad("Only organization owners and admins can add workspaces.");
      const want = p.data.organization?.trim().toLowerCase();
      const org = want ? admin.find((o) => o.id === p.data.organization!.trim() || o.name.toLowerCase() === want) : admin.length === 1 ? admin[0] : undefined;
      if (!org) return bad(`Say which organization: ${admin.map((o) => o.name).join(", ")}.`);
      const existing = await reachable(c.userId);
      const timezone = p.data.timezone ?? existing[0]?.workspace.timezone ?? "UTC";
      if (!TIMEZONES.includes(timezone)) return bad(`Unknown time zone "${timezone}". Use an IANA name such as Asia/Kolkata.`);
      const r = await addWorkspaceToOrg(c.userId, org.id, { name: p.data.name, timezone });
      if (!r.ok) return bad(r.error);
      return json({ created: { id: r.id, name: p.data.name.trim(), organization: org.name, timezone } });
    },
  },
  ...mcpTools.map(perWorkspace),
];
