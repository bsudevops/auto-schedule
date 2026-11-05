import { z } from "zod";

export const TIMEZONES = Intl.supportedValuesOf("timeZone");

export const workspaceInput = z.object({
  name: z.string().trim().min(1, "Enter a workspace name.").max(80),
  timezone: z.string().refine((tz) => TIMEZONES.includes(tz), "Pick a time zone from the list."),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Pick a colour.").default("#2B86F5"),
});

export const workspaceSettingsInput = workspaceInput.extend({
  defaultHashtags: z.string().trim().max(500).default(""),
  defaultFirstComment: z.string().trim().max(2000).default(""),
  // One saved reply per line in the form.
  savedReplies: z
    .string()
    .max(5000)
    .default("")
    .transform((v) => [...new Set(v.split("\n").map((l) => l.trim()).filter(Boolean))])
    .pipe(z.array(z.string().max(300, "Keep each saved reply under 300 characters.")).max(12, "Keep to 12 saved replies or fewer.")),
});

export const onboardingInput = z.object({
  orgName: z.string().trim().min(1, "Enter your company or agency name.").max(80),
});

export const inviteInput = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  role: z.enum(["manager", "editor", "contributor", "viewer"]),
});

export type FormState = { error?: string; ok?: string; link?: string } | undefined;
