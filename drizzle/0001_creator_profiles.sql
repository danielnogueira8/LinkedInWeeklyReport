CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"linkedin_url" text NOT NULL,
	"api_key_encrypted" text NOT NULL,
	"api_key_last4" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "profiles_client_idx" ON "profiles" USING btree ("client_id","position");--> statement-breakpoint
-- Hand-added: every existing client becomes a one-creator client before its columns go.
INSERT INTO "profiles" ("client_id", "name", "linkedin_url", "api_key_encrypted", "api_key_last4", "position", "created_at")
SELECT "id", "name", "linkedin_url", "api_key_encrypted", "api_key_last4", 0, "created_at" FROM "clients";--> statement-breakpoint
ALTER TABLE "clients" DROP COLUMN "linkedin_url";--> statement-breakpoint
ALTER TABLE "clients" DROP COLUMN "api_key_encrypted";--> statement-breakpoint
ALTER TABLE "clients" DROP COLUMN "api_key_last4";