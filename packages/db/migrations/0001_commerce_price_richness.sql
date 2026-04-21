ALTER TABLE "provider_products"
ADD COLUMN IF NOT EXISTS "list_amount_cents" integer,
ADD COLUMN IF NOT EXISTS "price_type" text DEFAULT 'fixed' NOT NULL;
