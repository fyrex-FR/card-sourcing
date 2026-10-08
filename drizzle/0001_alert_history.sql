ALTER TABLE "items" ADD COLUMN "image_url" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "is_auction" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "end_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "last_alert_kind" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "last_alerted_at" timestamp with time zone;