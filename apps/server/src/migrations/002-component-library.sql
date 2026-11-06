-- Match SQLite BINARY ordering and ASCII lower() across database locales.
CREATE TABLE components (
  id text COLLATE "C" PRIMARY KEY, revision integer NOT NULL, author_id text COLLATE "C" NOT NULL,
  author text COLLATE "C" NOT NULL, status text COLLATE "C" NOT NULL CHECK (status IN ('shared','official','deleted')),
  created_at text COLLATE "C" NOT NULL, updated_at text COLLATE "C" NOT NULL, name text COLLATE "C" NOT NULL,
  definition text COLLATE "C" NOT NULL
);
CREATE INDEX components_status_id ON components(status, id);
CREATE INDEX components_author_id ON components(author_id, id);
CREATE TABLE component_write_receipts (
  user_id text COLLATE "C" NOT NULL, request_key text COLLATE "C" NOT NULL, component_id text COLLATE "C" NOT NULL,
  request_digest text COLLATE "C" NOT NULL, response_json text COLLATE "C" NOT NULL, created_at text COLLATE "C" NOT NULL,
  PRIMARY KEY(user_id, request_key)
);
CREATE INDEX component_receipts_expiry ON component_write_receipts(created_at);
CREATE TABLE component_lifecycle (
  component_id text COLLATE "C" PRIMARY KEY REFERENCES components(id) ON DELETE CASCADE,
  deleted_by text COLLATE "C" NOT NULL, previous_status text COLLATE "C" NOT NULL, actor text COLLATE "C" NOT NULL,
  action text COLLATE "C" NOT NULL, from_revision integer NOT NULL, to_revision integer NOT NULL
);
CREATE TABLE component_content_index (
  component_id text COLLATE "C" PRIMARY KEY REFERENCES components(id) ON DELETE CASCADE,
  revision integer NOT NULL, version integer NOT NULL,
  digest text COLLATE "C", content text COLLATE "C", diagnostic text COLLATE "C"
);
CREATE INDEX component_content_digest ON component_content_index(version, digest);
CREATE TABLE component_content_progress (
  version integer PRIMARY KEY, complete integer NOT NULL, processed integer NOT NULL
);
CREATE TABLE component_catalog (
  id text COLLATE "C" PRIMARY KEY REFERENCES components(id) ON DELETE CASCADE,
  rank integer NOT NULL, capability text COLLATE "C" NOT NULL, author_id text COLLATE "C" NOT NULL,
  author text COLLATE "C" NOT NULL, status text COLLATE "C" NOT NULL, created_at text COLLATE "C" NOT NULL,
  name text COLLATE "C" NOT NULL, summary text COLLATE "C" NOT NULL
);
CREATE INDEX component_catalog_order ON component_catalog(status, rank, created_at, id);
CREATE INDEX component_catalog_author ON component_catalog(author_id, created_at, id);
CREATE TABLE component_catalog_state (id integer PRIMARY KEY, revision integer NOT NULL);
INSERT INTO component_catalog_state VALUES (1, 0);
CREATE FUNCTION invalidate_component_catalog() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM component_catalog WHERE id = OLD.id;
  ELSE
    DELETE FROM component_catalog WHERE id = NEW.id;
  END IF;
  UPDATE component_catalog_state SET revision = revision + 1 WHERE id = 1;
  RETURN NULL;
END;
$$;
CREATE TRIGGER component_catalog_change AFTER INSERT OR UPDATE OR DELETE ON components
  FOR EACH ROW EXECUTE FUNCTION invalidate_component_catalog();
