CREATE TABLE "api_usage" (
	"day" text PRIMARY KEY NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"last_cycle_at" timestamp with time zone,
	"budget_warned_day" text,
	CONSTRAINT "app_state_singleton" CHECK ("app_state"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "blocked_sellers" (
	"username" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "items" (
	"item_key" text PRIMARY KEY NOT NULL,
	"search_id" integer,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"seller" text DEFAULT '' NOT NULL,
	"last_total" double precision,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"alerted_new_at" timestamp with time zone,
	"alerted_ending_at" timestamp with time zone,
	"muted" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "searches" (
	"id" serial PRIMARY KEY NOT NULL,
	"query" text NOT NULL,
	"max_price" double precision,
	"buying" text DEFAULT 'ALL' NOT NULL,
	"country" text,
	"excludes" text[] DEFAULT '{}'::text[] NOT NULL,
	"ending_window_min" integer DEFAULT 60 NOT NULL,
	"marketplaces" text[] DEFAULT '{EBAY_US}'::text[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"seeded" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_search_id_searches_id_fk" FOREIGN KEY ("search_id") REFERENCES "public"."searches"("id") ON DELETE set null ON UPDATE no action;