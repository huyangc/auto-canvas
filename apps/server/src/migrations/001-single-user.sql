CREATE TABLE users (
  id text PRIMARY KEY,
  display_name text NOT NULL
);

CREATE TABLE cloud_projects (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision integer NOT NULL DEFAULT 1,
  schema_version integer NOT NULL,
  project_text text NOT NULL,
  preview_svg text NOT NULL DEFAULT '',
  gallery_entry_id text DEFAULT NULL,
  favorite boolean NOT NULL DEFAULT false
);
CREATE INDEX cloud_projects_user_updated ON cloud_projects(user_id, updated_at DESC);

CREATE TABLE cloud_project_versions (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES cloud_projects(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  name text NOT NULL,
  saved_at timestamptz NOT NULL,
  schema_version integer NOT NULL,
  project_text text NOT NULL,
  preview_svg text NOT NULL DEFAULT '',
  UNIQUE(project_id, revision)
);
