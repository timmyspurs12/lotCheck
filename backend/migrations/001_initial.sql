CREATE TABLE IF NOT EXISTS sites (
  id uuid PRIMARY KEY,
  site_code varchar(100) NOT NULL UNIQUE,
  name varchar(240) NOT NULL,
  location varchar(240),
  current_status varchar(40),
  created_by varchar(255) NOT NULL,
  source varchar(32) NOT NULL DEFAULT 'API' CHECK (source IN ('API','REVIEWER_SUPPLIED')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reviews (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  milestone varchar(500) NOT NULL,
  claim_source_reference varchar(240),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  supersedes_review_id uuid UNIQUE REFERENCES reviews(id) ON DELETE RESTRICT,
  status varchar(32) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','EVIDENCE_READY','COMPARISON_READY','SUBMITTING','SUBMITTED','CONSENSUS_PENDING','FINALIZING','FINALIZED','FAILED')),
  decision varchar(16) CHECK (decision IS NULL OR decision IN ('ACCEPT','DISPUTED','INSUFFICIENT')),
  decision_explanation varchar(500),
  reason_code varchar(80),
  policy_version varchar(100) NOT NULL,
  created_by varchar(255) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  finalized_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  precheck_result jsonb,
  genlayer_contract varchar(42),
  genlayer_network varchar(100),
  transaction_hash varchar(66),
  transaction_url text,
  consensus_state varchar(40),
  transaction_status varchar(40),
  block_reference jsonb,
  evidence_package_hash varchar(64),
  record_id uuid UNIQUE,
  error_code varchar(100),
  error_message varchar(1000),
  CHECK (evidence_package_hash IS NULL OR evidence_package_hash ~ '^[a-f0-9]{64}$'),
  CHECK (transaction_hash IS NULL OR transaction_hash ~ '^0x[a-fA-F0-9]{64}$'),
  CHECK ((status <> 'FINALIZED') OR (decision IS NOT NULL AND record_id IS NOT NULL AND finalized_at IS NOT NULL)),
  CHECK ((decision IS NULL) OR status = 'FINALIZED'),
  CHECK ((status IN ('DRAFT','EVIDENCE_READY','COMPARISON_READY') AND submitted_at IS NULL) OR (status NOT IN ('DRAFT','EVIDENCE_READY','COMPARISON_READY') AND submitted_at IS NOT NULL)),
  CHECK ((status <> 'FAILED') OR (error_code IS NOT NULL AND error_message IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS reviews_site_created_idx ON reviews(site_id, created_at DESC);
CREATE INDEX IF NOT EXISTS reviews_status_updated_idx ON reviews(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS reviews_record_id_idx ON reviews(record_id) WHERE record_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY,
  review_id uuid NOT NULL REFERENCES reviews(id) ON DELETE RESTRICT,
  role varchar(32) NOT NULL CHECK (role IN ('PROJECT_CLOSEOUT','INDEPENDENT_EVIDENCE')),
  filename varchar(255) NOT NULL,
  mime_type varchar(120) NOT NULL CHECK (mime_type IN ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain','text/csv','application/json')),
  size bigint NOT NULL CHECK (size > 0),
  sha256 varchar(64) NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  source text,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  uploaded_by varchar(255) NOT NULL,
  processing_status varchar(16) NOT NULL CHECK (processing_status IN ('READY','FAILED')),
  processing_error_code varchar(100),
  processing_error text,
  storage_reference varchar(80) NOT NULL UNIQUE,
  UNIQUE (review_id, role)
);

CREATE INDEX IF NOT EXISTS documents_review_idx ON documents(review_id, uploaded_at);
CREATE INDEX IF NOT EXISTS documents_sha256_idx ON documents(sha256);

CREATE TABLE IF NOT EXISTS evidence_fields (
  id uuid PRIMARY KEY,
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE RESTRICT,
  field_name varchar(100) NOT NULL,
  field_value text,
  confidence numeric(5,4),
  extraction_source varchar(80) NOT NULL,
  UNIQUE (document_id, field_name),
  CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1))
);

CREATE TABLE IF NOT EXISTS comparisons (
  id uuid PRIMARY KEY,
  review_id uuid NOT NULL REFERENCES reviews(id) ON DELETE RESTRICT,
  field_name varchar(100) NOT NULL,
  project_value text,
  independent_value text,
  match_state varchar(24) NOT NULL CHECK (match_state IN ('EXACT_MATCH','PARTIAL_MATCH','CONFLICT','MISSING','NOT_COMPARABLE')),
  explanation varchar(500),
  compared_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (review_id, field_name)
);

CREATE INDEX IF NOT EXISTS comparisons_review_idx ON comparisons(review_id, field_name);

CREATE TABLE IF NOT EXISTS decisions (
  id uuid PRIMARY KEY,
  review_id uuid NOT NULL UNIQUE REFERENCES reviews(id) ON DELETE RESTRICT,
  decision varchar(16) NOT NULL CHECK (decision IN ('ACCEPT','DISPUTED','INSUFFICIENT')),
  summary varchar(500) NOT NULL,
  reason_code varchar(80) NOT NULL,
  policy_version varchar(100) NOT NULL,
  evidence_package_hash varchar(64) NOT NULL CHECK (evidence_package_hash ~ '^[a-f0-9]{64}$'),
  project_document_hash varchar(64) CHECK (project_document_hash IS NULL OR project_document_hash ~ '^[a-f0-9]{64}$'),
  independent_document_hash varchar(64) CHECK (independent_document_hash IS NULL OR independent_document_hash ~ '^[a-f0-9]{64}$'),
  material_conflicts jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_references jsonb NOT NULL DEFAULT '[]'::jsonb,
  decision_source varchar(32) NOT NULL CHECK (decision_source IN ('GENLAYER_INTERPRETATION','DETERMINISTIC_PRECHECK')),
  contract_address varchar(42) NOT NULL,
  network varchar(100) NOT NULL,
  transaction_hash varchar(66) NOT NULL CHECK (transaction_hash ~ '^0x[a-fA-F0-9]{64}$'),
  block_reference jsonb,
  onchain_record_id uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL,
  created_by varchar(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY,
  review_id uuid NOT NULL REFERENCES reviews(id) ON DELETE RESTRICT,
  event_type varchar(80) NOT NULL,
  actor varchar(255) NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS audit_events_review_time_idx ON audit_events(review_id, occurred_at, id);

CREATE TABLE IF NOT EXISTS genlayer_jobs (
  id uuid PRIMARY KEY,
  review_id uuid NOT NULL UNIQUE REFERENCES reviews(id) ON DELETE RESTRICT,
  idempotency_key varchar(200) NOT NULL UNIQUE,
  action varchar(32) NOT NULL CHECK (action = 'INTERPRET'),
  status varchar(16) NOT NULL CHECK (status IN ('QUEUED','RUNNING','WAITING','DONE','FAILED')),
  request_hash varchar(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  package_json text NOT NULL,
  evidence_package_hash varchar(64) NOT NULL CHECK (evidence_package_hash ~ '^[a-f0-9]{64}$'),
  reason_code varchar(80),
  transaction_hash varchar(66),
  attempts integer NOT NULL DEFAULT 0,
  poll_errors integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  last_error_code varchar(100),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (transaction_hash IS NULL OR transaction_hash ~ '^0x[a-fA-F0-9]{64}$')
);

CREATE INDEX IF NOT EXISTS genlayer_jobs_queue_idx ON genlayer_jobs(status, available_at, created_at);

CREATE TABLE IF NOT EXISTS service_heartbeats (
  service_name varchar(80) PRIMARY KEY,
  last_seen_at timestamptz NOT NULL,
  detail varchar(300)
);

CREATE OR REPLACE FUNCTION lotcheck_reject_immutable_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS documents_immutable ON documents;
CREATE TRIGGER documents_immutable BEFORE UPDATE OR DELETE ON documents FOR EACH ROW EXECUTE FUNCTION lotcheck_reject_immutable_mutation();
DROP TRIGGER IF EXISTS evidence_fields_immutable ON evidence_fields;
CREATE TRIGGER evidence_fields_immutable BEFORE UPDATE OR DELETE ON evidence_fields FOR EACH ROW EXECUTE FUNCTION lotcheck_reject_immutable_mutation();
DROP TRIGGER IF EXISTS decisions_immutable ON decisions;
CREATE TRIGGER decisions_immutable BEFORE UPDATE OR DELETE ON decisions FOR EACH ROW EXECUTE FUNCTION lotcheck_reject_immutable_mutation();
DROP TRIGGER IF EXISTS audit_events_immutable ON audit_events;
CREATE TRIGGER audit_events_immutable BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION lotcheck_reject_immutable_mutation();

CREATE OR REPLACE FUNCTION lotcheck_guard_site_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'site registry rows cannot be deleted' USING ERRCODE = '55000'; END IF;
  IF OLD.id IS DISTINCT FROM NEW.id OR OLD.site_code IS DISTINCT FROM NEW.site_code OR OLD.name IS DISTINCT FROM NEW.name OR OLD.location IS DISTINCT FROM NEW.location OR OLD.created_by IS DISTINCT FROM NEW.created_by OR OLD.source IS DISTINCT FROM NEW.source OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'site identity and provenance are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS sites_identity_guard ON sites;
CREATE TRIGGER sites_identity_guard BEFORE UPDATE OR DELETE ON sites FOR EACH ROW EXECUTE FUNCTION lotcheck_guard_site_identity();

CREATE OR REPLACE FUNCTION lotcheck_guard_genlayer_job() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE allowed boolean := false;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'GenLayer job provenance cannot be deleted' USING ERRCODE = '55000'; END IF;
  IF OLD.id IS DISTINCT FROM NEW.id OR OLD.review_id IS DISTINCT FROM NEW.review_id OR OLD.idempotency_key IS DISTINCT FROM NEW.idempotency_key OR OLD.action IS DISTINCT FROM NEW.action OR OLD.request_hash IS DISTINCT FROM NEW.request_hash OR OLD.package_json IS DISTINCT FROM NEW.package_json OR OLD.evidence_package_hash IS DISTINCT FROM NEW.evidence_package_hash OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'GenLayer job package and idempotency provenance are immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.transaction_hash IS NOT NULL AND NEW.transaction_hash IS DISTINCT FROM OLD.transaction_hash THEN
    RAISE EXCEPTION 'GenLayer job transaction hash is immutable once recorded' USING ERRCODE = '55000';
  END IF;
  IF NEW.attempts < OLD.attempts OR NEW.poll_errors < OLD.poll_errors THEN
    RAISE EXCEPTION 'GenLayer job attempt counters cannot decrease' USING ERRCODE = '55000';
  END IF;
  IF NEW.status <> OLD.status THEN
    allowed := CASE OLD.status
      WHEN 'QUEUED' THEN NEW.status IN ('RUNNING','FAILED')
      WHEN 'WAITING' THEN NEW.status IN ('RUNNING','DONE','FAILED')
      WHEN 'RUNNING' THEN NEW.status IN ('WAITING','DONE','FAILED')
      ELSE false
    END;
    IF NOT allowed THEN RAISE EXCEPTION 'invalid GenLayer job state transition: % -> %', OLD.status, NEW.status USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS genlayer_job_guard ON genlayer_jobs;
CREATE TRIGGER genlayer_job_guard BEFORE UPDATE OR DELETE ON genlayer_jobs FOR EACH ROW EXECUTE FUNCTION lotcheck_guard_genlayer_job();

CREATE OR REPLACE FUNCTION lotcheck_guard_comparisons() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_review uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN target_review := OLD.review_id; ELSE target_review := NEW.review_id; END IF;
  IF EXISTS (SELECT 1 FROM reviews WHERE id = target_review AND submitted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'comparisons cannot change after submission begins' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
DROP TRIGGER IF EXISTS comparisons_locked_after_submit ON comparisons;
CREATE TRIGGER comparisons_locked_after_submit BEFORE INSERT OR UPDATE OR DELETE ON comparisons FOR EACH ROW EXECUTE FUNCTION lotcheck_guard_comparisons();

CREATE OR REPLACE FUNCTION lotcheck_guard_review_state() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE allowed boolean := false;
DECLARE ready_roles integer := 0;
DECLARE comparison_count integer := 0;
BEGIN
  IF NEW.status <> OLD.status THEN
    allowed := CASE OLD.status
      WHEN 'DRAFT' THEN NEW.status IN ('EVIDENCE_READY')
      WHEN 'EVIDENCE_READY' THEN NEW.status IN ('COMPARISON_READY')
      WHEN 'COMPARISON_READY' THEN NEW.status IN ('SUBMITTING')
      WHEN 'SUBMITTING' THEN NEW.status IN ('SUBMITTED','CONSENSUS_PENDING','FINALIZING','FINALIZED','FAILED')
      WHEN 'SUBMITTED' THEN NEW.status IN ('CONSENSUS_PENDING','FINALIZING','FINALIZED','FAILED')
      WHEN 'CONSENSUS_PENDING' THEN NEW.status IN ('FINALIZING','FINALIZED','FAILED')
      WHEN 'FINALIZING' THEN NEW.status IN ('FINALIZED','FAILED')
      ELSE false
    END;
    IF NOT allowed THEN RAISE EXCEPTION 'invalid review status transition: % -> %', OLD.status, NEW.status USING ERRCODE = '23514'; END IF;
  END IF;
  IF OLD.site_id IS DISTINCT FROM NEW.site_id OR OLD.milestone IS DISTINCT FROM NEW.milestone OR OLD.claim_source_reference IS DISTINCT FROM NEW.claim_source_reference OR OLD.version IS DISTINCT FROM NEW.version OR OLD.supersedes_review_id IS DISTINCT FROM NEW.supersedes_review_id OR OLD.policy_version IS DISTINCT FROM NEW.policy_version OR OLD.created_by IS DISTINCT FROM NEW.created_by OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'review claim, site, version, policy, and creator fields are immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.decision IS NOT NULL AND (NEW.decision IS DISTINCT FROM OLD.decision OR NEW.decision_explanation IS DISTINCT FROM OLD.decision_explanation OR NEW.reason_code IS DISTINCT FROM OLD.reason_code) THEN
    RAISE EXCEPTION 'recorded review decision is immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.submitted_at IS NOT NULL AND NEW.submitted_at IS DISTINCT FROM OLD.submitted_at THEN
    RAISE EXCEPTION 'submission timestamp is immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.finalized_at IS NOT NULL AND NEW.finalized_at IS DISTINCT FROM OLD.finalized_at THEN
    RAISE EXCEPTION 'finalization timestamp is immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.record_id IS NOT NULL AND NEW.record_id IS DISTINCT FROM OLD.record_id THEN
    RAISE EXCEPTION 'on-chain record reference is immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.evidence_package_hash IS NOT NULL AND NEW.evidence_package_hash IS DISTINCT FROM OLD.evidence_package_hash THEN
    RAISE EXCEPTION 'submitted evidence package hash is immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.transaction_hash IS NOT NULL AND NEW.transaction_hash IS DISTINCT FROM OLD.transaction_hash THEN
    RAISE EXCEPTION 'GenLayer transaction hash is immutable once recorded' USING ERRCODE = '55000';
  END IF;
  IF OLD.genlayer_contract IS NOT NULL AND NEW.genlayer_contract IS DISTINCT FROM OLD.genlayer_contract THEN
    RAISE EXCEPTION 'GenLayer contract address is immutable after submission' USING ERRCODE = '55000';
  END IF;
  IF OLD.genlayer_network IS NOT NULL AND NEW.genlayer_network IS DISTINCT FROM OLD.genlayer_network THEN
    RAISE EXCEPTION 'GenLayer network is immutable after submission' USING ERRCODE = '55000';
  END IF;
  IF NEW.status = 'SUBMITTING' AND OLD.status <> 'SUBMITTING' THEN
    SELECT count(DISTINCT role) INTO ready_roles FROM documents WHERE review_id=NEW.id AND processing_status='READY';
    SELECT count(*) INTO comparison_count FROM comparisons WHERE review_id=NEW.id;
    IF ready_roles <> 2 OR comparison_count = 0 OR NEW.submitted_at IS NULL OR NEW.evidence_package_hash IS NULL OR NEW.genlayer_contract IS NULL OR NEW.genlayer_network IS NULL THEN
      RAISE EXCEPTION 'submission requires two ready evidence roles, a persisted comparison, package hash, contract, network, and server timestamp' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.status IN ('SUBMITTED','CONSENSUS_PENDING','FINALIZING','FINALIZED') AND NEW.transaction_hash IS NULL THEN
    RAISE EXCEPTION 'on-chain lifecycle state requires a real GenLayer transaction hash' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'FINALIZED' AND (NEW.decision IS NULL OR NEW.record_id IS NULL OR NEW.finalized_at IS NULL OR NEW.transaction_status <> 'FINALIZED') THEN
    RAISE EXCEPTION 'FINALIZED reviews require verified execution, a recorded decision, timestamp, and on-chain record' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS reviews_state_guard ON reviews;
CREATE TRIGGER reviews_state_guard BEFORE UPDATE ON reviews FOR EACH ROW EXECUTE FUNCTION lotcheck_guard_review_state();

CREATE OR REPLACE FUNCTION lotcheck_touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS reviews_touch_updated_at ON reviews;
CREATE TRIGGER reviews_touch_updated_at BEFORE UPDATE ON reviews FOR EACH ROW EXECUTE FUNCTION lotcheck_touch_updated_at();
DROP TRIGGER IF EXISTS genlayer_jobs_touch_updated_at ON genlayer_jobs;
CREATE TRIGGER genlayer_jobs_touch_updated_at BEFORE UPDATE ON genlayer_jobs FOR EACH ROW EXECUTE FUNCTION lotcheck_touch_updated_at();
