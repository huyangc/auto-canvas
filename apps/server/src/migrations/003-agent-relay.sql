CREATE TABLE agent_relay_storage (
  object_name text NOT NULL,
  key text NOT NULL,
  value bytea NOT NULL,
  PRIMARY KEY (object_name, key)
);

CREATE TABLE agent_relay_alarms (
  object_name text PRIMARY KEY,
  scheduled_time bigint NOT NULL
);
