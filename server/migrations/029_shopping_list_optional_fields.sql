-- Migration 029: optional shopping-list header metadata (#2).
-- Apply before deploying the compatible server, then client. No backfill.
BEGIN;
ALTER TABLE public.shopping_lists
  ADD COLUMN store TEXT,
  ADD COLUMN link TEXT,
  ADD COLUMN target_date DATE;
COMMIT;
