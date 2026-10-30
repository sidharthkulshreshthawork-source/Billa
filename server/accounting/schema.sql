-- Accounting v1: independent SQLite store; NEVER migrate legacy JSON implicitly.
CREATE TABLE IF NOT EXISTS businesses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(trim(name)) > 0),
  country TEXT NOT NULL DEFAULT 'IN',
  seller_state TEXT,
  gstin TEXT,
  is_gst_registered INTEGER NOT NULL DEFAULT 0 CHECK(is_gst_registered IN (0,1)),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS local_users (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  kdf_params_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (business_id)
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  owner_id TEXT NOT NULL REFERENCES local_users(id),
  token_hash TEXT NOT NULL UNIQUE,
  csrf_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  CHECK (expires_at > created_at)
);
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  account_code TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('asset','liability','equity','income','expense')),
  normal_balance TEXT NOT NULL CHECK(normal_balance IN ('debit','credit')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  UNIQUE (business_id, account_code),
  UNIQUE (id, business_id)
);
CREATE TABLE IF NOT EXISTS invoice_drafts (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  owner_id TEXT NOT NULL REFERENCES local_users(id),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  input_json TEXT NOT NULL,
  preview_json TEXT,
  digest TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(id, business_id)
);
CREATE TABLE IF NOT EXISTS posted_invoices (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  draft_id TEXT NOT NULL UNIQUE REFERENCES invoice_drafts(id),
  financial_year TEXT NOT NULL,
  document_type TEXT NOT NULL,
  invoice_number TEXT NOT NULL,
  invoice_date TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR' CHECK (currency='INR'),
  taxable_paise INTEGER NOT NULL CHECK(taxable_paise >= 0),
  cgst_paise INTEGER NOT NULL DEFAULT 0 CHECK(cgst_paise >= 0),
  sgst_paise INTEGER NOT NULL DEFAULT 0 CHECK(sgst_paise >= 0),
  igst_paise INTEGER NOT NULL DEFAULT 0 CHECK(igst_paise >= 0),
  utgst_paise INTEGER NOT NULL DEFAULT 0 CHECK(utgst_paise >= 0),
  cess_paise INTEGER NOT NULL DEFAULT 0 CHECK(cess_paise >= 0),
  total_paise INTEGER NOT NULL CHECK(total_paise > 0),
  payload_json TEXT NOT NULL,
  posted_at TEXT NOT NULL,
  UNIQUE(business_id, financial_year, document_type, invoice_number),
  UNIQUE(id, business_id)
);
CREATE TABLE IF NOT EXISTS journal_entries (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  entry_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  finalized INTEGER NOT NULL DEFAULT 0 CHECK(finalized IN (0,1)),
  UNIQUE(business_id,source_type,source_id),
  UNIQUE(id,business_id)
);
CREATE TABLE IF NOT EXISTS journal_lines (
  entry_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  line_no INTEGER NOT NULL CHECK(line_no >= 1),
  account_id TEXT NOT NULL,
  debit_paise INTEGER NOT NULL DEFAULT 0 CHECK (debit_paise >= 0),
  credit_paise INTEGER NOT NULL DEFAULT 0 CHECK (credit_paise >= 0),
  PRIMARY KEY (entry_id,line_no),
  FOREIGN KEY (entry_id,business_id) REFERENCES journal_entries(id,business_id),
  FOREIGN KEY (account_id,business_id) REFERENCES accounts(id,business_id),
  CHECK ((debit_paise > 0 AND credit_paise = 0) OR (debit_paise = 0 AND credit_paise > 0))
);
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  actor_id TEXT NOT NULL REFERENCES local_users(id),
  draft_id TEXT NOT NULL REFERENCES invoice_drafts(id),
  revision INTEGER NOT NULL,
  digest TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  revoked_at INTEGER,
  CHECK(expires_at > issued_at)
);
CREATE TABLE IF NOT EXISTS idempotency_records (
  business_id TEXT NOT NULL REFERENCES businesses(id),
  operation_id TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(business_id,operation_id)
);
CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  actor_id TEXT,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_journal_lines_business_account ON journal_lines(business_id,account_id);
CREATE INDEX IF NOT EXISTS idx_posted_invoice_business_date ON posted_invoices(business_id,invoice_date);
CREATE INDEX IF NOT EXISTS idx_sessions_owner_expiry ON sessions(owner_id,expires_at);

-- Database invariant: a journal cannot become finalized unless it has at least
-- two independently valid lines and a strictly positive, balanced amount.
-- This is a final defence even when a caller bypasses the accounting service.
CREATE TRIGGER IF NOT EXISTS journal_balance_before_finalization
BEFORE UPDATE OF finalized ON journal_entries
WHEN OLD.finalized = 0 AND NEW.finalized = 1
  AND (
    (SELECT COUNT(*) FROM journal_lines WHERE entry_id = NEW.id) < 2 OR
    COALESCE((SELECT SUM(debit_paise) FROM journal_lines WHERE entry_id = NEW.id), 0) <= 0 OR
    COALESCE((SELECT SUM(debit_paise) - SUM(credit_paise) FROM journal_lines WHERE entry_id = NEW.id), 0) <> 0
  )
BEGIN SELECT RAISE(ABORT, 'unbalanced journal cannot be finalized'); END;

-- Once an entry is finalized, neither its header nor lines may be modified.
CREATE TRIGGER IF NOT EXISTS finalized_entry_no_update
BEFORE UPDATE ON journal_entries WHEN OLD.finalized = 1
BEGIN SELECT RAISE(ABORT, 'finalized journal is immutable'); END;
CREATE TRIGGER IF NOT EXISTS finalized_entry_no_delete
BEFORE DELETE ON journal_entries WHEN OLD.finalized = 1
BEGIN SELECT RAISE(ABORT, 'finalized journal is immutable'); END;
CREATE TRIGGER IF NOT EXISTS finalized_line_no_update
BEFORE UPDATE ON journal_lines WHEN EXISTS(SELECT 1 FROM journal_entries e WHERE e.id = OLD.entry_id AND e.finalized = 1)
BEGIN SELECT RAISE(ABORT, 'finalized journal lines are immutable'); END;
CREATE TRIGGER IF NOT EXISTS finalized_line_no_delete
BEFORE DELETE ON journal_lines WHEN EXISTS(SELECT 1 FROM journal_entries e WHERE e.id = OLD.entry_id AND e.finalized = 1)
BEGIN SELECT RAISE(ABORT, 'finalized journal lines are immutable'); END;
CREATE TRIGGER IF NOT EXISTS finalized_line_no_insert
BEFORE INSERT ON journal_lines WHEN EXISTS(SELECT 1 FROM journal_entries e WHERE e.id = NEW.entry_id AND e.finalized = 1)
BEGIN SELECT RAISE(ABORT, 'finalized journal lines are immutable'); END;
CREATE TRIGGER IF NOT EXISTS posted_invoice_no_update
BEFORE UPDATE ON posted_invoices
BEGIN SELECT RAISE(ABORT, 'posted invoice is immutable'); END;
CREATE TRIGGER IF NOT EXISTS posted_invoice_no_delete
BEFORE DELETE ON posted_invoices
BEGIN SELECT RAISE(ABORT, 'posted invoice is immutable'); END;
