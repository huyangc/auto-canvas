CREATE TABLE standalone_accounts (
  username text PRIMARY KEY CHECK (username ~ '^[a-z][0-9]{8}$'),
  user_id text NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  salt bytea NOT NULL,
  password_hash bytea NOT NULL
);

CREATE TABLE standalone_sessions (
  token_hash bytea PRIMARY KEY,
  user_id text NOT NULL REFERENCES standalone_accounts(user_id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX standalone_sessions_expiry ON standalone_sessions(expires_at);
