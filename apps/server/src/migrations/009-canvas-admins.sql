ALTER TABLE users
  ADD COLUMN IF NOT EXISTS canvas_admin boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS preprovisioned boolean NOT NULL DEFAULT false;
