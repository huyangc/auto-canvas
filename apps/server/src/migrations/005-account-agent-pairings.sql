CREATE TABLE account_agent_pairings (
  pairing_id text PRIMARY KEY,
  session_hash bytea NOT NULL REFERENCES standalone_sessions(token_hash) ON DELETE CASCADE
);
CREATE INDEX account_agent_pairings_session ON account_agent_pairings(session_hash);
