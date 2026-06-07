CREATE TABLE "provider_api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"catalog_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"key_hash" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "provider_api_keys_provider_unique" ON "provider_api_keys" USING btree ("catalog_id","provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_api_keys_key_hash_unique" ON "provider_api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "provider_api_keys_provider_status_idx" ON "provider_api_keys" USING btree ("catalog_id","provider_id","status");
