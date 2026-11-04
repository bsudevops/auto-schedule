import { and, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { invitations } from "@/db/schema";
import { isAdminEmail, signupMode } from "./signup-policy";

/** Whether this email may create a new account right now. */
export async function signupAllowed(email: string): Promise<boolean> {
  if (signupMode() === "open" || isAdminEmail(email)) return true;
  const [invite] = await db
    .select({ id: invitations.id })
    .from(invitations)
    .where(and(sql`lower(${invitations.email}) = ${email.trim().toLowerCase()}`, isNull(invitations.acceptedAt), gt(invitations.expiresAt, new Date())))
    .limit(1);
  return Boolean(invite);
}
