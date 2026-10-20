CREATE TABLE "leadshark_calls" (
	"profile_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leadshark_calls" ADD CONSTRAINT "leadshark_calls_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leadshark_calls_profile_idx" ON "leadshark_calls" USING btree ("profile_id","at");