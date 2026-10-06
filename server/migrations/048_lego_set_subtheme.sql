-- Store the child theme name separately from the parent theme.
-- Existing records remain unchanged.
ALTER TABLE public.lego_sets
  ADD COLUMN IF NOT EXISTS subtheme TEXT;