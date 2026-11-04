/**
 * Creates (or repairs) an account from the command line: confirmed, with a password you type.
 * For the first admin when email sending isn't set up, or when someone can't reset their password.
 *   npm run admin:create -- --email you@company.com --name "Your Name"
 * The password is asked for with hidden input and never printed. Signing in leads to the setup
 * screen, where the account becomes the owner of the company it creates.
 */
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { db } from "../src/db";
import { account, user } from "../src/db/schema";
import { auth } from "../src/lib/auth";

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1]?.trim() : undefined;
}

/** Reads a line without showing what is typed. */
function askHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) return reject(new Error("Run this in a terminal so the password can be typed."));
    process.stdout.write(question);
    let value = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          return resolve(value);
        }
        if (ch === "\u0003") {
          stdin.setRawMode(false);
          process.stdout.write("\n");
          process.exit(130);
        }
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

const email = arg("email")?.toLowerCase();
const name = arg("name");
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error('Usage: npm run admin:create -- --email you@company.com --name "Your Name"');
  process.exit(1);
}

const password = await askHidden("Password (at least 10 characters): ");
if (password.length < 10) {
  console.error("That password is too short. Use at least 10 characters.");
  process.exit(1);
}
if ((await askHidden("Type it again: ")) !== password) {
  console.error("The two passwords don't match. Nothing was changed.");
  process.exit(1);
}

const hash = await (await auth.$context).password.hash(password);
const [existing] = await db.select().from(user).where(eq(user.email, email));
const userId = existing?.id ?? randomUUID();

await db.transaction(async (tx) => {
  if (existing) await tx.update(user).set({ emailVerified: true, deactivatedAt: null }).where(eq(user.id, userId));
  else await tx.insert(user).values({ id: userId, email, name: name || email.split("@")[0]!, emailVerified: true });
  const [cred] = await tx.select({ id: account.id }).from(account).where(and(eq(account.userId, userId), eq(account.providerId, "credential")));
  if (cred) await tx.update(account).set({ password: hash }).where(eq(account.id, cred.id));
  else await tx.insert(account).values({ id: randomUUID(), accountId: userId, providerId: "credential", userId, password: hash });
});

console.log(`${existing ? "Updated" : "Created"} ${email}: confirmed, and the password is set.`);
console.log(`Sign in at ${process.env.APP_URL ?? "your app address"}/sign-in`);
process.exit(0);
