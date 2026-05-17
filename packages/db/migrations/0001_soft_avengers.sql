ALTER TABLE "catalog_health_checks" ADD COLUMN "check_type" text DEFAULT 'query_probe' NOT NULL;--> statement-breakpoint
ALTER TABLE "catalog_health_checks" ADD COLUMN "response_payload" jsonb;--> statement-breakpoint
ALTER TABLE "registered_catalogs" ADD COLUMN "health_failure_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "registered_catalogs" ADD COLUMN "last_healthy_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "registered_catalogs" ADD COLUMN "last_unhealthy_at" timestamp with time zone;