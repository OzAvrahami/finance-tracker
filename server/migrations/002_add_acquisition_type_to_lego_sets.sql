-- Migration: 002_add_acquisition_type_to_lego_sets
-- Purpose: Record how a LEGO set entered the collection (purchased / gift / trade / other),
--          so the collection form can distinguish purchases from gifts and other acquisitions.
--
-- IMPORTANT: Run this migration on Supabase BEFORE deploying the client/server changes that
-- send `acquisition_type`. Until this column exists, inserts/updates that include the field
-- will fail with a "column does not exist" error.
--
-- Safe to run multiple times: ADD COLUMN IF NOT EXISTS is idempotent.
-- Existing rows receive acquisition_type = 'purchased' (the historical default — every prior
-- set was recorded as a purchase). New rows that omit the field also default to 'purchased'.
--
-- Allowed values (purchased | gift | trade | other) are enforced in legoController.js,
-- consistent with how status/brand are validated in the app rather than via DB CHECK.

ALTER TABLE lego_sets
  ADD COLUMN IF NOT EXISTS acquisition_type TEXT NOT NULL DEFAULT 'purchased';
