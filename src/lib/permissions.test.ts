import { describe, expect, it } from "vitest";
import { can, canEditPost, canManageMember, type Member } from "./permissions";

const m = (role: Member["role"], userId = "u1", active = true): Member => ({ userId, role, active });

describe("can", () => {
  it("lets viewers only view", () => {
    expect(can(m("viewer"), "view")).toBe(true);
    expect(can(m("viewer"), "create_posts")).toBe(false);
    expect(can(m("viewer"), "manage_workspace")).toBe(false);
  });
  it("denies everything to deactivated or missing members", () => {
    expect(can(m("owner", "u1", false), "view")).toBe(false);
    expect(can(null, "view")).toBe(false);
  });
  it("keeps channel and member management to managers and owners", () => {
    expect(can(m("editor"), "manage_channels")).toBe(false);
    expect(can(m("manager"), "manage_channels")).toBe(true);
  });
});

describe("canEditPost", () => {
  const draftBy = (authorId: string) => ({ authorId, status: "draft" });
  it("lets contributors edit only their own drafts", () => {
    expect(canEditPost(m("contributor", "a"), draftBy("a"))).toBe(true);
    expect(canEditPost(m("contributor", "a"), draftBy("b"))).toBe(false);
  });
  it("blocks viewers even on their own posts", () => {
    expect(canEditPost(m("viewer", "a"), draftBy("a"))).toBe(false);
  });
  it("lets editors edit others' posts", () => {
    expect(canEditPost(m("editor", "a"), draftBy("b"))).toBe(true);
  });
  it("blocks edits while a post is publishing", () => {
    expect(canEditPost(m("owner", "a"), { authorId: "a", status: "publishing" })).toBe(false);
  });
});

describe("canManageMember", () => {
  it("stops managers from removing or demoting owners", () => {
    expect(canManageMember(m("manager", "a"), m("owner", "b"), null)).toBe(false);
    expect(canManageMember(m("manager", "a"), m("owner", "b"), "viewer")).toBe(false);
  });
  it("stops promoting someone above yourself", () => {
    expect(canManageMember(m("manager", "a"), m("editor", "b"), "owner")).toBe(false);
    expect(canManageMember(m("manager", "a"), m("editor", "b"), "manager")).toBe(true);
  });
  it("stops changing your own role", () => {
    expect(canManageMember(m("owner", "a"), m("owner", "a"), "viewer")).toBe(false);
  });
});
