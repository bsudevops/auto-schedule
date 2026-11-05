ALTER TABLE "post_targets" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "post_targets" ADD COLUMN "removed_reason" text;