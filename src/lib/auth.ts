import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { account, session, user, verification } from "@/db/schema";
import { BRAND } from "./brand";
import { sendEmail } from "./email";
import { signupAllowed } from "./signup-gate";
import { SIGNUP_CLOSED_MESSAGE } from "./signup-policy";

const google =
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    ? { google: { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET } }
    : undefined;

export const googleEnabled = Boolean(google);

export const auth = betterAuth({
  appName: BRAND.name,
  database: drizzleAdapter(db, { provider: "pg", schema: { user, session, account, verification } }),
  emailAndPassword: {
    enabled: true,
    // Email accounts must be verified before sign-in. This is what stops a Google sign-in
    // from being linked to an account someone else created with your address.
    requireEmailVerification: true,
    minPasswordLength: 10,
    sendResetPassword: async ({ user: u, url }) => {
      await sendEmail({
        to: u.email,
        subject: `Reset your ${BRAND.name} password`,
        text: `Someone asked to reset the password for your ${BRAND.name} account (${u.email}).\n\nIf it wasn't you, ignore this email and your password stays the same.`,
        button: { label: "Reset password", url },
      });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user: u, url }) => {
      await sendEmail({
        to: u.email,
        subject: `Confirm your email for ${BRAND.name}`,
        text: `Welcome to ${BRAND.name}. Confirm your email address to finish creating your account.`,
        button: { label: "Confirm email", url },
      });
    },
  },
  socialProviders: google,
  account: { accountLinking: { enabled: true, trustedProviders: ["google"] } },
  user: { additionalFields: { deactivatedAt: { type: "date", required: false, input: false } } },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    customRules: { "/sign-in/email": { window: 60, max: 10 }, "/sign-up/email": { window: 60, max: 5 }, "/request-password-reset": { window: 60, max: 5 } },
  },
  advanced: {
    // Only read the client IP from X-Real-IP, which the hosting proxy overwrites (Vercel does; configure Caddy or nginx to).
    // X-Forwarded-For is never trusted because clients can set it.
    ipAddress: { ipAddressHeaders: ["x-real-ip"] },
  },
  databaseHooks: {
    user: {
      create: {
        // In invite-only mode a new account needs a pending invitation for its email, unless it's an admin address.
        // This covers email sign-up and Google sign-in alike.
        before: async (u) => {
          if (!(await signupAllowed(u.email))) throw new APIError("FORBIDDEN", { message: SIGNUP_CLOSED_MESSAGE });
          return { data: u };
        },
      },
    },
    session: {
      create: {
        before: async (s) => {
          const [u] = await db.select({ deactivatedAt: user.deactivatedAt }).from(user).where(eq(user.id, s.userId));
          if (u?.deactivatedAt) return false;
          return { data: s };
        },
      },
    },
  },
  plugins: [nextCookies()],
});
