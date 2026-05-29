CREATE TABLE "shopify_app_installations" (
	"id" text PRIMARY KEY NOT NULL,
	"shop_domain" text NOT NULL,
	"access_token" text NOT NULL,
	"scope" text DEFAULT '' NOT NULL,
	"api_version" text DEFAULT '2026-04' NOT NULL,
	"provider_id" text NOT NULL,
	"catalog_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"active_registration_version" integer,
	"last_synced_at" timestamp with time zone,
	"last_run" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"shop_profile" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uninstalled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "shopify_app_installations_shop_domain_unique" ON "shopify_app_installations" USING btree ("shop_domain");--> statement-breakpoint
CREATE INDEX "shopify_app_installations_status_idx" ON "shopify_app_installations" USING btree ("status");