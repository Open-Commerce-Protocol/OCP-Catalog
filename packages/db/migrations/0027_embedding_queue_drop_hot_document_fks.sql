ALTER TABLE "catalog_embedding_work_items"
  DROP CONSTRAINT IF EXISTS "catalog_embedding_work_items_catalog_search_document_id_catalog_search_documents_id_fk";
--> statement-breakpoint
ALTER TABLE "catalog_embedding_work_items"
  DROP CONSTRAINT IF EXISTS "catalog_embedding_work_items_catalog_search_document_id_fkey";
--> statement-breakpoint
ALTER TABLE "catalog_embedding_batch_items"
  DROP CONSTRAINT IF EXISTS "catalog_embedding_batch_items_catalog_search_document_id_catalog_search_documents_id_fk";
--> statement-breakpoint
ALTER TABLE "catalog_embedding_batch_items"
  DROP CONSTRAINT IF EXISTS "catalog_embedding_batch_items_catalog_search_document_id_fkey";
