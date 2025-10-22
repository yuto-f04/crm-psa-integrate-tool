CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TYPE role_type AS ENUM ('EXEC', 'PM', 'DEV', 'QA', 'CS', 'FIN', 'CLIENT');
CREATE TYPE meeting_status AS ENUM ('CAPTURED', 'ROUTED', 'APPROVED', 'FINALIZED');
CREATE TYPE doc_status AS ENUM ('DRAFT', 'REVIEW', 'APPROVED', 'ARCHIVED');
CREATE TYPE action_status AS ENUM ('PROPOSED', 'APPROVED', 'DONE', 'BLOCKED');
CREATE TYPE issue_status AS ENUM ('BACKLOG', 'IN_PROGRESS', 'REVIEW', 'DONE');
CREATE TYPE outbox_status AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'DEAD_LETTER');
CREATE TYPE integration_type AS ENUM ('SLACK', 'DRIVE', 'TLDV', 'MF', 'GITHUB');

CREATE TABLE orgs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  locale TEXT DEFAULT 'ja-JP',
  hashed_password TEXT NOT NULL,
  avatar_url TEXT,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, email)
);

CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role role_type NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, user_id, role)
);

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  refresh_token TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE TABLE audit_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES users(id),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE meetings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  agenda TEXT,
  scheduled_at TIMESTAMPTZ,
  recorded_url TEXT,
  tldv_external_id TEXT UNIQUE,
  docs_link TEXT,
  status meeting_status NOT NULL DEFAULT 'CAPTURED',
  routed_client TEXT,
  routed_project TEXT,
  routed_confidence NUMERIC(5,4),
  routed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE docs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  meeting_id UUID REFERENCES meetings(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  drive_file_id TEXT,
  drive_folder_id TEXT,
  status doc_status NOT NULL DEFAULT 'DRAFT',
  approval_state TEXT NOT NULL DEFAULT 'pending',
  approver_id UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  template_version TEXT,
  summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE meetings
  ADD CONSTRAINT meetings_doc_id_unique UNIQUE (org_id, id);

ALTER TABLE docs
  ADD CONSTRAINT docs_meeting_unique UNIQUE (meeting_id);

CREATE TABLE decisions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  doc_id UUID NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  confidence NUMERIC(5,4) NOT NULL DEFAULT 0,
  requires_review BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE assumptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  doc_id UUID NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  confidence NUMERIC(5,4) NOT NULL DEFAULT 0,
  requires_review BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE risks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  doc_id UUID NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  confidence NUMERIC(5,4) NOT NULL DEFAULT 0,
  severity TEXT,
  requires_review BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE actions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  doc_id UUID NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  owner_id UUID REFERENCES users(id),
  due_date TIMESTAMPTZ,
  confidence NUMERIC(5,4) NOT NULL DEFAULT 0,
  status action_status NOT NULL DEFAULT 'PROPOSED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE issues (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  project_id TEXT,
  action_id UUID UNIQUE REFERENCES actions(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  status issue_status NOT NULL DEFAULT 'BACKLOG',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  board_history JSONB NOT NULL DEFAULT '{}'::JSONB
);

CREATE TABLE outbox (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status outbox_status NOT NULL DEFAULT 'PENDING',
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error TEXT
);

CREATE TABLE settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, key)
);

CREATE TABLE integrations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  type integration_type NOT NULL,
  status TEXT NOT NULL DEFAULT 'disconnected',
  data JSONB,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, type)
);

CREATE TABLE undo_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  initiator_id UUID REFERENCES users(id),
  target_table TEXT NOT NULL,
  target_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reversed_at TIMESTAMPTZ
);

CREATE INDEX idx_meetings_org_status ON meetings(org_id, status);
CREATE INDEX idx_docs_org_status ON docs(org_id, status);
CREATE INDEX idx_actions_org_status ON actions(org_id, status);
CREATE INDEX idx_issues_org_status ON issues(org_id, status);
CREATE INDEX idx_outbox_next_run ON outbox(org_id, status, next_run_at);
CREATE INDEX idx_undo_events_expires ON undo_events(org_id, expires_at);

CREATE OR REPLACE FUNCTION enforce_org_id()
RETURNS TRIGGER AS $$
DECLARE
  current_org UUID;
BEGIN
  current_org := NULLIF(current_setting('app.org_id', true), '')::UUID;
  IF current_org IS NULL THEN
    RAISE EXCEPTION 'app.org_id is not set';
  END IF;
  NEW.org_id := current_org;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers
DO $$
DECLARE
  tbl RECORD;
BEGIN
  FOR tbl IN
    SELECT table_name
    FROM information_schema.columns
    WHERE column_name = 'updated_at'
      AND table_schema = 'public'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at_on_%I ON %I', tbl.table_name, tbl.table_name);
    EXECUTE format('CREATE TRIGGER set_updated_at_on_%I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE PROCEDURE set_updated_at()', tbl.table_name, tbl.table_name);
  END LOOP;
END;
$$;

-- Helper to enable RLS for all tables with org_id
DO $$
DECLARE
  tbl RECORD;
BEGIN
  FOR tbl IN
    SELECT table_name
    FROM information_schema.columns
    WHERE column_name = 'org_id'
      AND table_schema = 'public'
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl.table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I_rls ON %I', tbl.table_name, tbl.table_name);
    EXECUTE format(
      'CREATE POLICY %I_rls ON %I USING (org_id = NULLIF(current_setting(''app.org_id'', true), '''')::uuid) WITH CHECK (org_id = NULLIF(current_setting(''app.org_id'', true), '''')::uuid)',
      tbl.table_name,
      tbl.table_name
    );
  END LOOP;
END;
$$;

ALTER TABLE orgs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS orgs_rls ON orgs;
CREATE POLICY orgs_rls ON orgs
  USING (id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('app.org_id', true), '')::uuid);
