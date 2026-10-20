CREATE TABLE "comment_posts" (
	"profile_id" uuid NOT NULL,
	"post_id" text NOT NULL,
	"url" text NOT NULL,
	"posted_at" timestamp with time zone NOT NULL,
	"hook" text NOT NULL,
	"comments_count" integer NOT NULL,
	"synced_count" integer,
	"cursor" text,
	"synced_at" timestamp with time zone,
	CONSTRAINT "comment_posts_profile_id_post_id_pk" PRIMARY KEY("profile_id","post_id")
);
--> statement-breakpoint
CREATE TABLE "icp_scores" (
	"client_id" uuid NOT NULL,
	"person_id" text NOT NULL,
	"icp" text NOT NULL,
	"headline" text NOT NULL,
	"fit" text NOT NULL,
	"pct" integer,
	"confidence" integer,
	"scored_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "icp_scores_client_id_person_id_pk" PRIMARY KEY("client_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "post_comments" (
	"profile_id" uuid NOT NULL,
	"post_id" text NOT NULL,
	"comment_id" text NOT NULL,
	"person_id" text NOT NULL,
	"name" text NOT NULL,
	"headline" text NOT NULL,
	"profile_url" text NOT NULL,
	"network_distance" text,
	"is_company" boolean DEFAULT false NOT NULL,
	"text" text NOT NULL,
	"posted_at" timestamp with time zone NOT NULL,
	CONSTRAINT "post_comments_profile_id_comment_id_pk" PRIMARY KEY("profile_id","comment_id")
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "icp" text;--> statement-breakpoint
ALTER TABLE "comment_posts" ADD CONSTRAINT "comment_posts_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "icp_scores" ADD CONSTRAINT "icp_scores_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_comments" ADD CONSTRAINT "post_comments_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comment_posts_posted_idx" ON "comment_posts" USING btree ("profile_id","posted_at");--> statement-breakpoint
CREATE INDEX "post_comments_post_idx" ON "post_comments" USING btree ("profile_id","post_id");--> statement-breakpoint
CREATE INDEX "post_comments_person_idx" ON "post_comments" USING btree ("person_id");