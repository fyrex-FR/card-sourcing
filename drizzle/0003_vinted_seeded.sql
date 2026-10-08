ALTER TABLE "searches" ADD COLUMN "vinted_seeded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "searches" SET "vinted_seeded" = "seeded" WHERE 'VINTED' = ANY("marketplaces");