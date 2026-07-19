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
  ai_spend_micros_day INTEGER NOT NULL DEFAULT 0,

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

-- ============================================================
-- Public Shares
-- Zero-knowledge latest-only public note shares.
-- Server stores encrypted payload and grants to encrypted asset blobs.
-- ============================================================

CREATE TABLE IF NOT EXISTS public_shares (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  vault_id TEXT,
  source_type TEXT NOT NULL DEFAULT 'note',
  source_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  expires_at INTEGER,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_published_at INTEGER,
  payload_object_key TEXT,
  payload_etag TEXT,
  payload_size_bytes INTEGER,
  FOREIGN KEY(owner_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_public_shares_owner
ON public_shares(owner_user_id, updated_at);

CREATE INDEX IF NOT EXISTS idx_public_shares_source
ON public_shares(owner_user_id, vault_id, source_type, source_id);

CREATE TABLE IF NOT EXISTS public_share_assets (
  share_id TEXT NOT NULL,
  asset_object_id TEXT NOT NULL,
  object_path TEXT NOT NULL,
  size_bytes INTEGER,
  mime TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (share_id, asset_object_id),
  FOREIGN KEY(share_id) REFERENCES public_shares(id)
);

CREATE INDEX IF NOT EXISTS idx_public_share_assets_share
ON public_share_assets(share_id);

CREATE TABLE IF NOT EXISTS public_shares (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  vault_id TEXT,
  source_type TEXT NOT NULL DEFAULT 'note',
  source_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  expires_at INTEGER,
  revoked_at INTEGER,
  payload_object_key TEXT,
  payload_etag TEXT,
  payload_size_bytes INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_published_at INTEGER,
  FOREIGN KEY(owner_user_id) REFERENCES users(id),
  FOREIGN KEY(vault_id) REFERENCES vaults(id)
);

CREATE INDEX IF NOT EXISTS idx_public_shares_owner
ON public_shares(owner_user_id, updated_at);

CREATE INDEX IF NOT EXISTS idx_public_shares_source
ON public_shares(owner_user_id, source_type, source_id);

CREATE TABLE IF NOT EXISTS public_share_assets (
  share_id TEXT NOT NULL,
  asset_object_id TEXT NOT NULL,
  object_path TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  mime TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (share_id, asset_object_id),
  FOREIGN KEY(share_id) REFERENCES public_shares(id)
);

CREATE INDEX IF NOT EXISTS idx_public_share_assets_share
ON public_share_assets(share_id);

-- ============================================================
-- Presentation Sessions
-- Ephemeral zero-knowledge meeting-room presentation sessions.
-- Display payload is encrypted client-side.
-- Edits are scoped to the session until owner applies them.
-- ============================================================

CREATE TABLE IF NOT EXISTS presentation_sessions (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  vault_id TEXT,
  source_type TEXT NOT NULL DEFAULT 'drawing',
  source_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  payload_object_key TEXT,
  payload_etag TEXT,
  payload_size_bytes INTEGER NOT NULL DEFAULT 0,
  signaling_topic TEXT NOT NULL,
  signaling_token TEXT NOT NULL,
  FOREIGN KEY(owner_user_id) REFERENCES users(id),
  FOREIGN KEY(vault_id) REFERENCES vaults(id)
);

CREATE INDEX IF NOT EXISTS idx_presentation_sessions_owner
ON presentation_sessions(owner_user_id, updated_at);

CREATE INDEX IF NOT EXISTS idx_presentation_sessions_source
ON presentation_sessions(owner_user_id, source_type, source_id);

-- ============================================================
-- Billing / Paddle
-- ============================================================

CREATE TABLE IF NOT EXISTS billing_customers (
  user_id TEXT PRIMARY KEY,
  paddle_customer_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_billing_customers_paddle_customer
ON billing_customers(paddle_customer_id);

CREATE TABLE IF NOT EXISTS billing_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  paddle_subscription_id TEXT NOT NULL UNIQUE,
  paddle_customer_id TEXT,
  status TEXT NOT NULL,
  plan TEXT NOT NULL,
  price_id TEXT,
  current_period_starts_at INTEGER,
  current_period_ends_at INTEGER,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  raw_json TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_user
ON billing_subscriptions(user_id, updated_at);

CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_customer
ON billing_subscriptions(paddle_customer_id);

CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_status
ON billing_subscriptions(status);

CREATE TABLE IF NOT EXISTS billing_transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  paddle_transaction_id TEXT NOT NULL UNIQUE,
  paddle_subscription_id TEXT,
  paddle_customer_id TEXT,
  status TEXT NOT NULL,
  amount INTEGER NOT NULL DEFAULT 0,
  currency TEXT,
  created_at INTEGER NOT NULL,
  raw_json TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_billing_transactions_user
ON billing_transactions(user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_billing_transactions_subscription
ON billing_transactions(paddle_subscription_id);

CREATE INDEX IF NOT EXISTS idx_billing_transactions_customer
ON billing_transactions(paddle_customer_id);

CREATE TABLE IF NOT EXISTS billing_events (
  id TEXT PRIMARY KEY,
  paddle_event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  processed_at INTEGER NOT NULL,
  raw_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_billing_events_type
ON billing_events(event_type, processed_at);

-- ============================================================
-- Shared Spaces
-- Zero-knowledge live-sharing containers for a note or folder.
-- The server stores only encrypted Yjs snapshots/updates (in the
-- existing objects table + R2, keyed by vault_id = space id) and
-- enforces read/write access without ever seeing key material.
-- ============================================================

CREATE TABLE IF NOT EXISTS spaces (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  vault_id TEXT,
  source_type TEXT NOT NULL DEFAULT 'note',
  source_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  read_token_hash TEXT,
  write_token_hash TEXT,
  webrtc_epoch INTEGER NOT NULL DEFAULT 1,
  signaling_topic TEXT NOT NULL,
  storage_bytes INTEGER NOT NULL DEFAULT 0,
  object_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  revoked_at INTEGER,
  FOREIGN KEY(owner_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_spaces_owner
ON spaces(owner_user_id, updated_at);

CREATE TABLE IF NOT EXISTS space_members (
  space_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  matrix_user_id TEXT,
  role TEXT NOT NULL DEFAULT 'read',
  invited_by TEXT,
  created_at INTEGER NOT NULL,
  key_delivered_at INTEGER,
  revoked_at INTEGER,
  PRIMARY KEY (space_id, user_id),
  FOREIGN KEY(space_id) REFERENCES spaces(id)
);

CREATE INDEX IF NOT EXISTS idx_space_members_user
ON space_members(user_id, created_at);

-- Approximate, privacy-preserving link statistics per space: one row,
-- counters only — no IPs, no user agents, nothing per-visitor. Lets the
-- owner see "~N link opens" and get told when their link was throttled.
CREATE TABLE IF NOT EXISTS space_link_stats (
  space_id TEXT PRIMARY KEY,
  link_opens INTEGER NOT NULL DEFAULT 0,
  last_open_at INTEGER,
  throttled_at INTEGER,
  quota_hit_at INTEGER,
  FOREIGN KEY(space_id) REFERENCES spaces(id)
);

-- ============================================================
-- Chat / Matrix Provisioning
-- One YANTA Cloud user can claim exactly one Matrix account.
-- Localparts stay reserved after deprovisioning for future e-mail aliases.
-- ============================================================

CREATE TABLE IF NOT EXISTS chat_accounts (
  user_id TEXT PRIMARY KEY,              -- YANTA user
  matrix_localpart TEXT NOT NULL UNIQUE, -- 'rick'
  matrix_user_id TEXT NOT NULL UNIQUE,   -- '@rick:yanta.me'
  created_at INTEGER NOT NULL,
  disabled_at INTEGER,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS chat_reserved_names (
  localpart TEXT PRIMARY KEY,
  reason TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_accounts_localpart
ON chat_accounts(matrix_localpart);

CREATE INDEX IF NOT EXISTS idx_chat_accounts_matrix_user_id
ON chat_accounts(matrix_user_id);

INSERT OR IGNORE INTO chat_reserved_names (localpart, reason, created_at)
VALUES
  ('help', 'reserved', unixepoch() * 1000),
  ('contact', 'reserved', unixepoch() * 1000),
  ('hello', 'reserved', unixepoch() * 1000),
  ('team', 'reserved', unixepoch() * 1000),
  ('office', 'reserved', unixepoch() * 1000);
-- ============================================================
-- Web Push (desktop background notifications)
-- ============================================================

-- One Web Push subscription per user + device (browser/PWA).
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  pushkey TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  fail_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, device_id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_pushkey
ON push_subscriptions(pushkey);

-- Client-scheduled calendar reminder pushes. enc_payload is opaque to the
-- Worker (client-side AES-GCM), so event titles never reach the server.
CREATE TABLE IF NOT EXISTS scheduled_pushes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  fire_at INTEGER NOT NULL,
  enc_payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  sent_at INTEGER,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_scheduled_pushes_due
ON scheduled_pushes(sent_at, fire_at);
