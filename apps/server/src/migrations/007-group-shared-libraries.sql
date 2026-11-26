CREATE TABLE group_projects (
  id text PRIMARY KEY,
  group_id text NOT NULL,
  author_id text NOT NULL REFERENCES users(id),
  author_name text NOT NULL,
  source_project_id text,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  schema_version integer NOT NULL,
  project_text text NOT NULL,
  preview_svg text NOT NULL DEFAULT '',
  reviewer_id text REFERENCES users(id),
  reviewer_name text,
  review_note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);
CREATE INDEX group_projects_group_status_updated
  ON group_projects(group_id, status, updated_at DESC, id DESC);
CREATE INDEX group_projects_author_updated
  ON group_projects(author_id, updated_at DESC, id DESC);

CREATE TABLE group_components (
  id text PRIMARY KEY,
  group_id text NOT NULL,
  author_id text NOT NULL REFERENCES users(id),
  author_name text NOT NULL,
  source_component_id text,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  definition text NOT NULL,
  capability text NOT NULL DEFAULT 'symbol-only',
  reviewer_id text REFERENCES users(id),
  reviewer_name text,
  review_note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);
CREATE INDEX group_components_group_status_updated
  ON group_components(group_id, status, updated_at DESC, id DESC);
CREATE INDEX group_components_author_updated
  ON group_components(author_id, updated_at DESC, id DESC);

CREATE TABLE notebook_projects (
  id text PRIMARY KEY,
  notebook_id text NOT NULL,
  author_id text NOT NULL REFERENCES users(id),
  author_name text NOT NULL,
  source_project_id text,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  schema_version integer NOT NULL,
  project_text text NOT NULL,
  preview_svg text NOT NULL DEFAULT '',
  reviewer_id text REFERENCES users(id),
  reviewer_name text,
  review_note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);
CREATE INDEX notebook_projects_nb_status_updated
  ON notebook_projects(notebook_id, status, updated_at DESC, id DESC);
CREATE INDEX notebook_projects_author_updated
  ON notebook_projects(author_id, updated_at DESC, id DESC);

CREATE TABLE notebook_components (
  id text PRIMARY KEY,
  notebook_id text NOT NULL,
  author_id text NOT NULL REFERENCES users(id),
  author_name text NOT NULL,
  source_component_id text,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  definition text NOT NULL,
  capability text NOT NULL DEFAULT 'symbol-only',
  reviewer_id text REFERENCES users(id),
  reviewer_name text,
  review_note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);
CREATE INDEX notebook_components_nb_status_updated
  ON notebook_components(notebook_id, status, updated_at DESC, id DESC);
CREATE INDEX notebook_components_author_updated
  ON notebook_components(author_id, updated_at DESC, id DESC);
