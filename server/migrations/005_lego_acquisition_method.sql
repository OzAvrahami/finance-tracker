-- Replace the legacy LEGO acquisition vocabulary with the three product
-- meanings used by both collection records and transaction LEGO lines:
-- purchase | gift | gwp.
--
-- A historical transaction line is promoted from gift to gwp only when the
-- old application recorded the complete, explicit GWP pattern: a LEGO set
-- number, a 100% item discount, and a zero after-item-discount price. Zero
-- purchase cost by itself is deliberately not used for classification.

-- Remove the old vocabulary checks before writing the new value. The whole
-- migration is transactional, so a later ambiguity error restores them too.
ALTER TABLE transaction_items
  DROP CONSTRAINT IF EXISTS transaction_items_acquisition_type_check;

ALTER TABLE lego_sets
  DROP CONSTRAINT IF EXISTS lego_sets_acquisition_type_check;

UPDATE transaction_items
SET acquisition_type = 'gwp'
WHERE acquisition_type = 'gift'
  AND NULLIF(BTRIM(set_number), '') IS NOT NULL
  AND discount_type = 'percent'
  AND discount_value = 100
  AND final_price = 0;

UPDATE lego_sets AS lego
SET acquisition_type = 'gwp'
FROM transaction_items AS item
WHERE item.acquisition_type = 'gwp'
  AND lego.transaction_id = item.transaction_id
  AND lego.set_number = item.set_number
  AND lego.acquisition_type = 'gift';

UPDATE transaction_items
SET acquisition_type = 'purchase'
WHERE acquisition_type = 'purchased';

UPDATE lego_sets
SET acquisition_type = 'purchase'
WHERE acquisition_type = 'purchased';

-- Do not silently reinterpret legacy trade/other values. If another database
-- contains them, the migration stops transactionally for explicit review and
-- leaves all existing rows unchanged.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM lego_sets
    WHERE acquisition_type NOT IN ('purchase', 'gift', 'gwp')
  ) OR EXISTS (
    SELECT 1 FROM transaction_items
    WHERE acquisition_type NOT IN ('purchase', 'gift', 'gwp')
  ) THEN
    RAISE EXCEPTION 'Ambiguous legacy LEGO acquisition values require manual classification before migration 005';
  END IF;
END
$$;

ALTER TABLE lego_sets
  ALTER COLUMN acquisition_type SET DEFAULT 'purchase';

ALTER TABLE lego_sets
  ADD CONSTRAINT lego_sets_acquisition_type_check
  CHECK (acquisition_type IN ('purchase', 'gift', 'gwp'));

ALTER TABLE transaction_items
  ALTER COLUMN acquisition_type SET DEFAULT 'purchase';

ALTER TABLE transaction_items
  ADD CONSTRAINT transaction_items_acquisition_type_check
  CHECK (acquisition_type IN ('purchase', 'gift', 'gwp'));

-- The manually entered current/estimated value feature is intentionally
-- removed. Cost, receipt price, and list/original price remain independent.
ALTER TABLE lego_sets
  DROP COLUMN IF EXISTS market_value;
