import nodemailer, { type Transporter } from "nodemailer";
import { BRAND } from "./brand";

/** One email. `text` is required; when `button` is given, the HTML version shows it as a button and the text version as a link. */
export type Mail = { to: string; subject: string; text: string; button?: { label: string; url: string } };

/** True when SMTP is configured. Without it emails are printed to the server log instead of being sent. */
export const emailConfigured = () => Boolean(process.env.SMTP_HOST?.trim());

/** The public address of the app, used for links in emails. */
export const appUrl = () => (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

/** SMTP settings from the environment. Port 465 uses TLS from the start; other ports (587) upgrade with STARTTLS. */
export function smtpOptions(env: Record<string, string | undefined> = process.env) {
  const host = env.SMTP_HOST?.trim() ?? "";
  const port = Number(env.SMTP_PORT || 587);
  const secure = env.SMTP_SECURE ? env.SMTP_SECURE === "true" : port === 465;
  const user = env.SMTP_USER?.trim();
  // Gmail shows app passwords in groups of four ("abcd efgh ijkl mnop"); the spaces aren't part of it.
  const rawPass = env.SMTP_PASSWORD ?? "";
  const pass = /(^|\.)gmail\.com$|googlemail\.com$/i.test(host) ? rawPass.replace(/\s+/g, "") : rawPass;
  return {
    host,
    port,
    secure,
    auth: user ? { user, pass } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  };
}

/** The From address: EMAIL_FROM, or the SMTP login with the product name (Gmail rewrites other addresses anyway). */
export function fromAddress(env: Record<string, string | undefined> = process.env) {
  const from = env.EMAIL_FROM?.trim();
  if (from && !/@example\.com>?$/i.test(from)) return from;
  const user = env.SMTP_USER?.trim();
  return user?.includes("@") ? `"${BRAND.name}" <${user}>` : from || `"${BRAND.name}" <no-reply@localhost>`;
}

let transport: Transporter | null = null;
let transportKey = "";
function getTransport() {
  const opts = smtpOptions();
  const key = JSON.stringify(opts);
  if (!transport || key !== transportKey) {
    transport = nodemailer.createTransport(opts);
    transportKey = key;
  }
  return transport;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** A simple, email-client-safe HTML version of the message. */
export function renderHtml({ subject, text, button }: Pick<Mail, "subject" | "text" | "button">) {
  const paras = text
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;line-height:1.55">${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const btn = button
    ? `<p style="margin:22px 0"><a href="${esc(button.url)}" style="display:inline-block;background:#2f5bea;color:#ffffff;text-decoration:none;font-weight:600;padding:11px 20px;border-radius:8px">${esc(button.label)}</a></p>
<p style="margin:0 0 14px;font-size:12.5px;color:#6b7280;line-height:1.5">If the button doesn't work, copy this link into your browser:<br><a href="${esc(button.url)}" style="color:#2f5bea;word-break:break-all">${esc(button.url)}</a></p>`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(subject)}</title></head>
<body style="margin:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;padding:28px">
<tr><td style="font-size:15px">
<p style="margin:0 0 20px;font-weight:700;font-size:16px">${esc(BRAND.name)}</p>
${paras}${btn}
</td></tr></table>
<p style="font-size:12px;color:#9ca3af;margin:14px 0 0">Sent by ${esc(BRAND.name)} · <a href="${esc(appUrl())}" style="color:#9ca3af">${esc(appUrl().replace(/^https?:\/\//, ""))}</a></p>
</td></tr></table></body></html>`;
}

/**
 * Sends an email through SMTP (nodemailer). Without SMTP_HOST (local development) it prints the email to the console.
 * Throws when the SMTP server refuses the message, so callers decide whether a failure matters.
 */
export async function sendEmail({ to, subject, text, button }: Mail): Promise<void> {
  const body = button ? `${text}\n\n${button.label}: ${button.url}` : text;
  if (!emailConfigured()) {
    console.info(`\n--- Email to ${to} (SMTP_HOST not set, so not sent) ---\nSubject: ${subject}\n\n${body}\n---------------------\n`);
    return;
  }
  try {
    await getTransport().sendMail({ from: fromAddress(), to, subject, text: body, html: renderHtml({ subject, text, button }) });
  } catch (e) {
    console.error(`Email to ${to} failed (${subject}):`, e instanceof Error ? e.message : e);
    throw new Error(explainSmtpError(e));
  }
}

/** Checks that the app can log in to the SMTP server. Returns a plain-language problem, or null when it works. */
export async function verifyEmail(): Promise<string | null> {
  if (!emailConfigured()) return "Email isn't set up: SMTP_HOST is empty, so emails are only printed to the server log.";
  try {
    await getTransport().verify();
    return null;
  } catch (e) {
    return explainSmtpError(e);
  }
}

/** Turns nodemailer errors into something a person can act on. Never includes the password. */
export function explainSmtpError(e: unknown): string {
  const err = e as { code?: string; responseCode?: number; message?: string };
  const msg = err?.message ?? String(e);
  if (err?.code === "EAUTH" || err?.responseCode === 535 || /535|Username and Password not accepted|Invalid login/i.test(msg))
    return "The SMTP server rejected the username or password. For Gmail, SMTP_PASSWORD must be a 16-letter app password, not your normal password.";
  if (err?.code === "EDNS" || /ENOTFOUND|EAI_AGAIN/.test(msg)) return `Couldn't find the SMTP server "${process.env.SMTP_HOST}". Check SMTP_HOST.`;
  if (err?.code === "ETIMEDOUT" || err?.code === "ECONNECTION" || /ECONNREFUSED|ETIMEDOUT|timeout/i.test(msg))
    return `Couldn't connect to ${process.env.SMTP_HOST}:${process.env.SMTP_PORT || 587}. Check SMTP_PORT (587 or 465), and that the network allows outgoing mail.`;
  if (/wrong version number|ssl3_get_record|SSL routines/i.test(msg))
    return "TLS mismatch: use SMTP_PORT=465 for SSL, or 587 for STARTTLS (leave SMTP_SECURE empty so it's chosen automatically).";
  return `Sending email failed: ${msg}`;
}
