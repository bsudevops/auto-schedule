/**
 * Checks the SMTP settings in .env and sends one test email.
 *   npm run email:test -- you@company.com
 * With Docker: docker compose -f docker-compose.prod.yml exec web npm run email:test -- you@company.com
 */
import { emailConfigured, fromAddress, sendEmail, smtpOptions, verifyEmail } from "../src/lib/email";

const to = process.argv.slice(2).find((a) => a.includes("@"));
if (!to) {
  console.error("Usage: npm run email:test -- you@company.com");
  process.exit(1);
}
if (!emailConfigured()) {
  console.error("SMTP_HOST is empty in .env, so emails are only printed to the log. Set the SMTP_* variables first.");
  process.exit(1);
}
const o = smtpOptions();
console.log(`Server: ${o.host}:${o.port} (${o.secure ? "SSL" : "STARTTLS"}), login: ${o.auth?.user ?? "none"}, from: ${fromAddress()}`);
const problem = await verifyEmail();
if (problem) {
  console.error(`✗ ${problem}`);
  process.exit(1);
}
console.log("✓ Logged in to the SMTP server.");
await sendEmail({ to, subject: "Test email from BSU Scheduler", text: "Email sending works." });
console.log(`✓ Test email sent to ${to}.`);
process.exit(0);
