-- Preserve the three-stage LEGO purchase-price model and the provenance of
-- transaction-level discounts. Historical records intentionally remain
-- nullable/zero because their intermediate receipt price and allocation
-- cannot be inferred safely.

ALTER TABLE lego_sets
  ADD COLUMN IF NOT EXISTS receipt_price NUMERIC;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS global_discount_source TEXT;

ALTER TABLE transactions
  DROP CONSTRAINT IF EXISTS transactions_global_discount_source_check;

ALTER TABLE transactions
  ADD CONSTRAINT transactions_global_discount_source_check
  CHECK (
    global_discount_source IS NULL
    OR global_discount_source IN ('loyalty_points', 'coupon', 'store_credit', 'other')
  );

ALTER TABLE transaction_items
  ADD COLUMN IF NOT EXISTS acquisition_type TEXT NOT NULL DEFAULT 'purchased';

ALTER TABLE transaction_items
  DROP CONSTRAINT IF EXISTS transaction_items_acquisition_type_check;

ALTER TABLE transaction_items
  ADD CONSTRAINT transaction_items_acquisition_type_check
  CHECK (acquisition_type IN ('purchased', 'gift', 'trade', 'other'));

ALTER TABLE transaction_items
  ADD COLUMN IF NOT EXISTS allocated_global_discount NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE transaction_items
  DROP CONSTRAINT IF EXISTS transaction_items_allocated_global_discount_check;

ALTER TABLE transaction_items
  ADD CONSTRAINT transaction_items_allocated_global_discount_check
  CHECK (allocated_global_discount >= 0);

