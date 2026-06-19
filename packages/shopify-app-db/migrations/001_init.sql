CREATE TABLE "shopify_app_installations" (
	"id" text PRIMARY KEY NOT NULL,
	"shop_domain" text NOT NULL,
	"scope" text DEFAULT '' NOT NULL,
	"api_version" text DEFAULT '2026-04' NOT NULL,
	"provider_id" text NOT NULL,
	"catalog_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"active_registration_version" integer,
	"last_synced_at" timestamp with time zone,
	"last_run" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"shop_profile" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"synced_object_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uninstalled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shopify_app_oauth_states" (
	"state" text PRIMARY KEY NOT NULL,
	"shop_domain" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shopify_app_sync_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"shop_domain" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shopify_app_tokens" (
	"shop_domain" text PRIMARY KEY NOT NULL,
	"access_token_ciphertext" text NOT NULL,
	"key_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shopify_app_webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"webhook_id" text NOT NULL,
	"shop_domain" text NOT NULL,
	"topic" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "shopify_app_installations_shop_domain_unique" ON "shopify_app_installations" USING btree ("shop_domain");--> statement-breakpoint
CREATE INDEX "shopify_app_installations_status_idx" ON "shopify_app_installations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "shopify_app_oauth_states_shop_domain_idx" ON "shopify_app_oauth_states" USING btree ("shop_domain");--> statement-breakpoint
CREATE INDEX "shopify_app_oauth_states_expires_at_idx" ON "shopify_app_oauth_states" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "shopify_app_sync_jobs_status_run_after_idx" ON "shopify_app_sync_jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "shopify_app_sync_jobs_shop_domain_idx" ON "shopify_app_sync_jobs" USING btree ("shop_domain");--> statement-breakpoint
CREATE UNIQUE INDEX "shopify_app_webhook_events_webhook_id_unique" ON "shopify_app_webhook_events" USING btree ("webhook_id");--> statement-breakpoint
CREATE INDEX "shopify_app_webhook_events_status_idx" ON "shopify_app_webhook_events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "shopify_app_webhook_events_shop_topic_idx" ON "shopify_app_webhook_events" USING btree ("shop_domain","topic");