# DB Snapshot

This file is a database snapshot extracted directly from the real database.
It should be treated as the source of truth for current DB structure.

---

## Tables Overview

- budgets
- categories
- lego_sets
- loans
- merchant_category_map
- payment_sources
- shopping_catalog_categories
- shopping_catalog_category_list_types
- shopping_catalog_items
- shopping_checkouts
- shopping_list_items
- shopping_list_types
- shopping_lists
- transaction_items
- transactions
- whatsapp_pending_actions

---

## 1. budgets

### Columns
| column_name | data_type | nullable | default |
|---|---|---|---|
| id | bigint | NO | null |
| category_id | bigint | YES | null |
| month | text | NO | null |
| amount | numeric | NO | 0 |
| created_at | timestamp with time zone | NO | timezone('utc'::text, now()) |
| updated_at | timestamp with time zone | NO | timezone('utc'::text, now()) |

### Primary Key
- `id`

### Foreign Keys
- `category_id -> categories.id`

### Unique Constraints
- `(category_id, month)`

### Indexes
- `budgets_pkey` UNIQUE on `(id)`
- `budgets_category_id_month_key` UNIQUE on `(category_id, month)`

### Notes
- One budget per category per month.

---

## 2. categories

### Columns
| column_name | data_type | nullable | default |
|---|---|---|---|
| id | bigint | NO | null |
| name | text | NO | null |
| type | text | NO | 'expense'::text |
| keywords | ARRAY | YES | '{}'::text[] |
| icon | text | YES | null |
| created_at | timestamp with time zone | NO | timezone('utc'::text, now()) |

### Primary Key
- `id`

### Check Constraints
- `type IN ('income', 'expense')`

### Indexes
- `categories_pkey` UNIQUE on `(id)`

---

## 3. lego_sets

### Columns
| column_name | data_type | nullable | default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| set_number | text | NO | null |
| name | text | NO | null |
| theme | text | YES | null |
| pieces | integer | YES | null |
| purchase_price | numeric | YES | null |
| market_value | numeric | YES | null |
| status | text | YES | 'New'::text |
| purchase_date | date | YES | null |
| created_at | timestamp with time zone | YES | timezone('utc'::text, now()) |
| original_price | numeric | YES | 0 |
| transaction_id | integer | YES | null |
| brand | text | YES | 'LEGO'::text |

### Primary Key
- `id`

### Foreign Keys
- `transaction_id -> transactions.id`

### Indexes
- `lego_sets_pkey` UNIQUE on `(id)`

---

## 4. loans

### Columns
| column_name | data_type | nullable | default |
|---|---|---|---|
| id | bigint | NO | null |
| created_at | timestamp with time zone | NO | timezone('utc'::text, now()) |
| name | text | NO | null |
| lender_name | text | YES | null |
| loan_type | text | YES | null |
| original_amount | numeric | NO | null |
| current_balance | numeric | NO | null |
| monthly_payment | numeric | YES | null |
| interest_rate | numeric | YES | null |
| linkage_type | text | YES | null |
| total_installments | integer | YES | null |
| remaining_installments | integer | YES | null |
| start_date | date | YES | null |
| end_date | date | YES | null |
| status | text | YES | 'active'::text |
| notes | text | YES | null |
| amortization_type | text | YES | 'spitzer'::text |
| interest_type | text | YES | 'fixed'::text |
| prime_margin | numeric | YES | 0 |
| balloon_amount | numeric | YES | 0 |
| grace_months | integer | YES | 0 |

### Primary Key
- `id`

### Check Constraints
- `status IN ('active', 'paid', 'defaulted')`

### Indexes
- `loans_pkey` UNIQUE on `(id)`
- `idx_loans_status` on `(status)`

---

## 5. merchant_category_map

### Columns
| column_name | data_type | nullable | default |
|---|---|---|---|
| id | bigint | NO | null |
| wa_id | text | NO | null |
| merchant_normalized | text | NO | null |
| category_id | bigint | YES | null |
| created_at | timestamp with time zone | YES | now() |

### Primary Key
- `id`

### Foreign Keys
- `category_id -> categories.id`

### Unique Constraints
- `(wa_id, merchant_normalized)`

### Indexes
- `merchant_category_map_pkey` UNIQUE on `(id)`
- `merchant_category_map_wa_id_merchant_normalized_key` UNIQUE on `(wa_id, merchant_normalized)`

---

## 6. payment_sources

### Columns
| column_name | data_type | nullable | default |
|---|---|---|---|
| id | bigint | NO | null |
| name | text | NO | null |
| method | text | NO | null |
| owner | text | YES | null |
| slug | text | NO | null |
| is_active | boolean | NO | true |
| created_at | timestamp with time zone | NO | timezone('utc'::text, now()) |
| updated_at | timestamp with time zone | NO | timezone('utc'::text, now()) |
| issuer | text | YES | null |
| last4 | text | YES | null |

### Primary Key
- `id`

### Unique Constraints
- `slug`

### Check Constraints
- `method IN ('credit_card', 'debit_card', 'cash', 'bank_transfer', 'digital_wallet', 'check')`

### Indexes
- `payment_sources_pkey` UNIQUE on `(id)`
- `payment_sources_slug_key` UNIQUE on `(slug)`

---

## 7. shopping_catalog_categories

### Columns
| column_name | data_type | nullable | default |
|---|---|---|---|
| id | bigint | NO | null |
| name | text | NO | null |
| icon | text | YES | null |
| is_active | boolean | NO | true |
| created_at | timestamp with time zone | NO | timezone('utc'::text, now()) |
| updated_at | timestamp with time zone | NO | timezone('utc'::text, now()) |

### Primary Key
- `id`

### Unique Constraints
- `name`

### Indexes
- `catalog_categories_pkey` UNIQUE on `(id)`
- `catalog_categories_name_key` UNIQUE on `(name)`

---

## 8. shopping_catalog_category_list_types

### Columns
| column_name | data_type | nullable | default |
|---|---|---|---|
| category_id | bigint | NO | null |
| list_type_id | bigint | NO | null |
| created_at | timestamp with time zone | NO | timezone('utc'::text, now()) |

### Primary Key
- `(category_id, list_type_id)`

### Foreign Keys
- `category_id -> shopping_catalog_categories.id`
- `list_type_id -> shopping_list_types.id`

### Indexes
- `category_list_types_pkey` UNIQUE on `(category_id, list_type_id)`
- `idx_category_list_types_list_type` on `(list_type_id, category_id)`

### Notes
- Join table between shopping catalog categories and shopping list types.

---

## 9. shopping_catalog_items

### Columns
| column_name | data_type | nullable | default |
|---|---|---|---|
| id | bigint | NO | null |
| category_id | bigint | NO | null |
| name | text | NO | null |
| default_unit | text | YES | null |
| default_price | numeric | YES | null |
| is_active | boolean | NO | true |
| created_at | timestamp with time zone | NO | timezone('utc'::text, now()) |
| updated_at | timestamp with time zone | NO | timezone('utc'::text, now()) |

### Primary Key
- `id`

### Foreign Keys
- `category_id -> shopping_catalog_categories.id`

### Unique Constraints
- `(category_id, name)`

### Indexes
- `catalog_items_pkey` UNIQUE on `(id)`
- `catalog_items_category_id_name_key` UNIQUE on `(category_id, name)`
- `idx_catalog_items_category` on `(category_id)`

---

## 10. shopping_checkouts

### Columns
| column_name | data_type | nullable | default |
|---|---|---|---|
| id | bigint | NO | null |
| list_id | bigint | NO | null |
| checkout_date | date | NO | (timezone('utc'::text, now()))::date |
| total_amount | numeric | NO | null |
| payment_method | text | NO | 'credit_card'::text |
| payment_source_id | bigint | YES | null |
| category_id | bigint | YES | null |
| transaction_id | bigint | YES | null |
| created_at | timestamp with time zone | NO | timezone('utc'::text, now()) |

### Primary Key
- `id`

### Foreign Keys
- `list_id -> shopping_lists.id`

### Unique Constraints
- `list_id`

### Check Constraints
- `payment_method IN ('credit_card', 'cash', 'bank_transfer', 'direct_debit', 'bit', 'paypal', 'other')`
- `total_amount >= 0`

### Indexes
- `shopping_checkouts_pkey` UNIQUE on `(id)`
- `shopping_checkouts_list_id_key` UNIQUE on `(list_id)`
- `idx_shopping_checkouts_date` on `(checkout_date DESC)`

### Notes
- Current DB structure allows only one checkout per list.

---

## 11. shopping_list_items

### Columns
| column_name | data_type | nullable | default |
|---|---|---|---|
| id | bigint | NO | null |
| list_id | bigint | NO | null |
| catalog_item_id | bigint | YES | null |
| custom_name | text | YES | null |
| category_id | bigint | NO | null |
| quantity | numeric | YES | null |
| unit | text | YES | null |
| price | numeric | YES | null |
| is_purchased | boolean | NO | false |
| purchased_at | timestamp with time zone | YES | null |
| notes | text | YES | null |
| created_at | timestamp with time zone | NO | timezone('utc'::text, now()) |
| updated_at | timestamp with time zone | NO | timezone('utc'::text, now()) |

### Primary Key
- `id`

### Foreign Keys
- `list_id -> shopping_lists.id`
- `catalog_item_id -> shopping_catalog_items.id`
- `category_id -> shopping_catalog_categories.id`

### Check Constraints
- Either:
  - `catalog_item_id IS NOT NULL` and `custom_name IS NULL`
  - OR `catalog_item_id IS NULL` and `custom_name IS NOT NULL AND trimmed custom_name is not empty`

### Indexes
- `shopping_list_items_pkey` UNIQUE on `(id)`
- `idx_shopping_list_items_list` on `(list_id)`
- `idx_shopping_list_items_list_category` on `(list_id, category_id)`
- `idx_shopping_list_items_purchased` on `(list_id, is_purchased)`

### Notes
- A shopping list item is either a catalog item or a manual custom item.

---

## 12. shopping_list_types

### Columns
| column_name | data_type | nullable | default |
|---|---|---|---|
| id | bigint | NO | null |
| name | text | NO | null |
| slug | text | NO | null |
| is_active | boolean | NO | true |
| created_at | timestamp with time zone | NO | timezone('utc'::text, now()) |

### Primary Key
- `id`

### Unique Constraints
- `slug`

### Indexes
- `list_types_pkey` UNIQUE on `(id)`
- `list_types_slug_key` UNIQUE on `(slug)`

---

## 13. shopping_lists

### Columns
| column_name | data_type | nullable | default |
|---|---|---|---|
| id | bigint | NO | null |
| title | text | NO | null |
| list_type_id | bigint | NO | null |
| status | text | NO | 'active'::text |
| created_at | timestamp with time zone | NO | timezone('utc'::text, now()) |
| updated_at | timestamp with time zone | NO | timezone('utc'::text, now()) |

### Primary Key
- `id`

### Foreign Keys
- `list_type_id -> shopping_list_types.id`

### Check Constraints
- `status IN ('draft', 'active', 'checked_out', 'archived')`

### Indexes
- `shopping_lists_pkey` UNIQUE on `(id)`
- `idx_shopping_lists_type_status` on `(list_type_id, status)`

---

## 14. transaction_items

### Columns
| column_name | data_type | nullable | default |
|---|---|---|---|
| id | integer | NO | nextval('transaction_items_id_seq'::regclass) |
| transaction_id | integer | YES | null |
| item_name | character varying | NO | null |
| quantity | integer | YES | 1 |
| price_per_unit | numeric | YES | null |
| total_item_price | numeric | YES | null |
| set_number | text | YES | null |
| tags | text | YES | null |
| discount_type | text | YES | 'amount'::text |
| discount_value | numeric | YES | 0 |
| final_price | numeric | YES | 0 |
| theme | text | YES | null |

### Primary Key
- `id`

### Foreign Keys
- `transaction_id -> transactions.id`

### Indexes
- `transaction_items_pkey` UNIQUE on `(id)`

---

## 15. transactions

### Columns
| column_name | data_type | nullable | default |
|---|---|---|---|
| id | integer | NO | nextval('transactions_id_seq'::regclass) |
| movement_type | character varying | NO | null |
| description | character varying | YES | null |
| total_amount | numeric | NO | null |
| transaction_date | date | NO | null |
| payment_method | character varying | YES | null |
| created_at | timestamp without time zone | YES | CURRENT_TIMESTAMP |
| payment_source | text | YES | null |
| tags | text | YES | null |
| updated_at | timestamp with time zone | YES | timezone('utc'::text, now()) |
| global_discount | numeric | YES | 0 |
| category_id | bigint | YES | null |
| original_amount | numeric | YES | null |
| currency | text | YES | 'ILS'::text |
| installments_info | text | YES | null |
| exchange_rate | numeric | YES | null |
| charge_date | date | NO | CURRENT_DATE |
| loan_id | bigint | YES | null |
| current_installment | integer | YES | null |
| payment_source_id | bigint | YES | null |
| notes | text | YES | null |
| installment_number | integer | YES | null |
| installment_count | integer | YES | null |
| parent_transaction_id | bigint | YES | null |

### Primary Key
- `id`

### Foreign Keys
- `category_id -> categories.id`
- `loan_id -> loans.id`
- `payment_source_id -> payment_sources.id`
- `parent_transaction_id -> transactions.id`

### Check Constraints
- `movement_type IN ('expense', 'income')`

### Indexes
- `transactions_pkey` UNIQUE on `(id)`
- `idx_transactions_loan_id` on `(loan_id)`
- `idx_transactions_payment_source_id` on `(payment_source_id)`

### Notes
- Contains installment-related fields:
  - `installments_info`
  - `current_installment`
  - `installment_number`
  - `installment_count`
  - `parent_transaction_id`
- `parent_transaction_id` is self-referential and likely intended for grouped/installment transactions.
- No DB-level check constraints were found for installment sequencing/count validity.
- No explicit index was found on `parent_transaction_id`.

---

## 16. whatsapp_pending_actions

### Columns
| column_name | data_type | nullable | default |
|---|---|---|---|
| id | bigint | NO | null |
| wa_id | text | NO | null |
| payload_json | jsonb | NO | null |
| created_at | timestamp with time zone | YES | now() |

### Primary Key
- `id`

### Indexes
- `whatsapp_pending_actions_pkey` UNIQUE on `(id)`
- `idx_pending_wa_id` on `(wa_id)`

---

## Cross-Table Relationship Summary

### Financial
- `budgets.category_id -> categories.id`
- `transactions.category_id -> categories.id`
- `transactions.loan_id -> loans.id`
- `transactions.payment_source_id -> payment_sources.id`
- `transactions.parent_transaction_id -> transactions.id`
- `transaction_items.transaction_id -> transactions.id`
- `lego_sets.transaction_id -> transactions.id`

### Shopping
- `shopping_lists.list_type_id -> shopping_list_types.id`
- `shopping_list_items.list_id -> shopping_lists.id`
- `shopping_list_items.catalog_item_id -> shopping_catalog_items.id`
- `shopping_list_items.category_id -> shopping_catalog_categories.id`
- `shopping_catalog_items.category_id -> shopping_catalog_categories.id`
- `shopping_catalog_category_list_types.category_id -> shopping_catalog_categories.id`
- `shopping_catalog_category_list_types.list_type_id -> shopping_list_types.id`
- `shopping_checkouts.list_id -> shopping_lists.id`

### Mapping / Automation
- `merchant_category_map.category_id -> categories.id`

---

## Important DB Observations

1. `transactions` already contains installment-related columns and a self-reference via `parent_transaction_id`.
2. No DB-level validation was found for installment count/order consistency.
3. `shopping_checkouts.list_id` is unique, which implies one checkout per shopping list.
4. `shopping_catalog_category_list_types` uses a composite primary key.
5. Several business rules are enforced via CHECK constraints, especially in shopping and classification tables.

---

## Source Notes

This snapshot was assembled from:
- information_schema.columns
- information_schema.table_constraints
- information_schema.key_column_usage
- information_schema.constraint_column_usage
- pg_constraint
- pg_indexes

It reflects the database structure only.
Application-level logic, validation, and API behavior must be verified separately in code.