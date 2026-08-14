-- Migration 013: model loan indexation independently from interest type.
-- Existing rows remain non-indexed; provider-specific corrections are separate data work.

ALTER TABLE public.loans
  ADD COLUMN indexation_type TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN base_index NUMERIC(18,4);

ALTER TABLE public.loans
  ADD CONSTRAINT loans_indexation_type_check
    CHECK (indexation_type IN ('none', 'cpi')),
  ADD CONSTRAINT loans_base_index_positive_check
    CHECK (base_index IS NULL OR base_index > 0);

COMMENT ON COLUMN public.loans.indexation_type IS
  'Principal indexation basis, independent from interest_type: none or cpi.';
COMMENT ON COLUMN public.loans.base_index IS
  'Optional provider-confirmed base index. NULL means the source value is unknown.';
