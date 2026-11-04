CREATE TABLE "channel_metrics_daily" (
	"channel_id" uuid NOT NULL,
	"day" date NOT NULL,
	"followers" integer,
	"impressions" integer,
	"reach" integer,
	"engagements" integer,
	"video_views" integer,
	"link_clicks" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_metrics_daily_channel_id_day_pk" PRIMARY KEY("channel_id","day")
);
--> statement-breakpoint
CREATE TABLE "post_metrics" (
	"target_id" uuid PRIMARY KEY NOT NULL,
	"impressions" integer,
	"reach" integer,
	"likes" integer,
	"comments" integer,
	"shares" integer,
	"saves" integer,
	"video_views" integer,
	"clicks" integer,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inbox_messages" ADD COLUMN "author_name" text;--> statement-breakpoint
ALTER TABLE "inbox_threads" ADD COLUMN "post_target_id" uuid;--> statement-breakpoint
ALTER TABLE "inbox_threads" ADD COLUMN "meta" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "saved_replies" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "channel_metrics_daily" ADD CONSTRAINT "channel_metrics_daily_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_metrics" ADD CONSTRAINT "post_metrics_target_id_post_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."post_targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_threads" ADD CONSTRAINT "inbox_threads_post_target_id_post_targets_id_fk" FOREIGN KEY ("post_target_id") REFERENCES "public"."post_targets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_messages_thread_ext_uq" ON "inbox_messages" USING btree ("thread_id","external_id");--> statement-breakpoint
CREATE INDEX "inbox_messages_thread_idx" ON "inbox_messages" USING btree ("thread_id","created_at");