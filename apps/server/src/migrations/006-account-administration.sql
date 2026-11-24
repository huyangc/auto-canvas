ALTER TABLE standalone_accounts
  ADD COLUMN role text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  ADD COLUMN disabled boolean NOT NULL DEFAULT false,
  ADD COLUMN must_change_password boolean NOT NULL DEFAULT false,
  -- Incremented whenever an account's credentials stop being valid (disable,
  -- reset, deletion, own password change); a sign-in verified earlier fails.
  ADD COLUMN credentials_version integer NOT NULL DEFAULT 0,
  ADD COLUMN created_at timestamptz;

-- Set after the column exists, so accounts registered before this migration
-- keep a null (unknown) registration time.
ALTER TABLE standalone_accounts ALTER COLUMN created_at SET DEFAULT now();
