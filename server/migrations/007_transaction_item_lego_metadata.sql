-- Persist authoritative LEGO lookup metadata with the transaction item so
-- create and update synchronization use the same saved item representation.
ALTER TABLE transaction_items
  ADD COLUMN IF NOT EXISTS brand TEXT,
  ADD COLUMN IF NOT EXISTS pieces INTEGER,
  ADD COLUMN IF NOT EXISTS image_url TEXT;
