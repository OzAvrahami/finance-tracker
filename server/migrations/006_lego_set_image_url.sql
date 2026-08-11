-- Preserve the authoritative product image returned by the existing LEGO
-- lookup. Historical rows remain NULL and continue using the client fallback.
ALTER TABLE lego_sets
  ADD COLUMN IF NOT EXISTS image_url TEXT;
