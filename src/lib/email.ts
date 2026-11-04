import nodemailer from "nodemailer";

type Mail = { to: string; subject: string; text: string };

/** Sends an email through SMTP. Without SMTP_HOST (local development) it prints the email to the console. */
export async function sendEmail({ to, subject, text }: Mail): Promise<void> {
  if (!process.env.SMTP_HOST) {
    console.info(`\n--- Email to ${to} ---\nSubject: ${subject}\n\n${text}\n---------------------\n`);
    return;
  }
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
  });
  await transport.sendMail({ from: process.env.EMAIL_FROM, to, subject, text });
}
