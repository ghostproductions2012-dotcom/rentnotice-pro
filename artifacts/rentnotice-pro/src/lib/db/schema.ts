/**
 * The complete SQLite schema for RentNotice Pro. Money is stored as INTEGER
 * cents, dates as TEXT ISO strings, booleans as INTEGER 0/1, nested structures
 * as TEXT JSON, and binary payloads (PDFs, photos, uploads) as BLOB.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  initials TEXT NOT NULL,
  role TEXT NOT NULL,
  pin_hash TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS company_profile (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  logo_data_url TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  id TEXT PRIMARY KEY,
  company_profile_id TEXT,
  default_jurisdiction TEXT NOT NULL DEFAULT 'CA',
  require_attorney_reviewed_template INTEGER NOT NULL DEFAULT 0,
  allow_admin_template_override INTEGER NOT NULL DEFAULT 1,
  pin_lock_enabled INTEGER NOT NULL DEFAULT 0,
  auto_lock_minutes INTEGER NOT NULL DEFAULT 15,
  ai_assist_enabled INTEGER NOT NULL DEFAULT 0,
  ai_consent_acknowledged INTEGER NOT NULL DEFAULT 0,
  sync_enabled INTEGER NOT NULL DEFAULT 0,
  sync_endpoint TEXT NOT NULL DEFAULT '',
  disclaimer_acknowledged_at TEXT,
  onboarding_completed INTEGER NOT NULL DEFAULT 0,
  buildium_client_id TEXT NOT NULL DEFAULT '',
  buildium_client_secret TEXT NOT NULL DEFAULT '',
  buildium_connected_at TEXT,
  buildium_last_sync_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS properties (
  id TEXT PRIMARY KEY,
  nickname TEXT NOT NULL,
  address_line1 TEXT NOT NULL,
  address_line2 TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  zip TEXT NOT NULL,
  county TEXT NOT NULL DEFAULT '',
  bedrooms INTEGER,
  units TEXT NOT NULL DEFAULT '[]',
  owner_name TEXT NOT NULL DEFAULT '',
  management_company TEXT NOT NULL DEFAULT '',
  manager_contact TEXT NOT NULL DEFAULT '',
  payment TEXT NOT NULL,
  is_los_angeles_city INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  external_source TEXT,
  external_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_properties_external ON properties (external_source, external_id);

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  names TEXT NOT NULL DEFAULT '[]',
  property_id TEXT,
  unit TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  monthly_rent_cents INTEGER,
  lease_start TEXT,
  move_out_date TEXT,
  notes TEXT NOT NULL DEFAULT '',
  archived INTEGER NOT NULL DEFAULT 0,
  external_source TEXT,
  external_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tenants_external ON tenants (external_source, external_id);

CREATE TABLE IF NOT EXISTS ledgers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_file_name TEXT,
  vendor TEXT NOT NULL,
  mapping_used TEXT,
  imported_at TEXT NOT NULL,
  imported_by TEXT,
  transaction_count INTEGER NOT NULL DEFAULT 0,
  period_start TEXT,
  period_end TEXT,
  notes TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS ledger_rows (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL,
  row_index INTEGER NOT NULL,
  date TEXT NOT NULL,
  month TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  original_category TEXT NOT NULL DEFAULT '',
  memo TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  balance_cents INTEGER,
  system_class TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0,
  included_in_notice INTEGER NOT NULL DEFAULT 0,
  class_reason TEXT NOT NULL DEFAULT '',
  user_override_class TEXT,
  override_reason TEXT,
  overridden_by TEXT,
  flagged INTEGER NOT NULL DEFAULT 0,
  flag_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_ledger_rows_ledger ON ledger_rows (ledger_id);

CREATE TABLE IF NOT EXISTS mapping_presets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  vendor TEXT NOT NULL,
  mapping TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS calculations (
  ledger_id TEXT PRIMARY KEY,
  months TEXT NOT NULL DEFAULT '[]',
  total_rent_only_cents INTEGER NOT NULL DEFAULT 0,
  total_excluded_cents INTEGER NOT NULL DEFAULT 0,
  unapplied_payments_cents INTEGER NOT NULL DEFAULT 0,
  global_warnings TEXT NOT NULL DEFAULT '[]',
  computed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notices (
  id TEXT PRIMARY KEY,
  notice_type TEXT NOT NULL,
  jurisdiction TEXT NOT NULL DEFAULT 'CA',
  status TEXT NOT NULL DEFAULT 'draft',
  tenant_id TEXT NOT NULL,
  property_id TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT '',
  tenant_names TEXT NOT NULL DEFAULT '[]',
  property_address TEXT NOT NULL DEFAULT '',
  ledger_id TEXT,
  months TEXT NOT NULL DEFAULT '[]',
  total_amount_cents INTEGER NOT NULL DEFAULT 0,
  payment TEXT NOT NULL,
  template_id TEXT,
  template_version INTEGER,
  include_lahd_letter INTEGER NOT NULL DEFAULT 0,
  covenant_description TEXT NOT NULL DEFAULT '',
  entry_date TEXT,
  entry_time_window TEXT NOT NULL DEFAULT '',
  entry_reason TEXT NOT NULL DEFAULT '',
  termination_date TEXT,
  rent_increase_new_amount_cents INTEGER,
  rent_increase_effective_date TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  revised_from_id TEXT,
  reviewer_approved_by TEXT,
  reviewer_approved_at TEXT,
  finalized_by TEXT,
  finalized_at TEXT,
  attorney_export_flag INTEGER NOT NULL DEFAULT 0,
  prereq_completed TEXT NOT NULL DEFAULT '{}',
  rule_card_key TEXT,
  electronic_service_consent INTEGER NOT NULL DEFAULT 0,
  service_date_served TEXT,
  service_time_served TEXT,
  service_method TEXT,
  service_served_by TEXT NOT NULL DEFAULT '',
  service_server_notes TEXT NOT NULL DEFAULT '',
  service_mailed_date TEXT,
  deadline_date TEXT,
  internal_notes TEXT NOT NULL DEFAULT '',
  prepared_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notices_tenant ON notices (tenant_id);
CREATE INDEX IF NOT EXISTS idx_notices_property ON notices (property_id);

CREATE TABLE IF NOT EXISTS status_history (
  id TEXT PRIMARY KEY,
  notice_id TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  changed_by TEXT,
  changed_at TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_status_history_notice ON status_history (notice_id);

CREATE TABLE IF NOT EXISTS validation_results (
  notice_id TEXT PRIMARY KEY,
  issues TEXT NOT NULL DEFAULT '[]',
  blockers INTEGER NOT NULL DEFAULT 0,
  warnings INTEGER NOT NULL DEFAULT 0,
  passed INTEGER NOT NULL DEFAULT 0,
  computed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  notice_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  packet_kind TEXT,
  file_name TEXT NOT NULL,
  watermarked INTEGER NOT NULL DEFAULT 0,
  locked INTEGER NOT NULL DEFAULT 0,
  page_count INTEGER NOT NULL DEFAULT 1,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  generated_at TEXT NOT NULL,
  generated_by TEXT,
  bytes BLOB
);
CREATE INDEX IF NOT EXISTS idx_documents_notice ON documents (notice_id);

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  notice_type TEXT NOT NULL,
  jurisdiction TEXT NOT NULL DEFAULT 'CA',
  locality TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  attorney_reviewed INTEGER NOT NULL DEFAULT 0,
  reviewed_by TEXT NOT NULL DEFAULT '',
  review_date TEXT,
  current_version INTEGER NOT NULL DEFAULT 1,
  versions TEXT NOT NULL DEFAULT '[]',
  merge_fields TEXT NOT NULL DEFAULT '[]',
  built_in INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS holidays (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  name TEXT NOT NULL,
  jurisdiction TEXT NOT NULL DEFAULT 'CA',
  court_holiday INTEGER NOT NULL DEFAULT 1,
  built_in INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_holidays_date ON holidays (date);

CREATE TABLE IF NOT EXISTS state_rule_reviews (
  state TEXT PRIMARY KEY,
  reviewer_name TEXT NOT NULL,
  reviewed_at TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  recorded_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  user_id TEXT,
  user_name TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL DEFAULT '',
  entity_id TEXT,
  summary TEXT NOT NULL DEFAULT '',
  previous_value TEXT,
  new_value TEXT,
  reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log (timestamp);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  bytes BLOB,
  uploaded_by TEXT,
  uploaded_at TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_attachments_entity ON attachments (entity_type, entity_id);

CREATE TABLE IF NOT EXISTS field_assignments (
  id TEXT PRIMARY KEY,
  notice_id TEXT NOT NULL,
  assignee_name TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'assigned',
  service_method TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_field_assignments_notice ON field_assignments (notice_id);

CREATE TABLE IF NOT EXISTS field_evidence (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL,
  photo_bytes BLOB,
  photo_mime TEXT NOT NULL DEFAULT 'image/jpeg',
  latitude REAL,
  longitude REAL,
  accuracy_meters REAL,
  captured_at TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  order_index INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_field_evidence_assignment ON field_evidence (assignment_id);

CREATE TABLE IF NOT EXISTS work_orders (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL,
  tenant_id TEXT,
  unit TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'general',
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'new',
  due_date TEXT,
  assignee_name TEXT NOT NULL DEFAULT '',
  vendor_name TEXT NOT NULL DEFAULT '',
  vendor_contact TEXT NOT NULL DEFAULT '',
  cost_estimate_cents INTEGER,
  cost_actual_cents INTEGER,
  internal_notes TEXT NOT NULL DEFAULT '',
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_work_orders_property ON work_orders (property_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_tenant ON work_orders (tenant_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_status ON work_orders (status);

CREATE TABLE IF NOT EXISTS work_order_status_history (
  id TEXT PRIMARY KEY,
  work_order_id TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  changed_by TEXT,
  changed_by_name TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  changed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wo_status_history_wo ON work_order_status_history (work_order_id);

CREATE TABLE IF NOT EXISTS mail_tracking (
  id TEXT PRIMARY KEY,
  notice_id TEXT NOT NULL,
  carrier TEXT NOT NULL DEFAULT '',
  tracking_number TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'preparing',
  mailed_date TEXT,
  events TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mail_tracking_notice ON mail_tracking (notice_id);
`;
