ALTER TABLE users
  ADD COLUMN first_seen_at timestamptz,
  ADD COLUMN last_active_at timestamptz,
  ADD COLUMN last_role text CHECK (last_role IN ('user', 'admin'));
ALTER TABLE users ALTER COLUMN first_seen_at SET DEFAULT now();
UPDATE users u SET first_seen_at = a.created_at, last_role = a.role
FROM standalone_accounts a WHERE u.id = a.user_id;

-- Activity survives account deletion so historical totals remain stable.
CREATE TABLE usage_daily_user_actions (
  day date NOT NULL,
  mode text NOT NULL CHECK (mode IN ('accounts', 'notebook', 'local')),
  user_id text NOT NULL,
  action text NOT NULL,
  ok_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (day, mode, user_id, action)
);
CREATE INDEX usage_daily_user_actions_mode_user_day
  ON usage_daily_user_actions (mode, user_id, day DESC);
