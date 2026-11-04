/**
 * Who may create an account. By default anyone can. With SIGNUP_MODE=invite-only, only people
 * with a pending invitation for their email, and the addresses in ADMIN_EMAILS, can. Existing accounts always sign in.
 */
export type SignupMode = "open" | "invite-only";

export const signupMode = (env: Record<string, string | undefined> = process.env): SignupMode => (env.SIGNUP_MODE?.trim().toLowerCase() === "invite-only" ? "invite-only" : "open");

export const adminEmails = (env: Record<string, string | undefined> = process.env): string[] =>
  (env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);

export const isAdminEmail = (email: string, env: Record<string, string | undefined> = process.env) => adminEmails(env).includes(email.trim().toLowerCase());

export const SIGNUP_CLOSED_MESSAGE = "Sign-up is by invitation only. Ask your team's admin to invite you.";
