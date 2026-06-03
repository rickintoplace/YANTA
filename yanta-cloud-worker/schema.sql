CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  email_verified INTEGER NOT NULL DEFAULT 0,
  plan TEXT NOT NULL DEFAULT 'free',
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  disabled_at INTEGER,
  deletion_scheduled_at INTEGER
);

CREATE TABLE IF NOT EXISTS login_challenges (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  magic_token_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  used_at INTEGER,
  ip_hash TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_login_challenges_email
ON login_challenges(email);

CREATE INDEX IF NOT EXISTS idx_login_challenges_magic
ON login_challenges(magic_token_hash);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  user_agent TEXT,
  ip_hash TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_token_hash
ON sessions(token_hash);

CREATE TABLE IF NOT EXISTS vaults (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT,
  created_at INTEGER NOT NULL,
  last_sync_at INTEGER,
  archived_at INTEGER,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_vaults_user
ON vaults(user_id);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  vault_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  name TEXT,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  revoked_at INTEGER,
  UNIQUE(vault_id, device_id),
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(vault_id) REFERENCES vaults(id)
);

CREATE TABLE IF NOT EXISTS objects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  vault_id TEXT NOT NULL,
  path TEXT NOT NULL,
  size INTEGER NOT NULL,
  etag TEXT,
  updated_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(vault_id, path)
);

CREATE INDEX IF NOT EXISTS idx_objects_vault_path
ON objects(vault_id, path);

CREATE TABLE IF NOT EXISTS usage_current (
  user_id TEXT PRIMARY KEY,
  storage_bytes INTEGER NOT NULL DEFAULT 0,
  object_count INTEGER NOT NULL DEFAULT 0,

  month_key TEXT NOT NULL,
  upload_bytes_month INTEGER NOT NULL DEFAULT 0,
  download_bytes_month INTEGER NOT NULL DEFAULT 0,

  day_key TEXT NOT NULL,
  upload_bytes_day INTEGER NOT NULL DEFAULT 0,
  writes_today INTEGER NOT NULL DEFAULT 0,

  ai_month_key TEXT NOT NULL,
  ai_spend_micros_month INTEGER NOT NULL DEFAULT 0,

  ai_day_key TEXT NOT NULL,
  ai_requests_day INTEGER NOT NULL DEFAULT 0,

  ai_credits_micros INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  kind TEXT NOT NULL,
  ip_hash TEXT,
  meta_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_usage_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  cost_micros INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);