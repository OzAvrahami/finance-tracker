-- Migration: 001_add_is_active_updated_at_to_categories
-- Purpose: Prepare the categories table for soft-delete and audit support,
--          as required by the Settings/Admin panel (Phase 1).
--
-- Safe to run multiple times: ADD COLUMN IF NOT EXISTS is idempotent.
-- Existing rows receive is_active = true (no category is deactivated by default).
-- Existing rows receive updated_at = now() at migration time (no prior audit trail exists).

ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS is_active  BOOLEAN                      NOT NULL DEFAULT true;

ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE     NOT NULL DEFAULT timezone('utc'::text, now());
