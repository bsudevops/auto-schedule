"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { overLimit } from "@/lib/limits";
import { signupAllowed } from "@/lib/signup-gate";
import { SIGNUP_CLOSED_MESSAGE } from "@/lib/signup-policy";

export async function signOut() {
  await auth.api.signOut({ headers: await headers() });
  redirect("/sign-in");
}

/** Lets the sign-up form say plainly when an email has no invitation. The real check also runs when the account is created. */
export async function signupCheckAction(email: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const ip = (await headers()).get("x-real-ip") ?? "unknown";
  if (await overLimit(`signupcheck:${ip}`, 10, 60)) return { ok: false, error: "Too many tries. Wait a minute and try again." };
  return (await signupAllowed(String(email).slice(0, 254))) ? { ok: true } : { ok: false, error: SIGNUP_CLOSED_MESSAGE };
}
