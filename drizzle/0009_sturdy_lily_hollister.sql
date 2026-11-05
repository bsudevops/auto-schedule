ALTER TABLE "api_keys" ALTER COLUMN "workspace_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "oauth_codes" ALTER COLUMN "workspace_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "oauth_grants" ALTER COLUMN "workspace_id" DROP NOT NULL;