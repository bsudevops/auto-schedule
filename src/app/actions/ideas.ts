"use server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { ideaColumn, ideas } from "@/db/schema";
import { can } from "@/lib/permissions";
import { requireWorkspace } from "@/lib/session";

const COLS = ideaColumn.enumValues;

export async function createIdea(workspaceId: string, input: { title: string; tags: string; column: string }) {
  const { member } = await requireWorkspace(workspaceId, "create_posts");
  const parsed = z.object({
    title: z.string().trim().min(1, "Write the idea first.").max(200),
    tags: z.string().max(300).transform((s) => s.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 8)),
    column: z.enum(COLS),
  }).safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the idea and try again." };
  await db.insert(ideas).values({ workspaceId, title: parsed.data.title, tags: parsed.data.tags, column: parsed.data.column, position: Date.now() % 2_000_000_000, createdBy: member.userId });
  revalidatePath(`/w/${workspaceId}/ideas`);
  return { ok: "Idea added." };
}

export async function moveIdea(workspaceId: string, ideaId: string, column: string) {
  const { member } = await requireWorkspace(workspaceId, "create_posts");
  if (!(COLS as readonly string[]).includes(column)) return { error: "Unknown column." };
  const [idea] = await db.select().from(ideas).where(and(eq(ideas.id, ideaId), eq(ideas.workspaceId, workspaceId)));
  if (!idea) return { error: "That idea no longer exists." };
  if (idea.createdBy !== member.userId && !can(member, "edit_others_posts")) return { error: "You can only move your own ideas." };
  await db.update(ideas).set({ column: column as (typeof COLS)[number], position: Date.now() % 2_000_000_000 }).where(eq(ideas.id, ideaId));
  revalidatePath(`/w/${workspaceId}/ideas`);
  return { ok: "Moved." };
}

export async function deleteIdea(workspaceId: string, ideaId: string) {
  const { member } = await requireWorkspace(workspaceId, "create_posts");
  const [idea] = await db.select().from(ideas).where(and(eq(ideas.id, ideaId), eq(ideas.workspaceId, workspaceId)));
  if (!idea) return { error: "That idea no longer exists." };
  if (idea.createdBy !== member.userId && !can(member, "edit_others_posts")) return { error: "You can only delete your own ideas." };
  await db.delete(ideas).where(eq(ideas.id, ideaId));
  revalidatePath(`/w/${workspaceId}/ideas`);
  return { ok: "Deleted." };
}
