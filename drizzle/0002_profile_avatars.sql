ALTER TABLE "profiles" ADD COLUMN "avatar" "bytea";--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "avatar_type" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "avatar_version" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "avatar_checked_at" timestamp with time zone;