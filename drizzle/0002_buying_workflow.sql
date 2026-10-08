ALTER TABLE "app_state" ADD COLUMN "import_vat_rate" double precision DEFAULT 0.2 NOT NULL;--> statement-breakpoint
ALTER TABLE "app_state" ADD COLUMN "customs_fee" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app_state" ADD COLUMN "reminder_minutes" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "fingerprint" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "country" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "marketplace" text DEFAULT 'EBAY_US' NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "price" double precision;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "shipping" double precision;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "currency" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "bid_count" integer;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "import_cost" double precision;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "status" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "status_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "max_bid" double precision;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "reminded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "searches" ADD COLUMN "required_words" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "searches" ADD COLUMN "grading" text DEFAULT 'ANY' NOT NULL;--> statement-breakpoint
ALTER TABLE "searches" ADD COLUMN "exclude_lots" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "searches" ADD COLUMN "min_seller_feedback_pct" double precision;--> statement-breakpoint
ALTER TABLE "searches" ADD COLUMN "min_seller_feedback_score" integer;--> statement-breakpoint
CREATE INDEX "items_fingerprint_idx" ON "items" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "items_status_idx" ON "items" USING btree ("status");