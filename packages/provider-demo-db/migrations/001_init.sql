CREATE TABLE "provider_products" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"sku" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"brand" text NOT NULL,
	"category" text NOT NULL,
	"product_url" text NOT NULL,
	"image_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"currency" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"availability_status" text NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_sync_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"run_type" text NOT NULL,
	"target_product_id" text,
	"registration_version" integer,
	"status" text NOT NULL,
	"request_payload" jsonb,
	"result_payload" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "provider_products_provider_sku_unique" ON "provider_products" USING btree ("provider_id","sku");--> statement-breakpoint
CREATE INDEX "provider_products_provider_status_idx" ON "provider_products" USING btree ("provider_id","status");--> statement-breakpoint
CREATE INDEX "provider_sync_runs_provider_created_idx" ON "provider_sync_runs" USING btree ("provider_id","created_at");