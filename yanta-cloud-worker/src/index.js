const PLAN_LIMITS = {
  free: {
    storageBytes: 25 * 1024 * 1024,
    vaults: 1,
    devices: 5,
    objects: 10000,
    objectSizeBytes: 2 * 1024 * 1024,
  // Backend-internal object transfer.
  // Needs headroom for first sync, retries, snapshots.
    uploadBytesDay: 250 * 1024 * 1024,
  // Real download abuse remains capped.
    downloadBytesMonth: 100 * 1024 * 1024,
  // Internal encrypted object writes.
  // Product/UI can still say "200 app writes/day" if we enforce that separately later.
    writesDay: 8000,
    includedAi: false,
    aiRequestsDay: 0,
    aiSpendMicrosMonth: 0
  },

  premium: {
    storageBytes: 2 * 1024 * 1024 * 1024,
    vaults: 10,
    devices: 20,
    objects: 200000,
    objectSizeBytes: 100 * 1024 * 1024,
    uploadBytesDay: 5 * 1024 * 1024 * 1024,
    downloadBytesMonth: 50 * 1024 * 1024 * 1024,
    writesDay: 20000,
    includedAi: true,
    aiRequestsDay: 500,
    aiSpendMicrosMonth: 5000000
  }
};

const AI_MODEL_ALLOWLIST = new Set([
  'openai/gpt-4o-mini',
  'google/gemini-2.0-flash-001',
  'anthropic/claude-3.5-haiku',
  'meta-llama/llama-3.1-8b-instruct'
]);

const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com',
  '10minutemail.com',
  'guerrillamail.com',
  'tempmail.com',
  'temp-mail.org',
  'yopmail.com',
  'trashmail.com'
]);

function now() {
  return Date.now();
}

function monthKey(ts = now()) {
  return new Date(ts).toISOString().slice(0, 7);
}

function dayKey(ts = now()) {
  return new Date(ts).toISOString().slice(0, 10);
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...headers
    }
  });
}

function text(data, status = 200, headers = {}) {
  return new Response(String(data), {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      ...headers
    }
  });
}

function base64url(bytes) {
  let bin = '';
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomToken(bytes = 32) {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return base64url(b);
}

function id(prefix) {
  return `${prefix}_${randomToken(18)}`;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function emailDomain(email) {
  return normalizeEmail(email).split('@')[1] || '';
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function hmacHex(secret, message) {
  const enc = new TextEncoder();

  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hashToken(env, token) {
  return hmacHex(env.SESSION_SECRET, token);
}

function clientIp(req) {
  return req.headers.get('cf-connecting-ip') || '0.0.0.0';
}

async function ipHash(env, req) {
  return hmacHex(env.SESSION_SECRET, clientIp(req));
}

function parseCookies(req) {
  const raw = req.headers.get('cookie') || '';
  const out = {};
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function cookieHeader(env, token, maxAgeSeconds) {
  const name = env.COOKIE_NAME || 'yanta_cloud_session';
  const domain = env.COOKIE_DOMAIN ? `; Domain=${env.COOKIE_DOMAIN}` : '';

  return [
    `${name}=${encodeURIComponent(token)}`,
    `Max-Age=${maxAgeSeconds}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    domain
  ].filter(Boolean).join('; ');
}

function clearCookieHeader(env) {
  const name = env.COOKIE_NAME || 'yanta_cloud_session';
  const domain = env.COOKIE_DOMAIN ? `; Domain=${env.COOKIE_DOMAIN}` : '';
  return `${name}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax${domain}`;
}

function allowedOrigins(env) {
  const raw = [
    env.APP_ORIGIN || '',
    env.ALLOWED_ORIGINS || '',
  ].filter(Boolean).join(',');

  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.replace(/\/+$/, ''))
  );
}

function corsHeaders(env, req) {
  const origin = (req.headers.get('origin') || '').replace(/\/+$/, '');
  const allowed = allowedOrigins(env);

  if (!origin) return {};

  if (allowed.size && !allowed.has(origin)) {
    return {};
  }

  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,x-yanta-vault-id,x-yanta-device-id,x-yanta-platform,x-csrf-token',
    'access-control-allow-credentials': 'true',
    'access-control-max-age': '86400',
    vary: 'Origin'
  };
}

function originAllowed(env, req) {
  const origin = (req.headers.get('origin') || '').replace(/\/+$/, '');
  if (!origin) return true;

  const allowed = allowedOrigins(env);

  if (!allowed.size) return true;

  return allowed.has(origin);
}

async function bodyJson(req) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

async function audit(env, req, kind, userId = null, meta = {}) {
  try {
    await env.DB.prepare(
      `INSERT INTO audit_events (id,user_id,kind,ip_hash,meta_json,created_at)
       VALUES (?,?,?,?,?,?)`
    ).bind(
      id('aud'),
      userId,
      kind,
      await ipHash(env, req),
      JSON.stringify(meta || {}),
      now()
    ).run();
  } catch {}
}

async function rateLimit(env, key, limit, windowMs) {
  const t = now();
  const existing = await env.DB.prepare(
    `SELECT key, window_start, count FROM rate_limits WHERE key = ?`
  ).bind(key).first();

  if (!existing || t - existing.window_start > windowMs) {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO rate_limits (key, window_start, count) VALUES (?,?,?)`
    ).bind(key, t, 1).run();

    return { ok: true, remaining: limit - 1 };
  }

  if (existing.count >= limit) {
    return { ok: false, remaining: 0 };
  }

  await env.DB.prepare(
    `UPDATE rate_limits SET count = count + 1 WHERE key = ?`
  ).bind(key).run();

  return { ok: true, remaining: limit - existing.count - 1 };
}

async function verifyTurnstile(env, token, req) {
  if (!env.TURNSTILE_SECRET_KEY) return true;

  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET_KEY);
  form.append('response', token || '');
  form.append('remoteip', clientIp(req));

  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: form
  });

  const data = await res.json().catch(() => null);
  return !!data?.success;
}

async function sendLoginEmail(env, { email, code, magicUrl }) {
  if (!env.RESEND_API_KEY) {
    console.log('[DEV] Login code:', email, code, magicUrl);
    return;
  }

  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;line-height:1.5">
      <h2>Your YANTA login code</h2>
      <p>Use this code to sign in:</p>
      <div style="font-size:28px;font-weight:800;letter-spacing:0.18em">${code}</div>
      <p>This code expires in 10 minutes.</p>
      <p>Or open this magic link:</p>
      <p><a href="${magicUrl}">${magicUrl}</a></p>
      <p style="color:#666;font-size:12px">If you did not request this email, you can ignore it.</p>
    </div>
  `;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      from: env.FROM_EMAIL,
      to: email,
      subject: 'Your YANTA login code',
      html
    })
  });

  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(`Resend failed: ${res.status} ${msg}`);
  }
}

async function getSession(env, req) {
  const cookies = parseCookies(req);
  const token = cookies[env.COOKIE_NAME || 'yanta_cloud_session'];
  if (!token) return null;

  const tokenHash = await hashToken(env, token);

  const row = await env.DB.prepare(
    `SELECT s.id AS session_id, s.user_id, s.expires_at, s.revoked_at,
            u.email, u.plan, u.disabled_at
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?`
  ).bind(tokenHash).first();

  if (!row) return null;
  if (row.revoked_at) return null;
  if (row.disabled_at) return null;
  if (row.expires_at < now()) return null;

  await env.DB.prepare(
    `UPDATE users SET last_seen_at = ? WHERE id = ?`
  ).bind(now(), row.user_id).run();

  return {
    sessionId: row.session_id,
    userId: row.user_id,
    email: row.email,
    plan: row.plan || 'free'
  };
}

async function requireUser(env, req) {
  const user = await getSession(env, req);
  if (!user) {
    const err = new Error('Authentication required');
    err.status = 401;
    throw err;
  }
  return user;
}

async function ensureUsageRow(env, userId) {
  const m = monthKey();
  const d = dayKey();

  const existing = await env.DB.prepare(
    `SELECT * FROM usage_current WHERE user_id = ?`
  ).bind(userId).first();

  if (!existing) {
    await env.DB.prepare(
      `INSERT INTO usage_current
       (user_id, month_key, day_key, ai_month_key, ai_day_key)
       VALUES (?,?,?,?,?)`
    ).bind(userId, m, d, m, d).run();

    return await env.DB.prepare(
      `SELECT * FROM usage_current WHERE user_id = ?`
    ).bind(userId).first();
  }

  if (existing.month_key !== m) {
    await env.DB.prepare(
      `UPDATE usage_current
       SET month_key = ?, upload_bytes_month = 0, download_bytes_month = 0
       WHERE user_id = ?`
    ).bind(m, userId).run();
  }

  if (existing.day_key !== d) {
    await env.DB.prepare(
      `UPDATE usage_current
       SET day_key = ?, upload_bytes_day = 0, writes_today = 0
       WHERE user_id = ?`
    ).bind(d, userId).run();
  }

  if (existing.ai_month_key !== m) {
    await env.DB.prepare(
      `UPDATE usage_current
       SET ai_month_key = ?, ai_spend_micros_month = 0
       WHERE user_id = ?`
    ).bind(m, userId).run();
  }

  if (existing.ai_day_key !== d) {
    await env.DB.prepare(
      `UPDATE usage_current
       SET ai_day_key = ?, ai_requests_day = 0
       WHERE user_id = ?`
    ).bind(d, userId).run();
  }

  return await env.DB.prepare(
    `SELECT * FROM usage_current WHERE user_id = ?`
  ).bind(userId).first();
}

function effectiveLimits(user, createdAt = 0) {
  const base = PLAN_LIMITS[user.plan] || PLAN_LIMITS.free;

  /*
    Wichtig:
    Beim ersten Cloud-Sync erzeugt YANTA viele kleine verschlüsselte Objekte:
    - Vault snapshot
    - Note snapshots
    - ggf. Asset blobs
    - Device/vault update packs

    Ein zu hartes "new account write throttle" blockiert legitime Nutzer direkt
    beim Onboarding. Abuse-Schutz passiert hier sinnvoller über:
    - Storage limit
    - Object size limit
    - Upload/day
    - Auth rate limits
    - Turnstile
  */
  return base;
}

async function getUserCreatedAt(env, userId) {
  const row = await env.DB.prepare(
    `SELECT created_at FROM users WHERE id = ?`
  ).bind(userId).first();

  return row?.created_at || 0;
}

function normalizeRemotePath(raw) {
  let p = String(raw || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
    .trim();

  const parts = [];

  for (const part of p.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') throw new Error('Path must not contain ..');
    if (part.includes('\0')) throw new Error('Path contains NUL');
    parts.push(part);
  }

  p = parts.join('/');
  if (!p) throw new Error('Path must not be empty');

  if (!p.startsWith('yanta-sync-v1/')) {
    throw new Error('Path outside YANTA sync namespace');
  }

  return p;
}

function normalizeRemotePrefix(raw) {
  const s = String(raw || '').trim();

  if (!s) {
    return 'yanta-sync-v1/';
  }

  let p = s
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
    .trim();

  const hadTrailingSlash = p.endsWith('/');

  const parts = [];

  for (const part of p.split('/')) {
    if (!part || part === '.') continue;

    if (part === '..') {
      throw new Error('Prefix must not contain ..');
    }

    if (part.includes('\0')) {
      throw new Error('Prefix contains NUL');
    }

    parts.push(part);
  }

  p = parts.join('/');

  if (!p) {
    return 'yanta-sync-v1/';
  }

  if (!p.startsWith('yanta-sync-v1')) {
    throw new Error('Prefix outside YANTA sync namespace');
  }

  if (hadTrailingSlash && !p.endsWith('/')) {
    p += '/';
  }

  return p;
}

function r2Key(userId, vaultId, remotePath) {
  return `users/${userId}/vaults/${vaultId}/${remotePath}`;
}

async function requireVault(env, user, vaultId) {
  const v = await env.DB.prepare(
    `SELECT * FROM vaults WHERE id = ? AND user_id = ? AND archived_at IS NULL`
  ).bind(vaultId, user.userId).first();

  if (!v) {
    const err = new Error('Vault not found');
    err.status = 404;
    throw err;
  }

  return v;
}

function cleanHeaderValue(value = '') {
  return String(value || '')
    .trim()
    .replace(/^"|"$/g, '')
    .slice(0, 300);
}

function parseUserAgentInfo(userAgent = '', platformHint = '') {
  const ua = String(userAgent || '');
  const platform = cleanHeaderValue(platformHint);

  let browser = 'Unknown browser';

  if (/Edg\//i.test(ua)) browser = 'Microsoft Edge';
  else if (/OPR\//i.test(ua) || /Opera/i.test(ua)) browser = 'Opera';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) browser = 'Chrome';
  else if (/CriOS\//i.test(ua)) browser = 'Chrome iOS';
  else if (/Safari\//i.test(ua) && /Version\//i.test(ua)) browser = 'Safari';

  let os = platform || 'Unknown OS';

  if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/Windows NT/i.test(ua)) os = 'Windows';
  else if (/Mac OS X|Macintosh/i.test(ua)) os = 'macOS';
  else if (/Linux/i.test(ua)) os = 'Linux';

  let deviceType = 'Desktop';

  if (/iPad|Tablet/i.test(ua)) {
    deviceType = 'Tablet';
  } else if (/Mobile|iPhone|Android/i.test(ua)) {
    deviceType = 'Phone';
  }

  return {
    browser,
    os,
    deviceType,
    platform: platform || os,
  };
}

function deviceInfoFromRequest(req) {
  const userAgent = cleanHeaderValue(req.headers.get('user-agent') || '');
  const platformHint = cleanHeaderValue(
    req.headers.get('sec-ch-ua-platform') ||
    req.headers.get('x-yanta-platform') ||
    ''
  );

  return {
    userAgent,
    ...parseUserAgentInfo(userAgent, platformHint),
  };
}

function deviceDisplayName(deviceId, info = {}) {
  const parts = [
    info.deviceType,
    info.browser,
    info.os,
  ].filter(Boolean).filter((x) => !/^Unknown/i.test(x));

  return parts.length
    ? parts.join(' · ')
    : String(deviceId || 'Device');
}

async function requireActiveVaultDevice(env, user, vaultId, deviceId, req = null) {
  if (!deviceId) {
    const err = new Error('Current device id missing');
    err.status = 400;
    throw err;
  }

  const row = await env.DB.prepare(
    `SELECT *
     FROM devices
     WHERE user_id = ?
       AND vault_id = ?
       AND device_id = ?`
  ).bind(user.userId, vaultId, deviceId).first();

  if (!row) {
    const err = new Error('Current device is not registered for this vault');
    err.status = 403;
    throw err;
  }

  if (row.revoked_at) {
    const err = new Error('This device was removed from this vault');
    err.status = 403;
    throw err;
  }

  if (req) {
    const info = deviceInfoFromRequest(req);

    await env.DB.prepare(
      `UPDATE devices
       SET last_seen_at = ?,
           user_agent = COALESCE(NULLIF(?, ''), user_agent),
           platform = COALESCE(NULLIF(?, ''), platform),
           browser = COALESCE(NULLIF(?, ''), browser),
           os = COALESCE(NULLIF(?, ''), os),
           device_type = COALESCE(NULLIF(?, ''), device_type),
           name = CASE
             WHEN name IS NULL OR name = '' OR name = device_id THEN ?
             ELSE name
           END
       WHERE id = ?`
    ).bind(
      now(),
      info.userAgent || '',
      info.platform || '',
      info.browser || '',
      info.os || '',
      info.deviceType || '',
      deviceDisplayName(deviceId, info),
      row.id
    ).run();
  } else {
    await env.DB.prepare(
      `UPDATE devices SET last_seen_at = ? WHERE id = ?`
    ).bind(now(), row.id).run();
  }

  return row;
}

async function ensureDevice(env, user, vaultId, deviceId, req = null) {
  if (!deviceId) {
    const err = new Error('Device id missing');
    err.status = 400;
    throw err;
  }

  const info = req
    ? deviceInfoFromRequest(req)
    : {
        userAgent: '',
        platform: '',
        browser: '',
        os: '',
        deviceType: '',
      };

  const existing = await env.DB.prepare(
    `SELECT *
     FROM devices
     WHERE user_id = ?
       AND vault_id = ?
       AND device_id = ?`
  ).bind(user.userId, vaultId, deviceId).first();

  if (existing) {
    if (existing.revoked_at) {
      const err = new Error('Device revoked');
      err.status = 403;
      throw err;
    }

    await env.DB.prepare(
      `UPDATE devices
       SET last_seen_at = ?,
           user_agent = COALESCE(NULLIF(?, ''), user_agent),
           platform = COALESCE(NULLIF(?, ''), platform),
           browser = COALESCE(NULLIF(?, ''), browser),
           os = COALESCE(NULLIF(?, ''), os),
           device_type = COALESCE(NULLIF(?, ''), device_type),
           name = CASE
             WHEN name IS NULL OR name = '' OR name = device_id THEN ?
             ELSE name
           END
       WHERE id = ?`
    ).bind(
      now(),
      info.userAgent || '',
      info.platform || '',
      info.browser || '',
      info.os || '',
      info.deviceType || '',
      deviceDisplayName(deviceId, info),
      existing.id
    ).run();

    return existing;
  }

  const createdAt = await getUserCreatedAt(env, user.userId);
  const limits = effectiveLimits(user, createdAt);

  const count = await env.DB.prepare(
    `SELECT COUNT(*) AS n
     FROM devices
     WHERE vault_id = ?
       AND revoked_at IS NULL`
  ).bind(vaultId).first();

  if ((count?.n || 0) >= limits.devices) {
    const err = new Error('Device limit reached for your plan');
    err.status = 403;
    throw err;
  }

  const rec = {
    id: id('dev'),
    user_id: user.userId,
    vault_id: vaultId,
    device_id: deviceId,
    name: deviceDisplayName(deviceId, info),
    created_at: now(),
    last_seen_at: now(),
  };

  await env.DB.prepare(
    `INSERT INTO devices
     (id,user_id,vault_id,device_id,name,created_at,last_seen_at,user_agent,platform,browser,os,device_type)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    rec.id,
    rec.user_id,
    rec.vault_id,
    rec.device_id,
    rec.name,
    rec.created_at,
    rec.last_seen_at,
    info.userAgent || '',
    info.platform || '',
    info.browser || '',
    info.os || '',
    info.deviceType || ''
  ).run();

  return rec;
}

async function handleSendCode(env, req, headers) {
  const body = await bodyJson(req);
  const email = normalizeEmail(body.email);
  const turnstileToken = body.turnstileToken || '';

  const generic = {
    ok: true,
    message: 'If this address can receive mail, we sent a code.'
  };

  const ipH = await ipHash(env, req);

  await audit(env, req, 'auth_send_code_attempt', null, { emailDomain: emailDomain(email) });

  const ipLimit = await rateLimit(env, `auth:send:ip:${ipH}`, 5, 60 * 60 * 1000);
  const emailLimit = await rateLimit(env, `auth:send:email:${email}`, 3, 30 * 60 * 1000);
  const pairLimit = await rateLimit(env, `auth:send:pair:${ipH}:${email}`, 3, 60 * 60 * 1000);

  if (!ipLimit.ok || !emailLimit.ok || !pairLimit.ok) {
    return json(generic, 200, headers);
  }

  if (!validEmail(email)) {
    return json(generic, 200, headers);
  }

  if (DISPOSABLE_DOMAINS.has(emailDomain(email))) {
    return json(generic, 200, headers);
  }

  const turnstileOk = await verifyTurnstile(env, turnstileToken, req);
  if (!turnstileOk) {
    return json(generic, 200, headers);
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const magicToken = randomToken(32);

  const codeHash = await hmacHex(env.SESSION_SECRET, `code:${email}:${code}`);
  const magicHash = await hmacHex(env.SESSION_SECRET, `magic:${magicToken}`);

  const challengeId = id('otp');
  const expiresAt = now() + 10 * 60 * 1000;

  await env.DB.prepare(
    `INSERT INTO login_challenges
     (id,email,code_hash,magic_token_hash,expires_at,attempts,ip_hash,created_at)
     VALUES (?,?,?,?,?,?,?,?)`
  ).bind(
    challengeId,
    email,
    codeHash,
    magicHash,
    expiresAt,
    0,
    ipH,
    now()
  ).run();

const publicApiBaseUrl =
  String(env.PUBLIC_API_BASE_URL || new URL(req.url).origin).replace(/\/+$/, '');

const magicUrl =
  `${publicApiBaseUrl}/api/auth/magic?token=${encodeURIComponent(magicToken)}`;

  await sendLoginEmail(env, { email, code, magicUrl });

  await audit(env, req, 'auth_send_code_sent', null, { emailDomain: emailDomain(email) });

  return json(generic, 200, headers);
}

async function createSession(env, req, userId, headers) {
  const token = randomToken(32);
  const tokenHash = await hashToken(env, token);
  const sessionId = id('ses');

  const expiresAt = now() + 90 * 24 * 60 * 60 * 1000;

  await env.DB.prepare(
    `INSERT INTO sessions
     (id,user_id,token_hash,user_agent,ip_hash,created_at,expires_at)
     VALUES (?,?,?,?,?,?,?)`
  ).bind(
    sessionId,
    userId,
    tokenHash,
    req.headers.get('user-agent') || '',
    await ipHash(env, req),
    now(),
    expiresAt
  ).run();

  return {
    'set-cookie': cookieHeader(env, token, 90 * 24 * 60 * 60),
    ...headers
  };
}

async function getOrCreateUser(env, email) {
  let user = await env.DB.prepare(
    `SELECT * FROM users WHERE email = ?`
  ).bind(email).first();

  if (user) {
    await env.DB.prepare(
      `UPDATE users SET email_verified = 1, last_seen_at = ? WHERE id = ?`
    ).bind(now(), user.id).run();

    return await env.DB.prepare(
      `SELECT * FROM users WHERE id = ?`
    ).bind(user.id).first();
  }

  const userId = id('usr');

  await env.DB.prepare(
    `INSERT INTO users (id,email,email_verified,plan,created_at,last_seen_at)
     VALUES (?,?,?,?,?,?)`
  ).bind(userId, email, 1, 'free', now(), now()).run();

  await ensureUsageRow(env, userId);

  return await env.DB.prepare(
    `SELECT * FROM users WHERE id = ?`
  ).bind(userId).first();
}

async function handleVerifyCode(env, req, headers) {
  const body = await bodyJson(req);
  const email = normalizeEmail(body.email);
  const code = String(body.code || '').trim();

  if (!validEmail(email) || !/^\d{6}$/.test(code)) {
    return json({ ok: false, message: 'Invalid code' }, 400, headers);
  }

  const ipH = await ipHash(env, req);
  const rl = await rateLimit(env, `auth:verify:ip:${ipH}`, 30, 60 * 60 * 1000);

  if (!rl.ok) {
    return json({ ok: false, message: 'Too many attempts' }, 429, headers);
  }

  const challenge = await env.DB.prepare(
    `SELECT * FROM login_challenges
     WHERE email = ? AND used_at IS NULL
     ORDER BY created_at DESC
     LIMIT 1`
  ).bind(email).first();

  if (!challenge || challenge.expires_at < now()) {
    return json({ ok: false, message: 'Code expired' }, 400, headers);
  }

  if (challenge.attempts >= 5) {
    return json({ ok: false, message: 'Too many attempts' }, 400, headers);
  }

  const expected = await hmacHex(env.SESSION_SECRET, `code:${email}:${code}`);

  if (expected !== challenge.code_hash) {
    await env.DB.prepare(
      `UPDATE login_challenges SET attempts = attempts + 1 WHERE id = ?`
    ).bind(challenge.id).run();

    return json({ ok: false, message: 'Invalid code' }, 400, headers);
  }

  await env.DB.prepare(
    `UPDATE login_challenges SET used_at = ? WHERE id = ?`
  ).bind(now(), challenge.id).run();

  const user = await getOrCreateUser(env, email);
  const responseHeaders = await createSession(env, req, user.id, headers);

  await audit(env, req, 'auth_login_code_success', user.id, {});

  return json({
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      plan: user.plan
    }
  }, 200, responseHeaders);
}

async function handleMagic(env, req, url, headers) {
  const token = url.searchParams.get('token') || '';
  const appOrigin = env.APP_ORIGIN || 'http://localhost:5173';

  if (!token) {
    return Response.redirect(`${appOrigin}/#login-failed`, 302);
  }

  const hash = await hmacHex(env.SESSION_SECRET, `magic:${token}`);

  const challenge = await env.DB.prepare(
    `SELECT * FROM login_challenges
     WHERE magic_token_hash = ? AND used_at IS NULL
     LIMIT 1`
  ).bind(hash).first();

  if (!challenge || challenge.expires_at < now()) {
    return Response.redirect(`${appOrigin}/#login-expired`, 302);
  }

  await env.DB.prepare(
    `UPDATE login_challenges SET used_at = ? WHERE id = ?`
  ).bind(now(), challenge.id).run();

  const user = await getOrCreateUser(env, challenge.email);
  const responseHeaders = await createSession(env, req, user.id, headers);

  return new Response(null, {
    status: 302,
    headers: {
      location: `${appOrigin}/#cloud-login-ok`,
      ...responseHeaders
    }
  });
}

async function handleMe(env, req, headers) {
  const user = await getSession(env, req);

  if (!user) {
    return json({ authenticated: false }, 200, headers);
  }

  await ensureUsageRow(env, user.userId);

  const usage = await env.DB.prepare(
    `SELECT * FROM usage_current WHERE user_id = ?`
  ).bind(user.userId).first();

  const vaults = await env.DB.prepare(
    `SELECT id,name,created_at,last_sync_at FROM vaults
     WHERE user_id = ? AND archived_at IS NULL
     ORDER BY created_at ASC`
  ).bind(user.userId).all();

  return json({
    authenticated: true,
    user: {
      id: user.userId,
      email: user.email,
      plan: user.plan
    },
    usage,
    vaults: vaults.results || [],
    limits: PLAN_LIMITS[user.plan] || PLAN_LIMITS.free
  }, 200, headers);
}

async function handleLogout(env, req, headers) {
  const cookies = parseCookies(req);
  const token = cookies[env.COOKIE_NAME || 'yanta_cloud_session'];

  if (token) {
    const tokenHash = await hashToken(env, token);
    await env.DB.prepare(
      `UPDATE sessions SET revoked_at = ? WHERE token_hash = ?`
    ).bind(now(), tokenHash).run();
  }

  return json({ ok: true }, 200, {
    ...headers,
    'set-cookie': clearCookieHeader(env)
  });
}

async function handleListVaults(env, req, headers) {
  const user = await requireUser(env, req);

  const rows = await env.DB.prepare(
    `SELECT id,name,created_at,last_sync_at FROM vaults
     WHERE user_id = ? AND archived_at IS NULL
     ORDER BY created_at ASC`
  ).bind(user.userId).all();

  return json({ vaults: rows.results || [] }, 200, headers);
}

async function handleCreateVault(env, req, headers) {
  const user = await requireUser(env, req);
  const body = await bodyJson(req);

  const createdAt = await getUserCreatedAt(env, user.userId);
  const limits = effectiveLimits(user, createdAt);

  const count = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM vaults WHERE user_id = ? AND archived_at IS NULL`
  ).bind(user.userId).first();

  if ((count?.n || 0) >= limits.vaults) {
    return json({ ok: false, message: 'Vault limit reached for your plan' }, 403, headers);
  }

  const vaultId = id('vlt');
  const name = String(body.name || 'My YANTA Vault').slice(0, 120);

  await env.DB.prepare(
    `INSERT INTO vaults (id,user_id,name,created_at)
     VALUES (?,?,?,?)`
  ).bind(vaultId, user.userId, name, now()).run();

  await audit(env, req, 'vault_created', user.userId, { vaultId });

  return json({
    ok: true,
    vault: {
      id: vaultId,
      name,
      created_at: now()
    }
  }, 200, headers);
}

async function handleListDevices(env, req, url, headers) {
  const user = await requireUser(env, req);

  const vaultId =
    url.searchParams.get('vaultId') ||
    req.headers.get('x-yanta-vault-id') ||
    '';

  const currentDeviceId = req.headers.get('x-yanta-device-id') || '';

  await requireVault(env, user, vaultId);

  /*
    Security:
    Device management is vault-device scoped.
    A removed device must not be able to list devices.
  */
  await requireActiveVaultDevice(env, user, vaultId, currentDeviceId, req);

  const rows = await env.DB.prepare(
    `SELECT id, device_id, name, created_at, last_seen_at, revoked_at,
            user_agent, platform, browser, os, device_type
     FROM devices
     WHERE user_id = ?
       AND vault_id = ?
     ORDER BY revoked_at ASC, last_seen_at DESC, created_at DESC`
  ).bind(user.userId, vaultId).all();

  return json({
    currentDeviceId,
    devices: (rows.results || []).map((d) => {
      const parsed = parseUserAgentInfo(d.user_agent || '', d.platform || '');

      const browser = d.browser || parsed.browser;
      const os = d.os || parsed.os;
      const deviceType = d.device_type || parsed.deviceType;
      const platform = d.platform || parsed.platform;

      return {
        id: d.id,
        deviceId: d.device_id,
        name: d.name || deviceDisplayName(d.device_id, {
          browser,
          os,
          deviceType,
        }),
        createdAt: Number(d.created_at || 0),
        lastSeenAt: Number(d.last_seen_at || 0),
        revokedAt: d.revoked_at ? Number(d.revoked_at) : null,
        active: !d.revoked_at,

        browser,
        os,
        platform,
        deviceType,

        userAgent: d.user_agent || '',
      };
    }),
  }, 200, headers);
}

async function handleRevokeDevice(env, req, url, headers) {
  const user = await requireUser(env, req);

  const vaultId =
    url.searchParams.get('vaultId') ||
    req.headers.get('x-yanta-vault-id') ||
    '';

  const targetDeviceId = url.searchParams.get('deviceId') || '';
  const currentDeviceId = req.headers.get('x-yanta-device-id') || '';

  if (!vaultId || !targetDeviceId) {
    return json({
      ok: false,
      message: 'vaultId and deviceId are required',
    }, 400, headers);
  }

  await requireVault(env, user, vaultId);

  /*
    Security rule:
    A removed/currently unauthorized device cannot remove others.
  */
  await requireActiveVaultDevice(env, user, vaultId, currentDeviceId, req);

  if (targetDeviceId === currentDeviceId) {
    return json({
      ok: false,
      message: 'You cannot remove the current device from this screen.',
    }, 400, headers);
  }

  const target = await env.DB.prepare(
    `SELECT *
     FROM devices
     WHERE user_id = ?
       AND vault_id = ?
       AND device_id = ?`
  ).bind(user.userId, vaultId, targetDeviceId).first();

  if (!target) {
    return json({
      ok: false,
      message: 'Device not found',
    }, 404, headers);
  }

  await env.DB.prepare(
    `UPDATE devices
     SET revoked_at = COALESCE(revoked_at, ?),
         revoked_by_device_id = COALESCE(revoked_by_device_id, ?)
     WHERE user_id = ?
       AND vault_id = ?
       AND device_id = ?`
  ).bind(
    now(),
    currentDeviceId,
    user.userId,
    vaultId,
    targetDeviceId
  ).run();

  await audit(env, req, 'device_revoked', user.userId, {
    vaultId,
    targetDeviceId,
    currentDeviceId,
  });

  return json({ ok: true }, 200, headers);
}

async function vaultAndDeviceFromHeaders(env, req, user) {
  const vaultId = req.headers.get('x-yanta-vault-id') || '';
  const deviceId = req.headers.get('x-yanta-device-id') || '';

  await requireVault(env, user, vaultId);
  await ensureDevice(env, user, vaultId, deviceId, req);

  return { vaultId, deviceId };
}

async function handleStorageList(env, req, url, headers) {
  const user = await requireUser(env, req);
  const { vaultId } = await vaultAndDeviceFromHeaders(env, req, user);

  const prefixRaw = url.searchParams.get('prefix') || '';
  const prefix = normalizeRemotePrefix(prefixRaw);

  /*
    Range-Query statt LIKE:
    - vermeidet LIKE-Sonderzeichen-Probleme
    - ist indexfreundlicher
    - funktioniert gut für prefix-listing
  */
  const upper = prefix + '\uf8ff';

  const rows = await env.DB.prepare(
    `SELECT path,size,etag,updated_at FROM objects
     WHERE user_id = ?
       AND vault_id = ?
       AND path >= ?
       AND path < ?
     ORDER BY path ASC`
  ).bind(
    user.userId,
    vaultId,
    prefix,
    upper
  ).all();

  return json({
    entries: (rows.results || []).map((r) => ({
      path: r.path,
      size: Number(r.size || 0),
      etag: r.etag || '',
      updated: Number(r.updated_at || 0)
    }))
  }, 200, headers);
}

async function handleStorageIndex(env, req, url, headers) {
  const user = await requireUser(env, req);
  const { vaultId } = await vaultAndDeviceFromHeaders(env, req, user);

  /*
    Full remote object index for this vault.

    Why:
    The client can replace hundreds of per-note list(prefix) calls with one
    indexed metadata call, then filter locally.

    Security:
    This returns only encrypted object paths, sizes, etags and timestamps.
    Object paths are provider/internal sync paths. Note/doc/asset ids are
    already HMAC-derived in Sync2.
  */
  const rows = await env.DB.prepare(
    `SELECT path,size,etag,updated_at FROM objects
     WHERE user_id = ?
       AND vault_id = ?
       AND path >= ?
       AND path < ?
     ORDER BY path ASC`
  ).bind(
    user.userId,
    vaultId,
    'yanta-sync-v1/',
    'yanta-sync-v1/\uf8ff'
  ).all();

  return json({
    entries: (rows.results || []).map((r) => ({
      path: r.path,
      size: Number(r.size || 0),
      etag: r.etag || '',
      updated: Number(r.updated_at || 0)
    }))
  }, 200, {
    ...headers,
    'cache-control': 'no-store'
  });
}

async function handleStorageStat(env, req, url, headers) {
  const user = await requireUser(env, req);
  const { vaultId } = await vaultAndDeviceFromHeaders(env, req, user);

  const path = normalizeRemotePath(url.searchParams.get('path') || '');

  const row = await env.DB.prepare(
    `SELECT path,size,etag,updated_at FROM objects
     WHERE user_id = ? AND vault_id = ? AND path = ?`
  ).bind(user.userId, vaultId, path).first();

  return json({
    entry: row ? {
      path: row.path,
      size: row.size,
      etag: row.etag,
      updated: row.updated_at
    } : null
  }, 200, headers);
}

async function handleStorageGet(env, req, url, headers) {
  const user = await requireUser(env, req);
  const { vaultId } = await vaultAndDeviceFromHeaders(env, req, user);

  const path = normalizeRemotePath(url.searchParams.get('path') || '');

  const row = await env.DB.prepare(
    `SELECT path,size,etag,updated_at FROM objects
     WHERE user_id = ? AND vault_id = ? AND path = ?`
  ).bind(user.userId, vaultId, path).first();

  if (!row) {
    return json({ error: 'not_found' }, 404, headers);
  }

  const usage = await ensureUsageRow(env, user.userId);
  const limits = effectiveLimits(user, await getUserCreatedAt(env, user.userId));

  if (usage.download_bytes_month + row.size > limits.downloadBytesMonth) {
    return json({ error: 'download_quota_exceeded' }, 403, headers);
  }

  const obj = await env.OBJECTS.get(r2Key(user.userId, vaultId, path));

  if (!obj) {
    return json({ error: 'object_missing' }, 404, headers);
  }

  await env.DB.prepare(
    `UPDATE usage_current
     SET download_bytes_month = download_bytes_month + ?
     WHERE user_id = ?`
  ).bind(row.size, user.userId).run();

  return new Response(obj.body, {
    status: 200,
    headers: {
      ...headers,
      'content-type': 'application/octet-stream',
      'content-length': String(row.size),
      etag: row.etag || ''
    }
  });
}

async function handleStoragePut(env, req, url, headers) {
  const user = await requireUser(env, req);
  const { vaultId } = await vaultAndDeviceFromHeaders(env, req, user);

  const putBurst = await rateLimit(
    env,
    `storage:put:user:${user.userId}`,
    5000,
    10 * 60 * 1000
  );

  if (!putBurst.ok) {
    return json({
      error: 'write_rate_limited',
      message: 'Too many upload requests. Please wait a few minutes and try again.',
      retryAfterSeconds: 300
    }, 429, {
      ...headers,
      'retry-after': '300'
    });
  }

  const path = normalizeRemotePath(url.searchParams.get('path') || '');
  const ifAbsent = url.searchParams.get('ifAbsent') === '1';

  const body = new Uint8Array(await req.arrayBuffer());
  const size = body.byteLength;

  const createdAt = await getUserCreatedAt(env, user.userId);
  const limits = effectiveLimits(user, createdAt);

  if (size > limits.objectSizeBytes) {
    return json({ error: 'object_too_large', maxBytes: limits.objectSizeBytes }, 413, headers);
  }

  const usage = await ensureUsageRow(env, user.userId);

  const existing = await env.DB.prepare(
    `SELECT id,size FROM objects
     WHERE user_id = ? AND vault_id = ? AND path = ?`
  ).bind(user.userId, vaultId, path).first();

  if (ifAbsent && existing) {
    return json({ error: 'already_exists' }, 409, headers);
  }

  const deltaStorage = existing ? size - existing.size : size;
  const deltaObjects = existing ? 0 : 1;

  if (usage.storage_bytes + deltaStorage > limits.storageBytes) {
    return json({ error: 'storage_quota_exceeded', maxBytes: limits.storageBytes }, 403, headers);
  }

  if (usage.object_count + deltaObjects > limits.objects) {
    return json({ error: 'object_quota_exceeded', maxObjects: limits.objects }, 403, headers);
  }

  if (usage.upload_bytes_day + size > limits.uploadBytesDay) {
    return json({ error: 'upload_day_quota_exceeded', maxBytes: limits.uploadBytesDay }, 403, headers);
  }

  if (usage.writes_today + 1 > limits.writesDay) {
    return json({ error: 'writes_day_quota_exceeded', maxWrites: limits.writesDay }, 403, headers);
  }

const objectKey = r2Key(user.userId, vaultId, path);

if (ifAbsent) {
  const existingR2 = await env.OBJECTS.head(objectKey);

  if (existingR2) {
    return json({ error: 'already_exists' }, 409, headers);
  }
}

const etag = `"${size}-${now()}-${randomToken(6)}"`;
const updatedAt = now();

await env.OBJECTS.put(objectKey, body, {
  httpMetadata: {
    contentType: 'application/octet-stream'
  },
  customMetadata: {
    userId: user.userId,
    vaultId,
    path
  }
});

let actuallyCreated = false;
let actualDeltaStorage = deltaStorage;
let actualDeltaObjects = deltaObjects;

if (existing) {
  await env.DB.prepare(
    `UPDATE objects SET size = ?, etag = ?, updated_at = ?
     WHERE id = ?`
  ).bind(size, etag, updatedAt, existing.id).run();
} else {
  try {
    await env.DB.prepare(
      `INSERT INTO objects
       (id,user_id,vault_id,path,size,etag,updated_at,created_at)
       VALUES (?,?,?,?,?,?,?,?)`
    ).bind(
      id('obj'),
      user.userId,
      vaultId,
      path,
      size,
      etag,
      updatedAt,
      updatedAt
    ).run();

    actuallyCreated = true;
  } catch (err) {
    const msg = String(err?.message || err || '');

    /*
      Race/idempotency case:
      Another request created the metadata row after our existing-check.
      For ifAbsent this should be a normal 409, not a 500.
    */
    if (
      msg.includes('UNIQUE') ||
      msg.includes('constraint') ||
      msg.includes('objects.vault_id') ||
      msg.includes('objects.path')
    ) {
      if (ifAbsent) {
        return json({ error: 'already_exists' }, 409, headers);
      }

      const current = await env.DB.prepare(
        `SELECT id,size FROM objects
         WHERE user_id = ? AND vault_id = ? AND path = ?`
      ).bind(user.userId, vaultId, path).first();

      if (!current) {
        throw err;
      }

      actualDeltaStorage = size - Number(current.size || 0);
      actualDeltaObjects = 0;

      await env.DB.prepare(
        `UPDATE objects SET size = ?, etag = ?, updated_at = ?
         WHERE id = ?`
      ).bind(size, etag, updatedAt, current.id).run();
    } else {
      throw err;
    }
  }
}

await env.DB.prepare(
  `UPDATE usage_current
   SET storage_bytes = storage_bytes + ?,
       object_count = object_count + ?,
       upload_bytes_day = upload_bytes_day + ?,
       upload_bytes_month = upload_bytes_month + ?,
       writes_today = writes_today + 1
   WHERE user_id = ?`
).bind(
  actualDeltaStorage,
  actualDeltaObjects,
  size,
  size,
  user.userId
).run();

  await env.DB.prepare(
    `UPDATE vaults SET last_sync_at = ? WHERE id = ?`
  ).bind(now(), vaultId).run();

  return json({
    ok: true,
    entry: {
      path,
      size,
      etag,
      updated: updatedAt
    }
  }, 200, headers);
}

async function handleStorageDelete(env, req, url, headers) {
  const user = await requireUser(env, req);
  const { vaultId } = await vaultAndDeviceFromHeaders(env, req, user);

  const path = normalizeRemotePath(url.searchParams.get('path') || '');

  const existing = await env.DB.prepare(
    `SELECT id,size FROM objects
     WHERE user_id = ? AND vault_id = ? AND path = ?`
  ).bind(user.userId, vaultId, path).first();

  if (existing) {
    await env.OBJECTS.delete(r2Key(user.userId, vaultId, path));

    await env.DB.prepare(
      `DELETE FROM objects WHERE id = ?`
    ).bind(existing.id).run();

    await env.DB.prepare(
      `UPDATE usage_current
       SET storage_bytes = MAX(0, storage_bytes - ?),
           object_count = MAX(0, object_count - 1),
           writes_today = writes_today + 1
       WHERE user_id = ?`
    ).bind(existing.size, user.userId).run();
  }

  return json({ ok: true }, 200, headers);
}

async function handleUsage(env, req, headers) {
  const user = await requireUser(env, req);
  const usage = await ensureUsageRow(env, user.userId);
  const limits = effectiveLimits(user, await getUserCreatedAt(env, user.userId));

  return json({ usage, limits }, 200, headers);
}

function estimateAiCostMicros(openRouterJson) {
  const usage = openRouterJson?.usage || {};
  const total = Number(usage.total_tokens || usage.prompt_tokens + usage.completion_tokens || 0);

  if (!Number.isFinite(total) || total <= 0) {
    return 1000;
  }

  return Math.max(1000, Math.ceil(total * 5));
}

async function handleAiCompletions(env, req, headers) {
  const user = await requireUser(env, req);
  const usage = await ensureUsageRow(env, user.userId);
  const limits = PLAN_LIMITS[user.plan] || PLAN_LIMITS.free;

  if (!limits.includedAi) {
    return json({
      error: {
        message: 'Included AI is not available on this plan. Use BYOK or upgrade.'
      }
    }, 403, headers);
  }

  if (usage.ai_requests_day + 1 > limits.aiRequestsDay) {
    return json({ error: { message: 'Daily AI request limit reached.' } }, 403, headers);
  }

  if (usage.ai_spend_micros_month >= limits.aiSpendMicrosMonth) {
    return json({ error: { message: 'Monthly included AI limit reached.' } }, 403, headers);
  }

  const body = await bodyJson(req);
  const model = String(body.model || '').trim();

  if (!AI_MODEL_ALLOWLIST.has(model)) {
    return json({ error: { message: 'Model is not allowed for Included AI.' } }, 400, headers);
  }

  const messagesJson = JSON.stringify(body.messages || []);
  if (messagesJson.length > 120000) {
    return json({ error: { message: 'Prompt/context too large.' } }, 413, headers);
  }

  const forwardBody = {
    model,
    messages: body.messages || [],
    temperature: Number(body.temperature ?? 0.2),
    tools: Array.isArray(body.tools) ? body.tools : undefined,
    tool_choice: Array.isArray(body.tools) && body.tools.length ? 'auto' : undefined,
    max_tokens: Math.min(2048, Number(body.max_tokens || 2048))
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  let res;
  let jsonResponse;

  try {
    res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        'content-type': 'application/json',
        'HTTP-Referer': env.OPENROUTER_SITE_URL || env.APP_ORIGIN || '',
        'X-Title': env.OPENROUTER_APP_TITLE || 'YANTA'
      },
      body: JSON.stringify(forwardBody)
    });

    jsonResponse = await res.json().catch(async () => ({
      error: { message: await res.text().catch(() => `HTTP ${res.status}`) }
    }));
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    return json(jsonResponse, res.status, headers);
  }

  const costMicros = estimateAiCostMicros(jsonResponse);

  if (usage.ai_spend_micros_month + costMicros > limits.aiSpendMicrosMonth) {
    return json({ error: { message: 'This request would exceed your included AI budget.' } }, 403, headers);
  }

  const u = jsonResponse.usage || {};

  await env.DB.prepare(
    `UPDATE usage_current
     SET ai_requests_day = ai_requests_day + 1,
         ai_spend_micros_month = ai_spend_micros_month + ?
     WHERE user_id = ?`
  ).bind(costMicros, user.userId).run();

  await env.DB.prepare(
    `INSERT INTO ai_usage_events
     (id,user_id,model,prompt_tokens,completion_tokens,total_tokens,cost_micros,created_at)
     VALUES (?,?,?,?,?,?,?,?)`
  ).bind(
    id('aiu'),
    user.userId,
    model,
    Number(u.prompt_tokens || 0),
    Number(u.completion_tokens || 0),
    Number(u.total_tokens || 0),
    costMicros,
    now()
  ).run();

  return json(jsonResponse, 200, headers);
}

async function route(req, env) {
  const headers = corsHeaders(env, req);

  if (!originAllowed(env, req)) {
    return json({ error: 'origin_not_allowed' }, 403, headers);
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  const url = new URL(req.url);

  try {
    if (url.pathname === '/' || url.pathname === '/healthz') {
      return text('ok\n', 200, headers);
    }

    if (url.pathname === '/api/auth/send-code' && req.method === 'POST') {
      return handleSendCode(env, req, headers);
    }

    if (url.pathname === '/api/auth/verify-code' && req.method === 'POST') {
      return handleVerifyCode(env, req, headers);
    }

    if (url.pathname === '/api/auth/magic' && req.method === 'GET') {
      return handleMagic(env, req, url, headers);
    }

    if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
      return handleLogout(env, req, headers);
    }

    if (url.pathname === '/api/me' && req.method === 'GET') {
      return handleMe(env, req, headers);
    }

    if (url.pathname === '/api/vaults' && req.method === 'GET') {
      return handleListVaults(env, req, headers);
    }

    if (url.pathname === '/api/vaults' && req.method === 'POST') {
      return handleCreateVault(env, req, headers);
    }

    if (url.pathname === '/api/devices' && req.method === 'GET') {
      return handleListDevices(env, req, url, headers);
    }

    if (url.pathname === '/api/devices' && req.method === 'DELETE') {
      return handleRevokeDevice(env, req, url, headers);
    }

    if (url.pathname === '/api/usage' && req.method === 'GET') {
      return handleUsage(env, req, headers);
    }

    if (url.pathname === '/api/storage/index' && req.method === 'GET') {
      return handleStorageIndex(env, req, url, headers);
    }

    if (url.pathname === '/api/storage/list' && req.method === 'GET') {
      return handleStorageList(env, req, url, headers);
    }

    if (url.pathname === '/api/storage/stat' && req.method === 'GET') {
      return handleStorageStat(env, req, url, headers);
    }

    if (url.pathname === '/api/storage/object' && req.method === 'GET') {
      return handleStorageGet(env, req, url, headers);
    }

    if (url.pathname === '/api/storage/object' && req.method === 'PUT') {
      return handleStoragePut(env, req, url, headers);
    }

    if (url.pathname === '/api/storage/object' && req.method === 'DELETE') {
      return handleStorageDelete(env, req, url, headers);
    }

    if (url.pathname === '/api/ai/chat/completions' && req.method === 'POST') {
      return handleAiCompletions(env, req, headers);
    }

    return json({ error: 'not_found' }, 404, headers);
  } catch (err) {
    console.error('[YANTA Cloud Worker]', {
      message: err?.message || String(err),
      stack: err?.stack || '',
      status: err?.status || 500
    });

    return json({
      error: 'internal_error',
      message: err?.message || String(err),
      status: err?.status || 500
    }, err.status || 500, headers);
  }
}

export default {
  fetch(req, env) {
    return route(req, env);
  }
};