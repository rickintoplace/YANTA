var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.js
var PLAN_LIMITS = {
  free: {
    storageBytes: 25 * 1024 * 1024,
    vaults: 1,
    devices: 5,
    objects: 1e4,
    objectSizeBytes: 2 * 1024 * 1024,
    // Backend-internal object transfer.
    // Needs headroom for first sync, retries, snapshots.
    uploadBytesDay: 250 * 1024 * 1024,
    // Real download abuse remains capped.
    downloadBytesMonth: 250 * 1024 * 1024,
    // Internal encrypted object writes.
    // Product/UI can still say "200 app writes/day" if we enforce that separately later.
    writesDay: 8e3,
    includedAi: true,
    aiRequestsDay: 25,
    aiSpendMicrosMonth: 1_000_000,
    rssFetchesDay: 200,
    rssImageBytesDay: 50 * 1024 * 1024,
    rssImageBytesMax: 2 * 1024 * 1024
  },
  premium: {
    storageBytes: 2 * 1024 * 1024 * 1024,
    vaults: 10,
    devices: 20,
    objects: 2e5,
    objectSizeBytes: 100 * 1024 * 1024,
    uploadBytesDay: 5 * 1024 * 1024 * 1024,
    downloadBytesMonth: 50 * 1024 * 1024 * 1024,
    writesDay: 2e4,
    includedAi: true,
    aiRequestsDay: 500,
    aiSpendMicrosMonth: 20_000_000,
    aiSpendMicrosMonth: 5e6,
    rssFetchesDay: 5e3,
    rssImageBytesDay: 2 * 1024 * 1024 * 1024,
    rssImageBytesMax: 5 * 1024 * 1024
  }
};
const INCLUDED_AI_POLICY = {
  free: {
    includedAi: true,

    // Server-authoritative model.
    // Must support OpenRouter ZDR routing.
    model: "deepseek/deepseek-v4-flash",
    modelLabel: "YANTA Cloud Fast (deepseek-v4-flash)",

    aiRequestsDay: 25,
    aiSpendMicrosDay: 150_000,
    aiSpendMicrosMonth: 1_000_000,

    maxPromptChars: 60_000,
    maxToolsChars: 45_000,
    maxMessages: 40,
    maxTokens: 768,

    userBurstPerMinute: 4,
    ipBurstPerMinute: 20
  },

  premium: {
    includedAi: true,

    model: "deepseek/deepseek-v4-flash",
    modelLabel: "YANTA Cloud Fast (deepseek-v4-flash)",

    aiRequestsDay: 500,
    aiSpendMicrosDay: 2_000_000,
    aiSpendMicrosMonth: 20_000_000,

    maxPromptChars: 180_000,
    maxToolsChars: 80_000,
    maxMessages: 80,
    maxTokens: 2048,

    userBurstPerMinute: 20,
    ipBurstPerMinute: 100
  }
};

function includedAiPolicyForPlan(plan = "free") {
  return INCLUDED_AI_POLICY[plan] || INCLUDED_AI_POLICY.free;
}

function jsonSize(value) {
  try {
    return JSON.stringify(value ?? null).length;
  } catch {
    return Infinity;
  }
}

function sanitizeIncludedAiMessageContent(content, policy) {
  if (typeof content === "string" || content == null) {
    return content ?? "";
  }

  if (!Array.isArray(content)) {
    return String(content);
  }

  const parts = [];
  let textChars = 0;
  let imageBytesApprox = 0;

  for (const raw of content.slice(0, 24)) {
    if (!raw || typeof raw !== "object") continue;

    if (raw.type === "text") {
      const text = String(raw.text || "");
      textChars += text.length;

      if (textChars > policy.maxPromptChars) {
        const err = new Error("Prompt/context too large for Included AI.");
        err.status = 413;
        throw err;
      }

      parts.push({
        type: "text",
        text,
      });

      continue;
    }

    if (raw.type === "image_url") {
      const imageUrl = String(raw.image_url?.url || "");

      if (!/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(imageUrl)) {
        continue;
      }

      imageBytesApprox += imageUrl.length;

      if (imageBytesApprox > 7 * 1024 * 1024) {
        const err = new Error("Attached images are too large for Included AI.");
        err.status = 413;
        throw err;
      }

      parts.push({
        type: "image_url",
        image_url: {
          url: imageUrl,
        },
      });
    }
  }

  return parts.length ? parts : "";
}

function sanitizeIncludedAiMessages(messages, policy) {
  if (!Array.isArray(messages)) {
    const err = new Error("messages must be an array");
    err.status = 400;
    throw err;
  }

  if (messages.length > policy.maxMessages) {
    const err = new Error("Too many chat messages.");
    err.status = 413;
    throw err;
  }

  const size = jsonSize(messages);

  if (size > policy.maxPromptChars) {
    const err = new Error("Prompt/context too large for Included AI.");
    err.status = 413;
    throw err;
  }

  return messages.map((m) => {
    const role = ["system", "user", "assistant", "tool"].includes(m?.role)
      ? m.role
      : "user";

    const out = {
      role,
      content: sanitizeIncludedAiMessageContent(m?.content, policy)
    };

    if (m?.tool_call_id) {
      out.tool_call_id = String(m.tool_call_id).slice(0, 160);
    }

    if (m?.name) {
      out.name = String(m.name).slice(0, 160);
    }

    if (Array.isArray(m?.tool_calls)) {
      out.tool_calls = m.tool_calls.slice(0, 16);
    }

    return out;
  });
}

function sanitizeIncludedAiTools(tools, policy) {
  if (!Array.isArray(tools) || !tools.length) return undefined;

  const size = jsonSize(tools);

  if (size > policy.maxToolsChars) {
    const err = new Error("Tool schema too large for Included AI.");
    err.status = 413;
    throw err;
  }

  return tools.slice(0, 32);
}

function openRouterZdrProviderPreferences() {
  return {
    zdr: true
  };
}
var AI_MODEL_ALLOWLIST = /* @__PURE__ */ new Set([
  "google/gemini-2.5-flash-lite",
  "deepseek/deepseek-v4-flash",
  "tencent/hy3-preview",
  "openai/gpt-oss-20b"
]);
var DISPOSABLE_DOMAINS = /* @__PURE__ */ new Set([
  "mailinator.com",
  "10minutemail.com",
  "guerrillamail.com",
  "tempmail.com",
  "temp-mail.org",
  "yopmail.com",
  "trashmail.com",
  "emailondeck.com",
  "fakeinbox.com",
  "maildrop.cc",
  "tempemail.cc",
  "throwaway.email",
  "tempail.email",
  "dispostable.com",
  "sharklasers.com",
  "guerrillamailblock.com",
  "grr.la",
  "mailnesia.com",
  "tempinbox.com",
  "getnada.com",
  "mohmal.com"
]);
function now() {
  return Date.now();
}
__name(now, "now");
function safeErrorForLog(err) {
  return {
    message: err?.message || String(err),
    status: err?.status || 500,
    code: err?.code || err?.serverCode || "",
    stack: err?.stack || ""
  };
}
function monthKey(ts = now()) {
  return new Date(ts).toISOString().slice(0, 7);
}
__name(monthKey, "monthKey");
function dayKey(ts = now()) {
  return new Date(ts).toISOString().slice(0, 10);
}
__name(dayKey, "dayKey");
function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers
    }
  });
}
__name(json, "json");
function text(data, status = 200, headers = {}) {
  return new Response(String(data), {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      ...headers
    }
  });
}
__name(text, "text");
function base64url(bytes) {
  let bin = "";
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
__name(base64url, "base64url");
function randomToken(bytes = 32) {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return base64url(b);
}
__name(randomToken, "randomToken");
function id(prefix) {
  return `${prefix}_${randomToken(18)}`;
}
__name(id, "id");
function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}
__name(normalizeEmail, "normalizeEmail");
function emailDomain(email) {
  return normalizeEmail(email).split("@")[1] || "";
}
__name(emailDomain, "emailDomain");
function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
__name(validEmail, "validEmail");
async function hmacHex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(hmacHex, "hmacHex");
async function hashToken(env, token) {
  return hmacHex(env.SESSION_SECRET, token);
}
__name(hashToken, "hashToken");
function clientIp(req) {
  return req.headers.get("cf-connecting-ip") || "0.0.0.0";
}
__name(clientIp, "clientIp");
async function ipHash(env, req) {
  return hmacHex(env.SESSION_SECRET, clientIp(req));
}
__name(ipHash, "ipHash");
function parseCookies(req) {
  const raw = req.headers.get("cookie") || "";
  const out = {};
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}
__name(parseCookies, "parseCookies");
function cookieHeader(env, token, maxAgeSeconds) {
  const name = env.COOKIE_NAME || "yanta_cloud_session";
  const domain = env.COOKIE_DOMAIN ? `; Domain=${env.COOKIE_DOMAIN}` : "";
  return [
    `${name}=${encodeURIComponent(token)}`,
    `Max-Age=${maxAgeSeconds}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    domain
  ].filter(Boolean).join("; ");
}
__name(cookieHeader, "cookieHeader");
function clearCookieHeader(env) {
  const name = env.COOKIE_NAME || "yanta_cloud_session";
  const domain = env.COOKIE_DOMAIN ? `; Domain=${env.COOKIE_DOMAIN}` : "";
  return `${name}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax${domain}`;
}
__name(clearCookieHeader, "clearCookieHeader");
function allowedOrigins(env) {
  const raw = [
    env.APP_ORIGIN || "",
    env.ALLOWED_ORIGINS || ""
  ].filter(Boolean).join(",");
  return new Set(
    raw.split(",").map((s) => s.trim()).filter(Boolean).map((s) => s.replace(/\/+$/, ""))
  );
}
__name(allowedOrigins, "allowedOrigins");
function corsHeaders(env, req) {
  const origin = (req.headers.get("origin") || "").replace(/\/+$/, "");
  const allowed = allowedOrigins(env);
  if (!origin) return {};
  if (allowed.size && !allowed.has(origin)) {
    return {};
  }
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,x-yanta-vault-id,x-yanta-device-id,x-yanta-platform,x-csrf-token",
    "access-control-allow-credentials": "true",
    "access-control-max-age": "86400",
    vary: "Origin"
  };
}
__name(corsHeaders, "corsHeaders");
function originAllowed(env, req) {
  const origin = (req.headers.get("origin") || "").replace(/\/+$/, "");
  if (!origin) return true;
  const allowed = allowedOrigins(env);
  if (!allowed.size) return true;
  return allowed.has(origin);
}
__name(originAllowed, "originAllowed");
async function bodyJson(req) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}
__name(bodyJson, "bodyJson");
async function audit(env, req, kind, userId = null, meta = {}) {
  try {
    await env.DB.prepare(
      `INSERT INTO audit_events (id,user_id,kind,ip_hash,meta_json,created_at)
       VALUES (?,?,?,?,?,?)`
    ).bind(
      id("aud"),
      userId,
      kind,
      await ipHash(env, req),
      JSON.stringify(meta || {}),
      now()
    ).run();
  } catch {
  }
}
__name(audit, "audit");
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
__name(rateLimit, "rateLimit");
async function verifyTurnstile(env, token, req) {
  if (!env.TURNSTILE_SECRET_KEY) return true;
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET_KEY);
  form.append("response", token || "");
  form.append("remoteip", clientIp(req));
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: form
  });
  const data = await res.json().catch(() => null);
  return !!data?.success;
}
__name(verifyTurnstile, "verifyTurnstile");
async function sendLoginEmail(env, { email, code, magicUrl }) {
  if (!env.RESEND_API_KEY) {
    console.log("[DEV] Login code:", email, code, magicUrl);
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
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      from: env.FROM_EMAIL,
      to: email,
      subject: "Your YANTA login code",
      html
    })
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`Resend failed: ${res.status} ${msg}`);
  }
}
__name(sendLoginEmail, "sendLoginEmail");
async function getSession(env, req) {
  const cookies = parseCookies(req);
  const token = cookies[env.COOKIE_NAME || "yanta_cloud_session"];
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
    plan: row.plan || "free"
  };
}
__name(getSession, "getSession");
async function requireUser(env, req) {
  const user = await getSession(env, req);
  if (!user) {
    const err = new Error("Authentication required");
    err.status = 401;
    throw err;
  }
  return user;
}
__name(requireUser, "requireUser");
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
      SET ai_day_key = ?,
          ai_requests_day = 0,
          ai_spend_micros_day = 0
      WHERE user_id = ?`
    ).bind(d, userId).run();
  }
  return await env.DB.prepare(
    `SELECT * FROM usage_current WHERE user_id = ?`
  ).bind(userId).first();
}
__name(ensureUsageRow, "ensureUsageRow");
function effectiveLimits(user, createdAt = 0) {
  const base = PLAN_LIMITS[user.plan] || PLAN_LIMITS.free;
  return base;
}
__name(effectiveLimits, "effectiveLimits");
async function getUserCreatedAt(env, userId) {
  const row = await env.DB.prepare(
    `SELECT created_at FROM users WHERE id = ?`
  ).bind(userId).first();
  return row?.created_at || 0;
}
__name(getUserCreatedAt, "getUserCreatedAt");
function normalizeRemotePath(raw) {
  let p = String(raw || "").replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/").trim();
  const parts = [];
  for (const part of p.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") throw new Error("Path must not contain ..");
    if (part.includes("\0")) throw new Error("Path contains NUL");
    parts.push(part);
  }
  p = parts.join("/");
  if (!p) throw new Error("Path must not be empty");
  if (!p.startsWith("yanta-sync-v1/")) {
    throw new Error("Path outside YANTA sync namespace");
  }
  return p;
}
__name(normalizeRemotePath, "normalizeRemotePath");
function normalizeRemotePrefix(raw) {
  const s = String(raw || "").trim();
  if (!s) {
    return "yanta-sync-v1/";
  }
  let p = s.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/").trim();
  const hadTrailingSlash = p.endsWith("/");
  const parts = [];
  for (const part of p.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      throw new Error("Prefix must not contain ..");
    }
    if (part.includes("\0")) {
      throw new Error("Prefix contains NUL");
    }
    parts.push(part);
  }
  p = parts.join("/");
  if (!p) {
    return "yanta-sync-v1/";
  }
  if (!p.startsWith("yanta-sync-v1")) {
    throw new Error("Prefix outside YANTA sync namespace");
  }
  if (hadTrailingSlash && !p.endsWith("/")) {
    p += "/";
  }
  return p;
}
__name(normalizeRemotePrefix, "normalizeRemotePrefix");
function r2Key(userId, vaultId, remotePath) {
  return `users/${userId}/vaults/${vaultId}/${remotePath}`;
}
__name(r2Key, "r2Key");
async function requireVault(env, user, vaultId) {
  const v = await env.DB.prepare(
    `SELECT * FROM vaults WHERE id = ? AND user_id = ? AND archived_at IS NULL`
  ).bind(vaultId, user.userId).first();
  if (!v) {
    const err = new Error("Vault not found");
    err.status = 404;
    throw err;
  }
  return v;
}
__name(requireVault, "requireVault");
function cleanHeaderValue(value = "") {
  return String(value || "").trim().replace(/^"|"$/g, "").slice(0, 300);
}
__name(cleanHeaderValue, "cleanHeaderValue");
function parseUserAgentInfo(userAgent = "", platformHint = "") {
  const ua = String(userAgent || "");
  const platform = cleanHeaderValue(platformHint);
  let browser = "Unknown browser";
  if (/Edg\//i.test(ua)) browser = "Microsoft Edge";
  else if (/OPR\//i.test(ua) || /Opera/i.test(ua)) browser = "Opera";
  else if (/Firefox\//i.test(ua)) browser = "Firefox";
  else if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) browser = "Chrome";
  else if (/CriOS\//i.test(ua)) browser = "Chrome iOS";
  else if (/Safari\//i.test(ua) && /Version\//i.test(ua)) browser = "Safari";
  let os = platform || "Unknown OS";
  if (/iPhone|iPad|iPod/i.test(ua)) os = "iOS";
  else if (/Android/i.test(ua)) os = "Android";
  else if (/Windows NT/i.test(ua)) os = "Windows";
  else if (/Mac OS X|Macintosh/i.test(ua)) os = "macOS";
  else if (/Linux/i.test(ua)) os = "Linux";
  let deviceType = "Desktop";
  if (/iPad|Tablet/i.test(ua)) {
    deviceType = "Tablet";
  } else if (/Mobile|iPhone|Android/i.test(ua)) {
    deviceType = "Phone";
  }
  return {
    browser,
    os,
    deviceType,
    platform: platform || os
  };
}
__name(parseUserAgentInfo, "parseUserAgentInfo");
function deviceInfoFromRequest(req) {
  const userAgent = cleanHeaderValue(req.headers.get("user-agent") || "");
  const platformHint = cleanHeaderValue(
    req.headers.get("sec-ch-ua-platform") || req.headers.get("x-yanta-platform") || ""
  );
  return {
    userAgent,
    ...parseUserAgentInfo(userAgent, platformHint)
  };
}
__name(deviceInfoFromRequest, "deviceInfoFromRequest");
function deviceDisplayName(deviceId, info = {}) {
  const parts = [
    info.deviceType,
    info.browser,
    info.os
  ].filter(Boolean).filter((x) => !/^Unknown/i.test(x));
  return parts.length ? parts.join(" \xB7 ") : String(deviceId || "Device");
}
__name(deviceDisplayName, "deviceDisplayName");
async function requireActiveVaultDevice(env, user, vaultId, deviceId, req = null) {
  if (!deviceId) {
    const err = new Error("Current device id missing");
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
    const err = new Error("Current device is not registered for this vault");
    err.status = 403;
    throw err;
  }
  if (row.revoked_at) {
    const err = new Error("This device was removed from this vault");
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
      info.userAgent || "",
      info.platform || "",
      info.browser || "",
      info.os || "",
      info.deviceType || "",
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
__name(requireActiveVaultDevice, "requireActiveVaultDevice");
async function ensureDevice(env, user, vaultId, deviceId, req = null) {
  if (!deviceId) {
    const err = new Error("Device id missing");
    err.status = 400;
    throw err;
  }
  const info = req ? deviceInfoFromRequest(req) : {
    userAgent: "",
    platform: "",
    browser: "",
    os: "",
    deviceType: ""
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
      const err = new Error("Device revoked");
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
      info.userAgent || "",
      info.platform || "",
      info.browser || "",
      info.os || "",
      info.deviceType || "",
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
    const err = new Error("Device limit reached for your plan");
    err.status = 403;
    throw err;
  }
  const rec = {
    id: id("dev"),
    user_id: user.userId,
    vault_id: vaultId,
    device_id: deviceId,
    name: deviceDisplayName(deviceId, info),
    created_at: now(),
    last_seen_at: now()
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
    info.userAgent || "",
    info.platform || "",
    info.browser || "",
    info.os || "",
    info.deviceType || ""
  ).run();
  return rec;
}
__name(ensureDevice, "ensureDevice");
async function handleSendCode(env, req, headers) {
  const body = await bodyJson(req);
  const email = normalizeEmail(body.email);
  const turnstileToken = body.turnstileToken || "";
  const generic = {
    ok: true,
    message: "If this address can receive mail, we sent a code."
  };
  const ipH = await ipHash(env, req);
  await audit(env, req, "auth_send_code_attempt", null, { emailDomain: emailDomain(email) });
  const ipLimit = await rateLimit(env, `auth:send:ip:${ipH}`, 5, 60 * 60 * 1e3);
  const emailLimit = await rateLimit(env, `auth:send:email:${email}`, 3, 30 * 60 * 1e3);
  const pairLimit = await rateLimit(env, `auth:send:pair:${ipH}:${email}`, 3, 60 * 60 * 1e3);
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
  const code = String(Math.floor(1e5 + Math.random() * 9e5));
  const magicToken = randomToken(32);
  const codeHash = await hmacHex(env.SESSION_SECRET, `code:${email}:${code}`);
  const magicHash = await hmacHex(env.SESSION_SECRET, `magic:${magicToken}`);
  const challengeId = id("otp");
  const expiresAt = now() + 10 * 60 * 1e3;
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
  const publicApiBaseUrl = String(env.PUBLIC_API_BASE_URL || new URL(req.url).origin).replace(/\/+$/, "");
  const magicUrl = `${publicApiBaseUrl}/api/auth/magic?token=${encodeURIComponent(magicToken)}`;
  await sendLoginEmail(env, { email, code, magicUrl });
  await audit(env, req, "auth_send_code_sent", null, { emailDomain: emailDomain(email) });
  return json(generic, 200, headers);
}
__name(handleSendCode, "handleSendCode");
async function createSession(env, req, userId, headers) {
  const token = randomToken(32);
  const tokenHash = await hashToken(env, token);
  const sessionId = id("ses");
  const expiresAt = now() + 90 * 24 * 60 * 60 * 1e3;
  await env.DB.prepare(
    `INSERT INTO sessions
     (id,user_id,token_hash,user_agent,ip_hash,created_at,expires_at)
     VALUES (?,?,?,?,?,?,?)`
  ).bind(
    sessionId,
    userId,
    tokenHash,
    req.headers.get("user-agent") || "",
    await ipHash(env, req),
    now(),
    expiresAt
  ).run();
  return {
    "set-cookie": cookieHeader(env, token, 90 * 24 * 60 * 60),
    ...headers
  };
}
__name(createSession, "createSession");
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
  const userId = id("usr");
  await env.DB.prepare(
    `INSERT INTO users (id,email,email_verified,plan,created_at,last_seen_at)
     VALUES (?,?,?,?,?,?)`
  ).bind(userId, email, 1, "free", now(), now()).run();
  await ensureUsageRow(env, userId);
  return await env.DB.prepare(
    `SELECT * FROM users WHERE id = ?`
  ).bind(userId).first();
}
__name(getOrCreateUser, "getOrCreateUser");
async function handleVerifyCode(env, req, headers) {
  const body = await bodyJson(req);
  const email = normalizeEmail(body.email);
  const code = String(body.code || "").trim();
  if (!validEmail(email) || !/^\d{6}$/.test(code)) {
    return json({ ok: false, message: "Invalid code" }, 400, headers);
  }
  const ipH = await ipHash(env, req);
  const rl = await rateLimit(env, `auth:verify:ip:${ipH}`, 30, 60 * 60 * 1e3);
  if (!rl.ok) {
    return json({ ok: false, message: "Too many attempts" }, 429, headers);
  }
  const challenge = await env.DB.prepare(
    `SELECT * FROM login_challenges
     WHERE email = ? AND used_at IS NULL
     ORDER BY created_at DESC
     LIMIT 1`
  ).bind(email).first();
  if (!challenge || challenge.expires_at < now()) {
    return json({ ok: false, message: "Code expired" }, 400, headers);
  }
  if (challenge.attempts >= 5) {
    return json({ ok: false, message: "Too many attempts" }, 400, headers);
  }
  const expected = await hmacHex(env.SESSION_SECRET, `code:${email}:${code}`);
  if (expected !== challenge.code_hash) {
    await env.DB.prepare(
      `UPDATE login_challenges SET attempts = attempts + 1 WHERE id = ?`
    ).bind(challenge.id).run();
    return json({ ok: false, message: "Invalid code" }, 400, headers);
  }
  await env.DB.prepare(
    `UPDATE login_challenges SET used_at = ? WHERE id = ?`
  ).bind(now(), challenge.id).run();
  const user = await getOrCreateUser(env, email);
  const responseHeaders = await createSession(env, req, user.id, headers);
  await audit(env, req, "auth_login_code_success", user.id, {});
  return json({
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      plan: user.plan
    }
  }, 200, responseHeaders);
}
__name(handleVerifyCode, "handleVerifyCode");
async function handleMagic(env, req, url, headers) {
  const token = url.searchParams.get("token") || "";
  const appOrigin = env.APP_ORIGIN || "http://localhost:5173";
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
__name(handleMagic, "handleMagic");
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
    limits: {
      ...(PLAN_LIMITS[user.plan] || PLAN_LIMITS.free),
      includedAi: includedAiPolicyForPlan(user.plan).includedAi,
      aiRequestsDay: includedAiPolicyForPlan(user.plan).aiRequestsDay,
      aiSpendMicrosDay: includedAiPolicyForPlan(user.plan).aiSpendMicrosDay,
      aiSpendMicrosMonth: includedAiPolicyForPlan(user.plan).aiSpendMicrosMonth,
    }
  }, 200, headers);
}
__name(handleMe, "handleMe");
async function handleLogout(env, req, headers) {
  const cookies = parseCookies(req);
  const token = cookies[env.COOKIE_NAME || "yanta_cloud_session"];
  if (token) {
    const tokenHash = await hashToken(env, token);
    await env.DB.prepare(
      `UPDATE sessions SET revoked_at = ? WHERE token_hash = ?`
    ).bind(now(), tokenHash).run();
  }
  return json({ ok: true }, 200, {
    ...headers,
    "set-cookie": clearCookieHeader(env)
  });
}
__name(handleLogout, "handleLogout");
async function handleListVaults(env, req, headers) {
  const user = await requireUser(env, req);
  const rows = await env.DB.prepare(
    `SELECT id,name,created_at,last_sync_at FROM vaults
     WHERE user_id = ? AND archived_at IS NULL
     ORDER BY created_at ASC`
  ).bind(user.userId).all();
  return json({ vaults: rows.results || [] }, 200, headers);
}
__name(handleListVaults, "handleListVaults");
async function handleCreateVault(env, req, headers) {
  const user = await requireUser(env, req);
  const body = await bodyJson(req);
  const createdAt = await getUserCreatedAt(env, user.userId);
  const limits = effectiveLimits(user, createdAt);
  const count = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM vaults WHERE user_id = ? AND archived_at IS NULL`
  ).bind(user.userId).first();
  if ((count?.n || 0) >= limits.vaults) {
    return json({ ok: false, message: "Vault limit reached for your plan" }, 403, headers);
  }
  const vaultId = id("vlt");
  const name = String(body.name || "My YANTA Vault").slice(0, 120);
  await env.DB.prepare(
    `INSERT INTO vaults (id,user_id,name,created_at)
     VALUES (?,?,?,?)`
  ).bind(vaultId, user.userId, name, now()).run();
  await audit(env, req, "vault_created", user.userId, { vaultId });
  return json({
    ok: true,
    vault: {
      id: vaultId,
      name,
      created_at: now()
    }
  }, 200, headers);
}
__name(handleCreateVault, "handleCreateVault");
async function handleListDevices(env, req, url, headers) {
  const user = await requireUser(env, req);
  const vaultId = url.searchParams.get("vaultId") || req.headers.get("x-yanta-vault-id") || "";
  const currentDeviceId = req.headers.get("x-yanta-device-id") || "";
  await requireVault(env, user, vaultId);
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
      const parsed = parseUserAgentInfo(d.user_agent || "", d.platform || "");
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
          deviceType
        }),
        createdAt: Number(d.created_at || 0),
        lastSeenAt: Number(d.last_seen_at || 0),
        revokedAt: d.revoked_at ? Number(d.revoked_at) : null,
        active: !d.revoked_at,
        browser,
        os,
        platform,
        deviceType,
        userAgent: d.user_agent || ""
      };
    })
  }, 200, headers);
}
__name(handleListDevices, "handleListDevices");
async function handleRevokeDevice(env, req, url, headers) {
  const user = await requireUser(env, req);
  const vaultId = url.searchParams.get("vaultId") || req.headers.get("x-yanta-vault-id") || "";
  const targetDeviceId = url.searchParams.get("deviceId") || "";
  const currentDeviceId = req.headers.get("x-yanta-device-id") || "";
  if (!vaultId || !targetDeviceId) {
    return json({
      ok: false,
      message: "vaultId and deviceId are required"
    }, 400, headers);
  }
  await requireVault(env, user, vaultId);
  await requireActiveVaultDevice(env, user, vaultId, currentDeviceId, req);
  if (targetDeviceId === currentDeviceId) {
    return json({
      ok: false,
      message: "You cannot remove the current device from this screen."
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
      message: "Device not found"
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
  await audit(env, req, "device_revoked", user.userId, {
    vaultId,
    targetDeviceId,
    currentDeviceId
  });
  return json({ ok: true }, 200, headers);
}
__name(handleRevokeDevice, "handleRevokeDevice");
async function vaultAndDeviceFromHeaders(env, req, user) {
  const vaultId = req.headers.get("x-yanta-vault-id") || "";
  const deviceId = req.headers.get("x-yanta-device-id") || "";
  await requireVault(env, user, vaultId);
  await ensureDevice(env, user, vaultId, deviceId, req);
  return { vaultId, deviceId };
}
__name(vaultAndDeviceFromHeaders, "vaultAndDeviceFromHeaders");
async function handleStorageList(env, req, url, headers) {
  const user = await requireUser(env, req);
  const { vaultId } = await vaultAndDeviceFromHeaders(env, req, user);
  const prefixRaw = url.searchParams.get("prefix") || "";
  const prefix = normalizeRemotePrefix(prefixRaw);
  const upper = prefix + "\uF8FF";
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
      etag: r.etag || "",
      updated: Number(r.updated_at || 0)
    }))
  }, 200, headers);
}
__name(handleStorageList, "handleStorageList");
async function handleStorageIndex(env, req, url, headers) {
  const user = await requireUser(env, req);
  const { vaultId } = await vaultAndDeviceFromHeaders(env, req, user);
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
    "yanta-sync-v1/",
    "yanta-sync-v1/\uF8FF"
  ).all();
  return json({
    entries: (rows.results || []).map((r) => ({
      path: r.path,
      size: Number(r.size || 0),
      etag: r.etag || "",
      updated: Number(r.updated_at || 0)
    }))
  }, 200, {
    ...headers,
    "cache-control": "no-store"
  });
}
__name(handleStorageIndex, "handleStorageIndex");
async function handleStorageBreakdown(env, req, url, headers) {
  const user = await requireUser(env, req);

  const vaultId =
    url.searchParams.get("vaultId") ||
    req.headers.get("x-yanta-vault-id") ||
    "";

  const currentDeviceId = req.headers.get("x-yanta-device-id") || "";

  await requireVault(env, user, vaultId);
  await requireActiveVaultDevice(env, user, vaultId, currentDeviceId, req);

  const rows = await env.DB.prepare(
    `SELECT
       CASE
         WHEN path LIKE 'yanta-sync-v1/vault/heads/%' THEN 'vault heads'
         WHEN path LIKE 'yanta-sync-v1/vault/updates/%' THEN 'vault updates'
         WHEN path LIKE 'yanta-sync-v1/vault/snapshots/%' THEN 'vault snapshots'
         WHEN path LIKE 'yanta-sync-v1/docs/%/heads/%' THEN 'note heads'
         WHEN path LIKE 'yanta-sync-v1/docs/%/updates/%' THEN 'note updates'
         WHEN path LIKE 'yanta-sync-v1/docs/%/snapshots/%' THEN 'note snapshots'
         WHEN path LIKE 'yanta-sync-v1/assets/%' THEN 'assets'
         ELSE 'other'
       END AS group_name,
       COUNT(*) AS object_count,
       COALESCE(SUM(size), 0) AS bytes
     FROM objects
     WHERE user_id = ?
       AND vault_id = ?
       AND path >= ?
       AND path < ?
     GROUP BY group_name
     ORDER BY bytes DESC`
  ).bind(
    user.userId,
    vaultId,
    "yanta-sync-v1/",
    "yanta-sync-v1/\uF8FF"
  ).all();

  const groups = (rows.results || []).map((row) => ({
    group: row.group_name,
    count: Number(row.object_count || 0),
    bytes: Number(row.bytes || 0),
  }));

  const total = groups.reduce((sum, group) => sum + Number(group.bytes || 0), 0);
  const objectCount = groups.reduce((sum, group) => sum + Number(group.count || 0), 0);

  return json({
    vaultId,
    totalBytes: total,
    objectCount,
    groups,
  }, 200, {
    ...headers,
    "cache-control": "no-store",
  });
}

async function handleStorageStat(env, req, url, headers) {
  const user = await requireUser(env, req);
  const { vaultId } = await vaultAndDeviceFromHeaders(env, req, user);
  const path = normalizeRemotePath(url.searchParams.get("path") || "");
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
__name(handleStorageStat, "handleStorageStat");
async function handleStorageGet(env, req, url, headers) {
  const user = await requireUser(env, req);
  const { vaultId } = await vaultAndDeviceFromHeaders(env, req, user);
  const path = normalizeRemotePath(url.searchParams.get("path") || "");
  const row = await env.DB.prepare(
    `SELECT path,size,etag,updated_at FROM objects
     WHERE user_id = ? AND vault_id = ? AND path = ?`
  ).bind(user.userId, vaultId, path).first();
  if (!row) {
    return json({ error: "not_found" }, 404, headers);
  }
  const usage = await ensureUsageRow(env, user.userId);
  const limits = effectiveLimits(user, await getUserCreatedAt(env, user.userId));
  if (usage.download_bytes_month + row.size > limits.downloadBytesMonth) {
    return json({ error: "download_quota_exceeded" }, 403, headers);
  }
  const obj = await env.OBJECTS.get(r2Key(user.userId, vaultId, path));
  if (!obj) {
    return json({ error: "object_missing" }, 404, headers);
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
      "content-type": "application/octet-stream",
      "content-length": String(row.size),
      etag: row.etag || ""
    }
  });
}
__name(handleStorageGet, "handleStorageGet");
async function handleStoragePut(env, req, url, headers) {
  const user = await requireUser(env, req);
  const { vaultId } = await vaultAndDeviceFromHeaders(env, req, user);
  const putBurst = await rateLimit(
    env,
    `storage:put:user:${user.userId}`,
    5e3,
    10 * 60 * 1e3
  );
  if (!putBurst.ok) {
    return json({
      error: "write_rate_limited",
      message: "Too many upload requests. Please wait a few minutes and try again.",
      retryAfterSeconds: 300
    }, 429, {
      ...headers,
      "retry-after": "300"
    });
  }
  const path = normalizeRemotePath(url.searchParams.get("path") || "");
  const ifAbsent = url.searchParams.get("ifAbsent") === "1";
  const body = new Uint8Array(await req.arrayBuffer());
  const size = body.byteLength;
  const createdAt = await getUserCreatedAt(env, user.userId);
  const limits = effectiveLimits(user, createdAt);
  if (size > limits.objectSizeBytes) {
    return json({ error: "object_too_large", maxBytes: limits.objectSizeBytes }, 413, headers);
  }
  const usage = await ensureUsageRow(env, user.userId);
  const existing = await env.DB.prepare(
    `SELECT id,size FROM objects
     WHERE user_id = ? AND vault_id = ? AND path = ?`
  ).bind(user.userId, vaultId, path).first();
  if (ifAbsent && existing) {
    return json({ error: "already_exists" }, 409, headers);
  }
  const deltaStorage = existing ? size - existing.size : size;
  const deltaObjects = existing ? 0 : 1;
  if (usage.storage_bytes + deltaStorage > limits.storageBytes) {
    return json({ error: "storage_quota_exceeded", maxBytes: limits.storageBytes }, 403, headers);
  }
  if (usage.object_count + deltaObjects > limits.objects) {
    return json({ error: "object_quota_exceeded", maxObjects: limits.objects }, 403, headers);
  }
  if (usage.upload_bytes_day + size > limits.uploadBytesDay) {
    return json({ error: "upload_day_quota_exceeded", maxBytes: limits.uploadBytesDay }, 403, headers);
  }
  if (usage.writes_today + 1 > limits.writesDay) {
    return json({ error: "writes_day_quota_exceeded", maxWrites: limits.writesDay }, 403, headers);
  }
  const objectKey = r2Key(user.userId, vaultId, path);
  if (ifAbsent) {
    const existingR2 = await env.OBJECTS.head(objectKey);
    if (existingR2) {
      return json({ error: "already_exists" }, 409, headers);
    }
  }
  const etag = `"${size}-${now()}-${randomToken(6)}"`;
  const updatedAt = now();
  await env.OBJECTS.put(objectKey, body, {
    httpMetadata: {
      contentType: "application/octet-stream"
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
        id("obj"),
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
      const msg = String(err?.message || err || "");
      if (msg.includes("UNIQUE") || msg.includes("constraint") || msg.includes("objects.vault_id") || msg.includes("objects.path")) {
        if (ifAbsent) {
          return json({ error: "already_exists" }, 409, headers);
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
__name(handleStoragePut, "handleStoragePut");
async function handleStorageDelete(env, req, url, headers) {
  const user = await requireUser(env, req);
  const { vaultId } = await vaultAndDeviceFromHeaders(env, req, user);
  const path = normalizeRemotePath(url.searchParams.get("path") || "");
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
__name(handleStorageDelete, "handleStorageDelete");
async function handleUsage(env, req, headers) {
  const user = await requireUser(env, req);
  const usage = await ensureUsageRow(env, user.userId);
  const limits = effectiveLimits(user, await getUserCreatedAt(env, user.userId));
  return json({ usage, limits }, 200, headers);
}
__name(handleUsage, "handleUsage");
function estimateAiCostMicros(openRouterJson) {
  const usage = openRouterJson?.usage || {};

  const total = Number(
    usage.total_tokens ||
    Number(usage.prompt_tokens || 0) + Number(usage.completion_tokens || 0) ||
    0
  );

  if (!Number.isFinite(total) || total <= 0) {
    return 1_000;
  }

  // Conservative internal credit accounting.
  // This is not exact OpenRouter billing; it is an abuse-control credit meter.
  return Math.max(1_000, Math.ceil(total * 5));
}
__name(estimateAiCostMicros, "estimateAiCostMicros");
async function handleAiCompletions(env, req, headers) {
  const user = await requireUser(env, req);
  const usage = await ensureUsageRow(env, user.userId);

  const policy = includedAiPolicyForPlan(user.plan);

  if (!policy.includedAi) {
    return json({
      error: {
        message: "Included AI is not available on this plan. Use BYOK or upgrade."
      }
    }, 403, headers);
  }

  if (!env.OPENROUTER_API_KEY) {
    return json({
      error: {
        message: "Included AI is temporarily unavailable."
      }
    }, 503, headers);
  }

  const body = await bodyJson(req);

  const requestedModel = String(body.model || policy.model || "").trim();
  const selectedModel = AI_MODEL_ALLOWLIST.has(requestedModel)
    ? requestedModel
    : "";

  if (!selectedModel) {
    return json({
      error: {
        message: "Model is not allowed for Included AI."
      }
    }, 400, headers);
  }

  const ipH = await ipHash(env, req);

  const userBurst = await rateLimit(
    env,
    `ai:burst:user:${user.userId}`,
    policy.userBurstPerMinute,
    60 * 1000
  );

  if (!userBurst.ok) {
    return json({
      error: {
        message: "Included AI is being used too quickly. Please wait a moment."
      }
    }, 429, {
      ...headers,
      "retry-after": "60"
    });
  }

  const ipBurst = await rateLimit(
    env,
    `ai:burst:ip:${ipH}`,
    policy.ipBurstPerMinute,
    60 * 1000
  );

  if (!ipBurst.ok) {
    return json({
      error: {
        message: "Too many AI requests from this network. Please wait a moment."
      }
    }, 429, {
      ...headers,
      "retry-after": "60"
    });
  }

  if (Number(usage.ai_requests_day || 0) + 1 > policy.aiRequestsDay) {
    return json({
      error: {
        message: "Daily Included AI request limit reached."
      }
    }, 403, headers);
  }

  if (Number(usage.ai_spend_micros_day || 0) >= policy.aiSpendMicrosDay) {
    return json({
      error: {
        message: "Daily Included AI credits reached."
      }
    }, 403, headers);
  }

  if (Number(usage.ai_spend_micros_month || 0) >= policy.aiSpendMicrosMonth) {
    return json({
      error: {
        message: "Monthly Included AI credits reached."
      }
    }, 403, headers);
  }

  let messages;
  let tools;

  try {
    messages = sanitizeIncludedAiMessages(body.messages || [], policy);
    tools = sanitizeIncludedAiTools(body.tools, policy);
  } catch (err) {
    return json({
      error: {
        message: err?.message || "Invalid Included AI request."
      }
    }, err?.status || 400, headers);
  }

  const forwardBody = {
    // Authoritative server-side model.
    // Client model is intentionally ignored.
    model: selectedModel,

    messages,

    temperature: Math.max(
      0,
      Math.min(1, Number(body.temperature ?? 0.2))
    ),

    tools,
    tool_choice: Array.isArray(tools) && tools.length ? "auto" : undefined,

    max_tokens: Math.min(
      policy.maxTokens,
      Math.max(1, Number(body.max_tokens || policy.maxTokens))
    ),

    // OpenRouter Zero Data Retention routing.
    provider: openRouterZdrProviderPreferences()
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  let res;
  let jsonResponse;

  try {
    res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        "content-type": "application/json",
        "HTTP-Referer": env.OPENROUTER_SITE_URL || env.APP_ORIGIN || "",
        "X-Title": env.OPENROUTER_APP_TITLE || "YANTA"
      },
      body: JSON.stringify(forwardBody)
    });

    jsonResponse = await res.json().catch(async () => ({
      error: {
        message: await res.text().catch(() => `HTTP ${res.status}`)
      }
    }));
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    // Do not add request payload to logs or audit events.
    return json(jsonResponse, res.status, headers);
  }

  const costMicros = estimateAiCostMicros(jsonResponse);

  if (
    Number(usage.ai_spend_micros_day || 0) + costMicros > policy.aiSpendMicrosDay ||
    Number(usage.ai_spend_micros_month || 0) + costMicros > policy.aiSpendMicrosMonth
  ) {
    return json({
      error: {
        message: "This request would exceed your Included AI credits."
      }
    }, 403, headers);
  }

  const u = jsonResponse.usage || {};

  await env.DB.prepare(
    `UPDATE usage_current
     SET ai_requests_day = ai_requests_day + 1,
         ai_spend_micros_day = ai_spend_micros_day + ?,
         ai_spend_micros_month = ai_spend_micros_month + ?
     WHERE user_id = ?`
  ).bind(
    costMicros,
    costMicros,
    user.userId
  ).run();

  await env.DB.prepare(
    `INSERT INTO ai_usage_events
     (id,user_id,model,prompt_tokens,completion_tokens,total_tokens,cost_micros,created_at)
     VALUES (?,?,?,?,?,?,?,?)`
  ).bind(
    id("aiu"),
    user.userId,
    selectedModel,
    Number(u.prompt_tokens || 0),
    Number(u.completion_tokens || 0),
    Number(u.total_tokens || 0),
    costMicros,
    now()
  ).run();

  return json({
    ...jsonResponse,

    yanta: {
      includedAi: true,
      privacy: {
        promptsStoredByYanta: false,
        completionsStoredByYanta: false,
        openRouterZdrRequested: true
      },
      modelLabel: selectedModel,
      model: selectedModel,
      limits: {
        requestsDay: policy.aiRequestsDay,
        maxPromptChars: policy.maxPromptChars,
        maxTokens: policy.maxTokens
      },
      usage: {
        costMicros,
        aiRequestsDayUsedAfter: Number(usage.ai_requests_day || 0) + 1,
        aiSpendMicrosDayUsedAfter: Number(usage.ai_spend_micros_day || 0) + costMicros,
        aiSpendMicrosMonthUsedAfter: Number(usage.ai_spend_micros_month || 0) + costMicros
      }
    }
  }, 200, {
    ...headers,
    "cache-control": "no-store"
  });
}
__name(handleAiCompletions, "handleAiCompletions");
function isPrivateIpLiteral(hostname) {
  const h = String(hostname || "").toLowerCase();
  if (h === "localhost" || h === "0.0.0.0" || h === "127.0.0.1" || h === "::1" || h === "[::1]") {
    return true;
  }
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}
__name(isPrivateIpLiteral, "isPrivateIpLiteral");
function safeExternalRssUrl(raw) {
  let url;
  try {
    url = new URL(String(raw || "").trim());
  } catch {
    const err = new Error("Invalid URL");
    err.status = 400;
    throw err;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    const err = new Error("Only http/https URLs are allowed");
    err.status = 400;
    throw err;
  }
  if (isPrivateIpLiteral(url.hostname)) {
    const err = new Error("This host is not allowed");
    err.status = 400;
    throw err;
  }
  url.username = "";
  url.password = "";
  return url.href;
}
__name(safeExternalRssUrl, "safeExternalRssUrl");
function looksLikeDomainQuery(q) {
  return /^[a-z0-9.-]+\.[a-z]{2,}(?:\/\S*)?$/i.test(String(q || '').trim());
}

function dedupeFeedCandidates(candidates = []) {
  const out = [];
  const seen = new Set();

  for (const raw of candidates) {
    const feedUrl = String(raw.feedUrl || raw.url || '').trim();

    if (!feedUrl) continue;

    let key = '';

    try {
      key = new URL(feedUrl).href.toLowerCase();
    } catch {
      continue;
    }

    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      title: String(raw.title || raw.name || feedUrl).slice(0, 180),
      feedUrl,
      siteUrl: raw.siteUrl || raw.homeUrl || raw.website || '',
      description: String(raw.description || '').slice(0, 500),
      source: raw.source || 'search',
    });
  }

  return out;
}

async function discoverFeedsForUrl(targetUrl) {
  const fetched = await fetchExternal(targetUrl, {
    accept: "text/html, application/rss+xml, application/atom+xml, application/feed+json, application/json, application/xml, text/xml, */*",
    maxBytes: 1024 * 1024,
    timeoutMs: 10000
  });

  if (fetched.status < 200 || fetched.status >= 400) {
    return [];
  }

  const contentType = fetched.headers.get("content-type") || "";
  const body = decodeUtf8(fetched.bytes);

  if (looksLikeFeedText(body) && !contentType.includes("html")) {
    return [{
      title: fetched.finalUrl || targetUrl,
      feedUrl: fetched.finalUrl || targetUrl,
      siteUrl: targetUrl,
      source: "direct-discovery"
    }];
  }

  return extractFeedsFromHtml(body, fetched.finalUrl || targetUrl)
    .map((x) => ({
      ...x,
      source: "html-discovery",
    }));
}

async function searchFeedsearchDev(query, limit) {
  const endpoint =
    `https://feedsearch.dev/api/v1/search?search=${encodeURIComponent(query)}`;

  const fetched = await fetchExternal(endpoint, {
    accept: "application/json",
    maxBytes: 512 * 1024,
    timeoutMs: 10000,
  });

  if (fetched.status < 200 || fetched.status >= 400) return [];

  let data = null;

  try {
    data = JSON.parse(decodeUtf8(fetched.bytes));
  } catch {
    return [];
  }

  const list = Array.isArray(data)
    ? data
    : Array.isArray(data?.feeds)
      ? data.feeds
      : Array.isArray(data?.results)
        ? data.results
        : [];

  return list.slice(0, limit).map((item) => ({
    title: item.title || item.name || item.feedUrl || item.url,
    feedUrl: item.feedUrl || item.url,
    siteUrl: item.siteUrl || item.site_url || item.website || '',
    description: item.description || '',
    source: 'feedsearch.dev',
  }));
}

async function searchItunesPodcasts(query, limit) {
  const endpoint =
    `https://itunes.apple.com/search?media=podcast&limit=${Math.max(1, Math.min(20, limit))}&term=${encodeURIComponent(query)}`;

  const fetched = await fetchExternal(endpoint, {
    accept: "application/json",
    maxBytes: 512 * 1024,
    timeoutMs: 10000,
  });

  if (fetched.status < 200 || fetched.status >= 400) return [];

  let data = null;

  try {
    data = JSON.parse(decodeUtf8(fetched.bytes));
  } catch {
    return [];
  }

  return (data?.results || [])
    .filter((item) => item.feedUrl)
    .map((item) => ({
      title: item.collectionName || item.trackName || item.feedUrl,
      feedUrl: item.feedUrl,
      siteUrl: item.collectionViewUrl || item.artistViewUrl || '',
      description: item.artistName || '',
      source: 'itunes-podcast-search',
    }));
}

function youtubeApiKey(env) {
  const key = String(env.YOUTUBE_API_KEY || '').trim();

  if (!key) {
    const err = new Error('YouTube API key is not configured.');
    err.status = 503;
    throw err;
  }

  return key;
}
__name(youtubeApiKey, "youtubeApiKey");

function cleanYoutubeInput(value = '') {
  return String(value || '')
    .trim()
    .slice(0, 300);
}
__name(cleanYoutubeInput, "cleanYoutubeInput");

function isYoutubeHost(hostname = '') {
  const h = String(hostname || '').replace(/^www\./, '').toLowerCase();

  return (
    h === 'youtube.com' ||
    h === 'm.youtube.com' ||
    h === 'youtu.be' ||
    h === 'youtube-nocookie.com'
  );
}
__name(isYoutubeHost, "isYoutubeHost");

function parseYoutubeInput(input = '') {
  const raw = cleanYoutubeInput(input);

  if (!raw) {
    return {
      kind: 'empty',
      value: '',
      raw,
    };
  }

  if (/^UC[a-zA-Z0-9_-]{20,}$/.test(raw)) {
    return {
      kind: 'channelId',
      value: raw,
      raw,
    };
  }

  if (/^@[\w.-]{2,}$/.test(raw)) {
    return {
      kind: 'handle',
      value: raw.startsWith('@') ? raw : `@${raw}`,
      raw,
    };
  }

  try {
    const url = new URL(raw);

    if (!isYoutubeHost(url.hostname)) {
      return {
        kind: 'query',
        value: raw,
        raw,
      };
    }

    if (url.pathname === '/feeds/videos.xml') {
      const channelId = url.searchParams.get('channel_id') || '';

      if (channelId) {
        return {
          kind: 'channelId',
          value: channelId,
          raw,
        };
      }
    }

    const channel = url.pathname.match(/^\/channel\/(UC[a-zA-Z0-9_-]{20,})/);

    if (channel) {
      return {
        kind: 'channelId',
        value: channel[1],
        raw,
      };
    }

    const handle = url.pathname.match(/^\/@([^/?#]+)/);

    if (handle) {
      return {
        kind: 'handle',
        value: `@${handle[1]}`,
        raw,
      };
    }

    const user = url.pathname.match(/^\/user\/([^/?#]+)/);

    if (user) {
      return {
        kind: 'username',
        value: user[1],
        raw,
      };
    }

    const custom = url.pathname.match(/^\/c\/([^/?#]+)/);

    if (custom) {
      return {
        kind: 'query',
        value: custom[1],
        raw,
      };
    }

    return {
      kind: 'query',
      value: raw,
      raw,
    };
  } catch {}

  return {
    kind: 'query',
    value: raw.replace(/^@/, ''),
    raw,
  };
}
__name(parseYoutubeInput, "parseYoutubeInput");

function youtubeThumb(thumbnails = {}) {
  return (
    thumbnails.maxres?.url ||
    thumbnails.standard?.url ||
    thumbnails.high?.url ||
    thumbnails.medium?.url ||
    thumbnails.default?.url ||
    ''
  );
}
__name(youtubeThumb, "youtubeThumb");

function youtubeChannelCandidate(channel = {}) {
  const id = channel.id || channel.snippet?.channelId || '';
  const snippet = channel.snippet || {};
  const cd = channel.contentDetails || {};
  const uploadsPlaylistId = cd.relatedPlaylists?.uploads || '';

  return {
    id,
    channelId: id,
    title: snippet.title || id || 'YouTube Channel',
    description: snippet.description || '',
    thumbnail: youtubeThumb(snippet.thumbnails || {}),
    customUrl: snippet.customUrl || '',
    handle: snippet.customUrl || '',
    publishedAt: snippet.publishedAt || '',
    uploadsPlaylistId,
    siteUrl: id ? `https://www.youtube.com/channel/${id}` : '',
    feedUrl: id ? `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(id)}` : '',
    source: 'youtube-data-api',
  };
}
__name(youtubeChannelCandidate, "youtubeChannelCandidate");

function youtubeVideoFromPlaylistItem(item = {}) {
  const snippet = item.snippet || {};
  const contentDetails = item.contentDetails || {};
  const resourceId = snippet.resourceId || {};

  const videoId =
    contentDetails.videoId ||
    resourceId.videoId ||
    '';

  if (!videoId) return null;

  return {
    id: videoId,
    videoId,
    title: snippet.title || 'YouTube video',
    description: snippet.description || '',
    publishedAt: contentDetails.videoPublishedAt || snippet.publishedAt || '',
    thumbnail: youtubeThumb(snippet.thumbnails || {}),
    channelId: snippet.channelId || '',
    channelTitle: snippet.channelTitle || '',
    url: `https://www.youtube.com/watch?v=${videoId}`,
    embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}`,
  };
}
__name(youtubeVideoFromPlaylistItem, "youtubeVideoFromPlaylistItem");

function youtubeVideoFromSearchItem(item = {}) {
  const snippet = item.snippet || {};
  const videoId = item.id?.videoId || '';

  if (!videoId) return null;

  return {
    id: videoId,
    videoId,
    title: snippet.title || 'YouTube video',
    description: snippet.description || '',
    publishedAt: snippet.publishedAt || '',
    thumbnail: youtubeThumb(snippet.thumbnails || {}),
    channelId: snippet.channelId || '',
    channelTitle: snippet.channelTitle || '',
    url: `https://www.youtube.com/watch?v=${videoId}`,
    embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}`,
  };
}
__name(youtubeVideoFromSearchItem, "youtubeVideoFromSearchItem");

async function youtubeApiFetch(env, path, params = {}) {
  const apiKey = youtubeApiKey(env);
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);

  for (const [key, value] of Object.entries(params || {})) {
    if (value == null || value === '') continue;
    url.searchParams.set(key, String(value));
  }

  url.searchParams.set('key', apiKey);

  const res = await fetch(url.href, {
    headers: {
      accept: 'application/json',
    },
  });

  let data = null;

  try {
    data = await res.json();
  } catch {}

  if (!res.ok) {
    const err = new Error(
      data?.error?.message ||
      `YouTube API failed: HTTP ${res.status}`
    );

    err.status = res.status;
    err.response = data;

    throw err;
  }

  return data || {};
}
__name(youtubeApiFetch, "youtubeApiFetch");

async function youtubeChannelById(env, channelId) {
  const data = await youtubeApiFetch(env, 'channels', {
    part: 'snippet,contentDetails',
    id: channelId,
    maxResults: 1,
  });

  return data.items?.[0] || null;
}
__name(youtubeChannelById, "youtubeChannelById");

async function youtubeChannelByHandle(env, handle) {
  const clean = String(handle || '').trim();
  const withAt = clean.startsWith('@') ? clean : `@${clean}`;

  const data = await youtubeApiFetch(env, 'channels', {
    part: 'snippet,contentDetails',
    forHandle: withAt,
    maxResults: 1,
  });

  return data.items?.[0] || null;
}
__name(youtubeChannelByHandle, "youtubeChannelByHandle");

async function youtubeChannelByUsername(env, username) {
  const data = await youtubeApiFetch(env, 'channels', {
    part: 'snippet,contentDetails',
    forUsername: username,
    maxResults: 1,
  });

  return data.items?.[0] || null;
}
__name(youtubeChannelByUsername, "youtubeChannelByUsername");

async function youtubeSearchChannels(env, query, limit = 6) {
  const data = await youtubeApiFetch(env, 'search', {
    part: 'snippet',
    type: 'channel',
    q: query,
    maxResults: Math.max(1, Math.min(12, Number(limit || 6))),
  });

  const ids = (data.items || [])
    .map((item) => item.snippet?.channelId || item.id?.channelId || '')
    .filter(Boolean);

  if (!ids.length) return [];

  const details = await youtubeApiFetch(env, 'channels', {
    part: 'snippet,contentDetails',
    id: ids.join(','),
    maxResults: ids.length,
  });

  return (details.items || []).map(youtubeChannelCandidate);
}
__name(youtubeSearchChannels, "youtubeSearchChannels");

async function youtubeLatestVideos(env, channel, limit = 12) {
  const candidate = youtubeChannelCandidate(channel);
  const playlistId = candidate.uploadsPlaylistId;

  const maxResults = Math.max(1, Math.min(24, Number(limit || 12)));

  if (playlistId) {
    const data = await youtubeApiFetch(env, 'playlistItems', {
      part: 'snippet,contentDetails',
      playlistId,
      maxResults,
    });

    return (data.items || [])
      .map(youtubeVideoFromPlaylistItem)
      .filter(Boolean);
  }

  if (!candidate.channelId) return [];

  const data = await youtubeApiFetch(env, 'search', {
    part: 'snippet',
    channelId: candidate.channelId,
    type: 'video',
    order: 'date',
    maxResults,
  });

  return (data.items || [])
    .map(youtubeVideoFromSearchItem)
    .filter(Boolean);
}
__name(youtubeLatestVideos, "youtubeLatestVideos");

async function resolveYoutubeChannel(env, input) {
  const parsed = parseYoutubeInput(input);

  if (!parsed.value) return null;

  if (parsed.kind === 'channelId') {
    return youtubeChannelById(env, parsed.value);
  }

  if (parsed.kind === 'handle') {
    const byHandle = await youtubeChannelByHandle(env, parsed.value).catch(() => null);
    if (byHandle) return byHandle;

    return null;
  }

  if (parsed.kind === 'username') {
    const byUser = await youtubeChannelByUsername(env, parsed.value).catch(() => null);
    if (byUser) return byUser;

    return null;
  }

  const [first] = await youtubeSearchChannels(env, parsed.value, 1);
  if (!first?.channelId) return null;

  return youtubeChannelById(env, first.channelId);
}
__name(resolveYoutubeChannel, "resolveYoutubeChannel");

async function handleYoutubeResolve(env, req, url, headers) {
  const user = await requireUser(env, req);
  const limits = effectiveLimits(user, await getUserCreatedAt(env, user.userId));

  const rl = await rateLimit(
    env,
    `youtube:resolve:${user.userId}`,
    Math.min(180, limits.rssFetchesDay || 200),
    24 * 60 * 60 * 1000
  );

  if (!rl.ok) {
    return json({
      error: 'youtube_rate_limited',
      message: 'YouTube lookup limit reached.',
    }, 429, headers);
  }

  const q =
    url.searchParams.get('q') ||
    url.searchParams.get('url') ||
    url.searchParams.get('channel') ||
    '';

  if (!q.trim()) {
    return json({
      error: 'missing_query',
      message: 'q, url or channel is required.',
    }, 400, headers);
  }

  const includeVideos = url.searchParams.get('includeVideos') !== '0';
  const limit = Math.max(1, Math.min(24, Number(url.searchParams.get('limit') || 12)));

  const channel = await resolveYoutubeChannel(env, q);

  if (!channel) {
    return json({
      error: 'youtube_channel_not_found',
      message: 'YouTube channel not found.',
    }, 404, headers);
  }

  const candidate = youtubeChannelCandidate(channel);
  const videos = includeVideos
    ? await youtubeLatestVideos(env, channel, limit).catch(() => [])
    : [];

  return json({
    ok: true,
    channel: candidate,
    videos,
    feed: {
      title: candidate.title,
      feedUrl: candidate.feedUrl,
      siteUrl: candidate.siteUrl,
      description: candidate.description,
      imageUrl: candidate.thumbnail,
      source: 'youtube-data-api',
    },
  }, 200, {
    ...headers,
    'cache-control': 'private, max-age=300',
  });
}
__name(handleYoutubeResolve, "handleYoutubeResolve");

async function handleYoutubeSearch(env, req, url, headers) {
  const user = await requireUser(env, req);
  const limits = effectiveLimits(user, await getUserCreatedAt(env, user.userId));

  const rl = await rateLimit(
    env,
    `youtube:search:${user.userId}`,
    Math.min(180, limits.rssFetchesDay || 200),
    24 * 60 * 60 * 1000
  );

  if (!rl.ok) {
    return json({
      error: 'youtube_rate_limited',
      message: 'YouTube search limit reached.',
    }, 429, headers);
  }

  const q = String(url.searchParams.get('q') || '').trim().slice(0, 160);
  const limit = Math.max(1, Math.min(12, Number(url.searchParams.get('limit') || 6)));

  if (!q) {
    return json({
      channels: [],
    }, 200, headers);
  }

  const channels = await youtubeSearchChannels(env, q, limit);

  return json({
    channels,
  }, 200, {
    ...headers,
    'cache-control': 'private, max-age=300',
  });
}
__name(handleYoutubeSearch, "handleYoutubeSearch");

function parseIso8601DurationSeconds(value = '') {
  const s = String(value || '').trim();

  const m = s.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);

  if (!m) return 0;

  const days = Number(m[1] || 0);
  const hours = Number(m[2] || 0);
  const minutes = Number(m[3] || 0);
  const seconds = Number(m[4] || 0);

  return days * 86400 + hours * 3600 + minutes * 60 + seconds;
}
__name(parseIso8601DurationSeconds, "parseIso8601DurationSeconds");

function youtubeVideoInfoFromVideoItem(item = {}) {
  const snippet = item.snippet || {};
  const contentDetails = item.contentDetails || {};
  const status = item.status || {};
  const videoId = item.id || '';

  const durationSeconds = parseIso8601DurationSeconds(contentDetails.duration || '');

  const text = [
    snippet.title || '',
    snippet.description || '',
  ].join('\n').toLowerCase();

  const probablyShort =
    durationSeconds > 0 &&
    durationSeconds <= 61 &&
    (
      text.includes('#shorts') ||
      text.includes('#short') ||
      text.includes('youtube shorts') ||
      true
    );

  return {
    id: videoId,
    videoId,
    title: snippet.title || '',
    description: snippet.description || '',
    publishedAt: snippet.publishedAt || '',
    thumbnail: youtubeThumb(snippet.thumbnails || {}),
    channelId: snippet.channelId || '',
    channelTitle: snippet.channelTitle || '',
    duration: contentDetails.duration || '',
    durationSeconds,
    privacyStatus: status.privacyStatus || '',
    embeddable: status.embeddable !== false,
    uploadStatus: status.uploadStatus || '',
    probablyShort,
    url: videoId ? `https://www.youtube.com/watch?v=${videoId}` : '',
    embedUrl: videoId ? `https://www.youtube-nocookie.com/embed/${videoId}` : '',
  };
}
__name(youtubeVideoInfoFromVideoItem, "youtubeVideoInfoFromVideoItem");

async function youtubeVideosInfo(env, videoIds = []) {
  const ids = [...new Set(
    (Array.isArray(videoIds) ? videoIds : [])
      .map((x) => String(x || '').trim())
      .filter(Boolean)
  )].slice(0, 50);

  if (!ids.length) return [];

  const data = await youtubeApiFetch(env, 'videos', {
    part: 'snippet,contentDetails,status',
    id: ids.join(','),
    maxResults: ids.length,
  });

  return (data.items || []).map(youtubeVideoInfoFromVideoItem);
}
__name(youtubeVideosInfo, "youtubeVideosInfo");

async function youtubeLatestVideosPage(env, channelId, {
  pageToken = '',
  limit = 12,
} = {}) {
  const channel = await youtubeChannelById(env, channelId);

  if (!channel) {
    const err = new Error('YouTube channel not found.');
    err.status = 404;
    throw err;
  }

  const candidate = youtubeChannelCandidate(channel);
  const playlistId = candidate.uploadsPlaylistId;

  const maxResults = Math.max(1, Math.min(24, Number(limit || 12)));

  if (!playlistId) {
    return {
      channel: candidate,
      videos: [],
      nextPageToken: '',
    };
  }

  const page = await youtubeApiFetch(env, 'playlistItems', {
    part: 'snippet,contentDetails',
    playlistId,
    maxResults,
    pageToken,
  });

  const baseVideos = (page.items || [])
    .map(youtubeVideoFromPlaylistItem)
    .filter(Boolean);

  const infos = await youtubeVideosInfo(
    env,
    baseVideos.map((v) => v.videoId)
  ).catch(() => []);

  const infoById = new Map(infos.map((x) => [x.videoId, x]));

  const videos = baseVideos.map((v) => ({
    ...v,
    ...(infoById.get(v.videoId) || {}),
    title: infoById.get(v.videoId)?.title || v.title,
    description: infoById.get(v.videoId)?.description || v.description,
    thumbnail: infoById.get(v.videoId)?.thumbnail || v.thumbnail,
    publishedAt: infoById.get(v.videoId)?.publishedAt || v.publishedAt,
  }));

  return {
    channel: candidate,
    videos,
    nextPageToken: page.nextPageToken || '',
    prevPageToken: page.prevPageToken || '',
  };
}
__name(youtubeLatestVideosPage, "youtubeLatestVideosPage");

async function handleYoutubeVideosInfo(env, req, url, headers) {
  const user = await requireUser(env, req);
  const limits = effectiveLimits(user, await getUserCreatedAt(env, user.userId));

  const rl = await rateLimit(
    env,
    `youtube:videos-info:${user.userId}`,
    Math.min(400, limits.rssFetchesDay || 200),
    24 * 60 * 60 * 1000
  );

  if (!rl.ok) {
    return json({
      error: 'youtube_rate_limited',
      message: 'YouTube lookup limit reached.',
    }, 429, headers);
  }

  const ids = String(url.searchParams.get('ids') || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

  const videos = await youtubeVideosInfo(env, ids);

  return json({
    videos,
  }, 200, {
    ...headers,
    'cache-control': 'private, max-age=600',
  });
}
__name(handleYoutubeVideosInfo, "handleYoutubeVideosInfo");

async function handleYoutubeChannelVideos(env, req, url, headers) {
  const user = await requireUser(env, req);
  const limits = effectiveLimits(user, await getUserCreatedAt(env, user.userId));

  const rl = await rateLimit(
    env,
    `youtube:channel-videos:${user.userId}`,
    Math.min(240, limits.rssFetchesDay || 200),
    24 * 60 * 60 * 1000
  );

  if (!rl.ok) {
    return json({
      error: 'youtube_rate_limited',
      message: 'YouTube video load limit reached.',
    }, 429, headers);
  }

  const channelId = String(url.searchParams.get('channelId') || '').trim();
  const pageToken = String(url.searchParams.get('pageToken') || '').trim();
  const limit = Math.max(1, Math.min(24, Number(url.searchParams.get('limit') || 12)));

  if (!channelId) {
    return json({
      error: 'missing_channel_id',
      message: 'channelId is required.',
    }, 400, headers);
  }

  const result = await youtubeLatestVideosPage(env, channelId, {
    pageToken,
    limit,
  });

  return json(result, 200, {
    ...headers,
    'cache-control': 'private, max-age=300',
  });
}
__name(handleYoutubeChannelVideos, "handleYoutubeChannelVideos");

async function handleRssSearch(env, req, url, headers) {
  const user = await requireUser(env, req);

  const limits = effectiveLimits(user, await getUserCreatedAt(env, user.userId));

  const rl = await rateLimit(
    env,
    `rss:search:${user.userId}`,
    Math.min(300, limits.rssFetchesDay || 200),
    24 * 60 * 60 * 1000
  );

  if (!rl.ok) {
    return json({
      error: "rss_rate_limited",
      message: "RSS search limit reached."
    }, 429, headers);
  }

  const q = String(url.searchParams.get("q") || "").trim().slice(0, 180);
  const limit = Math.max(1, Math.min(20, Number(url.searchParams.get("limit") || 8)));

  if (!q) {
    return json({
      feeds: [],
    }, 200, headers);
  }

  const candidates = [];

  if (/^https?:\/\//i.test(q) || looksLikeDomainQuery(q)) {
    const target = /^https?:\/\//i.test(q) ? q : `https://${q}`;

    try {
      candidates.push(...await discoverFeedsForUrl(target));
    } catch {}
  }

  const settled = await Promise.allSettled([
    searchFeedsearchDev(q, limit),
    searchItunesPodcasts(q, limit),
  ]);

  for (const res of settled) {
    if (res.status === "fulfilled") {
      candidates.push(...res.value);
    }
  }

  return json({
    feeds: dedupeFeedCandidates(candidates).slice(0, limit),
  }, 200, headers);
}
__name(handleRssSearch, "handleRssSearch");
async function readResponseWithLimit(res, maxBytes) {
  const len = Number(res.headers.get("content-length") || 0);
  if (len && len > maxBytes) {
    const err = new Error("Response too large");
    err.status = 413;
    throw err;
  }
  if (!res.body) {
    const buf = await res.arrayBuffer();
    if (buf.byteLength > maxBytes) {
      const err = new Error("Response too large");
      err.status = 413;
      throw err;
    }
    return new Uint8Array(buf);
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
      }
      const err = new Error("Response too large");
      err.status = 413;
      throw err;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
__name(readResponseWithLimit, "readResponseWithLimit");
function decodeUtf8(bytes) {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}
__name(decodeUtf8, "decodeUtf8");
function looksLikeFeedText(text2) {
  const s = String(text2 || "").trim().slice(0, 300).toLowerCase();
  return s.startsWith("<?xml") || s.startsWith("<rss") || s.startsWith("<feed") || s.startsWith("{") || s.includes("<rss") || s.includes("<feed");
}
__name(looksLikeFeedText, "looksLikeFeedText");
async function fetchExternal(url, {
  accept = "*/*",
  etag = "",
  lastModified = "",
  maxBytes = 2 * 1024 * 1024,
  timeoutMs = 12e3,
  maxRedirects = 3
} = {}) {
  let currentUrl = safeExternalRssUrl(url);
  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = {
        accept,
        "user-agent": "YANTA Sources/1.0 (+https://yanta.page)"
      };
      if (etag && redirectCount === 0) {
        headers["if-none-match"] = etag;
      }
      if (lastModified && redirectCount === 0) {
        headers["if-modified-since"] = lastModified;
      }
      const res = await fetch(currentUrl, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        const nextUrl = new URL(res.headers.get("location"), currentUrl).href;
        currentUrl = safeExternalRssUrl(nextUrl);
        continue;
      }
      if (res.status === 304) {
        return {
          status: 304,
          headers: res.headers,
          bytes: new Uint8Array(),
          finalUrl: currentUrl
        };
      }
      const bytes = await readResponseWithLimit(res, maxBytes);
      return {
        status: res.status,
        headers: res.headers,
        bytes,
        finalUrl: currentUrl
      };
    } finally {
      clearTimeout(timer);
    }
  }
  const err = new Error("Too many redirects");
  err.status = 400;
  throw err;
}
__name(fetchExternal, "fetchExternal");
function extractFeedsFromHtml(html, baseUrl) {
  const feeds = [];
  const seen = /* @__PURE__ */ new Set();
  const add = /* @__PURE__ */ __name((feedUrl, title = "") => {
    if (!feedUrl) return;
    let href = "";
    try {
      href = new URL(feedUrl, baseUrl).href;
    } catch {
      return;
    }
    const key = href.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    feeds.push({
      title: title || href,
      feedUrl: href,
      siteUrl: baseUrl
    });
  }, "add");
  const linkRe = /<link\b[^>]*>/gi;
  let m;
  while ((m = linkRe.exec(html)) !== null) {
    const tag = m[0];
    const rel = tag.match(/\brel=["']?([^"'>\s]+)/i)?.[1] || "";
    const type = tag.match(/\btype=["']?([^"'>\s]+)/i)?.[1] || "";
    const href = tag.match(/\bhref=["']([^"']+)["']/i)?.[1] || tag.match(/\bhref=([^\s>]+)/i)?.[1] || "";
    const title = tag.match(/\btitle=["']([^"']+)["']/i)?.[1] || "";
    const isAlternate = rel.toLowerCase().includes("alternate");
    const isFeedType = /rss|atom|feed\+json|json/i.test(type);
    if (href && isAlternate && isFeedType) {
      add(href, title);
    }
  }
  for (const path of ["/feed", "/feed.xml", "/rss.xml", "/atom.xml"]) {
    add(path, "");
  }
  return feeds.slice(0, 12);
}
__name(extractFeedsFromHtml, "extractFeedsFromHtml");
async function handleRssDiscover(env, req, url, headers) {
  const user = await requireUser(env, req);
  const limits = effectiveLimits(user, await getUserCreatedAt(env, user.userId));
  const rl = await rateLimit(
    env,
    `rss:discover:${user.userId}`,
    Math.min(200, limits.rssFetchesDay || 200),
    24 * 60 * 60 * 1e3
  );
  if (!rl.ok) {
    return json({ error: "rss_rate_limited", message: "RSS discovery limit reached." }, 429, headers);
  }
  const targetUrl = safeExternalRssUrl(url.searchParams.get("url") || "");
  const fetched = await fetchExternal(targetUrl, {
    accept: "text/html, application/rss+xml, application/atom+xml, application/feed+json, application/json, application/xml, text/xml, */*",
    maxBytes: 1024 * 1024,
    timeoutMs: 1e4
  });
  if (fetched.status < 200 || fetched.status >= 400) {
    return json({ error: "fetch_failed", status: fetched.status }, 502, headers);
  }
  const contentType = fetched.headers.get("content-type") || "";
  const textBody = decodeUtf8(fetched.bytes);
  if (looksLikeFeedText(textBody) && !contentType.includes("html")) {
    return json({
      feeds: [
        {
          title: targetUrl,
          feedUrl: fetched.finalUrl || targetUrl,
          siteUrl: targetUrl
        }
      ]
    }, 200, headers);
  }
  const feeds = extractFeedsFromHtml(textBody, fetched.finalUrl || targetUrl);
  return json({ feeds }, 200, headers);
}
__name(handleRssDiscover, "handleRssDiscover");
async function handleRssFetch(env, req, url, headers) {
  const user = await requireUser(env, req);
  const limits = effectiveLimits(user, await getUserCreatedAt(env, user.userId));
  const rl = await rateLimit(
    env,
    `rss:fetch:${user.userId}`,
    limits.rssFetchesDay || 200,
    24 * 60 * 60 * 1e3
  );
  if (!rl.ok) {
    return json({ error: "rss_rate_limited", message: "RSS fetch limit reached." }, 429, headers);
  }
  const targetUrl = safeExternalRssUrl(url.searchParams.get("url") || "");
  const fetched = await fetchExternal(targetUrl, {
    accept: "application/rss+xml, application/atom+xml, application/feed+json, application/json, application/xml, text/xml, */*",
    etag: url.searchParams.get("etag") || "",
    lastModified: url.searchParams.get("lastModified") || "",
    maxBytes: 2 * 1024 * 1024,
    timeoutMs: 12e3
  });
  if (fetched.status === 304) {
    return json({ notModified: true }, 200, headers);
  }
  if (fetched.status < 200 || fetched.status >= 400) {
    return json({ error: "fetch_failed", status: fetched.status }, 502, headers);
  }
  const body = decodeUtf8(fetched.bytes);
  if (!looksLikeFeedText(body)) {
    return json({ error: "not_a_feed", message: "URL did not return a supported RSS/Atom/JSON feed." }, 400, headers);
  }
  return json({
    body,
    contentType: fetched.headers.get("content-type") || "",
    etag: fetched.headers.get("etag") || "",
    lastModified: fetched.headers.get("last-modified") || "",
    finalUrl: fetched.finalUrl || targetUrl
  }, 200, {
    ...headers,
    "cache-control": "no-store"
  });
}
__name(handleRssFetch, "handleRssFetch");
async function handleRssImage(env, req, url, headers) {
  const user = await requireUser(env, req);
  const limits = effectiveLimits(user, await getUserCreatedAt(env, user.userId));
  const targetUrl = safeExternalRssUrl(url.searchParams.get("url") || "");
  const cacheKey = new Request(`https://yanta-rss-image-cache.local/?url=${encodeURIComponent(targetUrl)}`);
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) {
    return new Response(cached.body, {
      status: cached.status,
      headers: {
        ...headers,
        "content-type": cached.headers.get("content-type") || "image/jpeg",
        "cache-control": "public, max-age=21600"
      }
    });
  }
  const rl = await rateLimit(
    env,
    `rss:image:${user.userId}`,
    2e3,
    24 * 60 * 60 * 1e3
  );
  if (!rl.ok) {
    return json({ error: "rss_image_rate_limited" }, 429, headers);
  }
  const fetched = await fetchExternal(targetUrl, {
    accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,image/svg+xml,image/*,*/*",
    maxBytes: limits.rssImageBytesMax || 2 * 1024 * 1024,
    timeoutMs: 1e4
  });
  if (fetched.status < 200 || fetched.status >= 400) {
    return json({ error: "image_fetch_failed", status: fetched.status }, 502, headers);
  }
  const type = fetched.headers.get("content-type") || "";
  if (!type.toLowerCase().startsWith("image/")) {
    return json({ error: "not_an_image" }, 400, headers);
  }
  const res = new Response(fetched.bytes, {
    status: 200,
    headers: {
      ...headers,
      "content-type": type,
      "cache-control": "public, max-age=21600",
      "x-content-type-options": "nosniff"
    }
  });
  try {
    await cache.put(cacheKey, res.clone());
  } catch {
  }
  return res;
}
__name(handleRssImage, "handleRssImage");

// ============================================================
// Public Shares
// ============================================================

function publicSharePayloadKey(shareId) {
  return `public-shares/${shareId}/payload.enc`;
}

function isShareActive(row) {
  if (!row) return false;
  if (row.status !== 'active') return false;
  if (row.revoked_at) return false;
  if (row.expires_at && Number(row.expires_at) <= now()) return false;
  return true;
}

function publicShareId() {
  return `s_${randomToken(9)}`;
}

async function requireOwnedPublicShare(env, user, shareId) {
  const row = await env.DB.prepare(
    `SELECT *
     FROM public_shares
     WHERE id = ? AND owner_user_id = ?`
  ).bind(shareId, user.userId).first();

  if (!row) {
    const err = new Error('Public share not found');
    err.status = 404;
    throw err;
  }

  return row;
}

async function handleCreatePublicShare(env, req, headers) {
  const user = await requireUser(env, req);
  const body = await bodyJson(req);

  const vaultId = String(body.vaultId || '').trim();
  const sourceType = String(body.sourceType || 'note').trim();
  const sourceId = String(body.sourceId || '').trim();
  const expiresAt = body.expiresAt ? Number(body.expiresAt) : null;

  /*
    Zero-knowledge critical:
    Reusing an existing cloud share is only safe if the client explicitly asks
    for it AND already has the matching private shareKey locally.
    The server never knows the private shareKey after #k=.
  */
  const reuseActive = body.reuseActive === true;

  if (!sourceId) {
    return json({ ok: false, message: 'sourceId required' }, 400, headers);
  }

  if (vaultId) {
    await requireVault(env, user, vaultId);
  }

  if (reuseActive) {
    const existing = await env.DB.prepare(
      `SELECT id, vault_id, source_type, source_id, status, expires_at,
              revoked_at, created_at, updated_at, last_published_at
       FROM public_shares
       WHERE owner_user_id = ?
         AND COALESCE(vault_id, '') = ?
         AND source_type = ?
         AND source_id = ?
         AND status = 'active'
         AND revoked_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1`
    ).bind(
      user.userId,
      vaultId || '',
      sourceType,
      sourceId
    ).first();

    if (isShareActive(existing)) {
      return json({
        ok: true,
        share: {
          id: existing.id,
          shareId: existing.id,
          vaultId: existing.vault_id || null,
          sourceType: existing.source_type,
          sourceId: existing.source_id,
          expiresAt: existing.expires_at || null,
          status: existing.status,
          createdAt: existing.created_at,
          updatedAt: existing.updated_at,
          lastPublishedAt: existing.last_published_at || null,
          existing: true,
        },
      }, 200, headers);
    }
  }

  const shareId = publicShareId();
  const t = now();

  await env.DB.prepare(
    `INSERT INTO public_shares
     (id, owner_user_id, vault_id, source_type, source_id, status, expires_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`
  ).bind(
    shareId,
    user.userId,
    vaultId || null,
    sourceType,
    sourceId,
    expiresAt,
    t,
    t
  ).run();

  await audit(env, req, 'public_share_created', user.userId, {
    shareId,
    vaultId,
    sourceType,
    sourceId,
    reuseActive: false,
  });

  return json({
    ok: true,
    share: {
      id: shareId,
      shareId,
      vaultId: vaultId || null,
      sourceType,
      sourceId,
      expiresAt,
      status: 'active',
      createdAt: t,
      updatedAt: t,
      existing: false,
    },
  }, 200, headers);
}

async function handleListPublicShares(env, req, headers) {
  const user = await requireUser(env, req);

  const rows = await env.DB.prepare(
    `SELECT id, vault_id, source_type, source_id, status, expires_at, revoked_at,
            created_at, updated_at, last_published_at, payload_size_bytes
     FROM public_shares
     WHERE owner_user_id = ?
     ORDER BY updated_at DESC`
  ).bind(user.userId).all();

  return json({
    shares: (rows.results || []).map((r) => ({
      id: r.id,
      shareId: r.id,
      vaultId: r.vault_id || null,
      sourceType: r.source_type,
      sourceId: r.source_id,
      status: r.status,
      expiresAt: r.expires_at || null,
      revokedAt: r.revoked_at || null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      lastPublishedAt: r.last_published_at || null,
      payloadSizeBytes: r.payload_size_bytes || 0,
    })),
  }, 200, headers);
}

async function handlePutPublicSharePayload(env, req, url, headers) {
  const user = await requireUser(env, req);

  const m = url.pathname.match(/^\/api\/public-shares\/([^/]+)\/payload$/);
  const shareId = m?.[1] || '';

  if (!shareId) {
    return json({ ok: false, message: 'shareId required' }, 400, headers);
  }

  const share = await requireOwnedPublicShare(env, user, shareId);

  if (share.status !== 'active' || share.revoked_at) {
    return json({ ok: false, message: 'Share is revoked' }, 409, headers);
  }

  const body = await bodyJson(req);

  const encryptedPayload = String(body.encryptedPayload || '');
  const payloadBytes = new TextEncoder().encode(encryptedPayload);
  const assetGrants = Array.isArray(body.assetGrants) ? body.assetGrants : [];
  const etag = String(body.etag || `"${payloadBytes.byteLength}-${now()}"`);

  if (!encryptedPayload) {
    return json({ ok: false, message: 'encryptedPayload required' }, 400, headers);
  }

  if (payloadBytes.byteLength > 4 * 1024 * 1024) {
    return json({ ok: false, message: 'Public share payload too large' }, 413, headers);
  }

  const objectKey = publicSharePayloadKey(shareId);

  await env.OBJECTS.put(objectKey, payloadBytes, {
    httpMetadata: {
      contentType: 'application/octet-stream',
    },
    customMetadata: {
      shareId,
      ownerUserId: user.userId,
    },
  });

  const t = now();

  await env.DB.prepare(
    `UPDATE public_shares
     SET payload_object_key = ?,
         payload_etag = ?,
         payload_size_bytes = ?,
         updated_at = ?,
         last_published_at = ?
     WHERE id = ? AND owner_user_id = ?`
  ).bind(
    objectKey,
    etag,
    payloadBytes.byteLength,
    t,
    t,
    shareId,
    user.userId
  ).run();

  await env.DB.prepare(
    `DELETE FROM public_share_assets WHERE share_id = ?`
  ).bind(shareId).run();

  const insert = env.DB.prepare(
    `INSERT INTO public_share_assets
     (share_id, asset_object_id, object_path, size_bytes, mime, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  for (const raw of assetGrants) {
    const assetObjectId = String(raw.assetObjectId || raw.objectId || '').trim();
    const objectPath = normalizeRemotePath(String(raw.objectPath || '').trim());

    if (!assetObjectId || !objectPath.startsWith('yanta-sync-v1/assets/')) {
      continue;
    }

    await insert.bind(
      shareId,
      assetObjectId,
      objectPath,
      Number(raw.sizeBytes || raw.size || 0) || 0,
      String(raw.mime || '').slice(0, 120),
      t
    ).run();
  }

  await audit(env, req, 'public_share_published', user.userId, {
    shareId,
    assetGrantCount: assetGrants.length,
  });

  return json({
    ok: true,
    shareId,
    etag,
    updatedAt: t,
  }, 200, headers);
}

async function handlePatchPublicShare(env, req, url, headers) {
  const user = await requireUser(env, req);

  const m = url.pathname.match(/^\/api\/public-shares\/([^/]+)$/);
  const shareId = m?.[1] || '';

  const share = await requireOwnedPublicShare(env, user, shareId);
  const body = await bodyJson(req);

  const patch = {};
  const params = [];

  if (Object.prototype.hasOwnProperty.call(body, 'expiresAt')) {
    patch.expires_at = body.expiresAt ? Number(body.expiresAt) : null;
  }

  if (body.status === 'revoked') {
    patch.status = 'revoked';
    patch.revoked_at = now();
  }

  if (!Object.keys(patch).length) {
    return json({ ok: true }, 200, headers);
  }

  patch.updated_at = now();

  const sets = Object.keys(patch).map((k) => {
    params.push(patch[k]);
    return `${k} = ?`;
  });

  params.push(share.id, user.userId);

  await env.DB.prepare(
    `UPDATE public_shares
     SET ${sets.join(', ')}
     WHERE id = ? AND owner_user_id = ?`
  ).bind(...params).run();

  return json({ ok: true }, 200, headers);
}

async function handleDeletePublicShare(env, req, url, headers) {
  const user = await requireUser(env, req);

  const m = url.pathname.match(/^\/api\/public-shares\/([^/]+)$/);
  const shareId = m?.[1] || '';

  const share = await requireOwnedPublicShare(env, user, shareId);
  const t = now();

  await env.DB.prepare(
    `UPDATE public_shares
     SET status = 'revoked',
         revoked_at = COALESCE(revoked_at, ?),
         updated_at = ?
     WHERE id = ? AND owner_user_id = ?`
  ).bind(t, t, share.id, user.userId).run();

  await env.DB.prepare(
    `DELETE FROM public_share_assets WHERE share_id = ?`
  ).bind(share.id).run();

  if (share.payload_object_key) {
    await env.OBJECTS.delete(share.payload_object_key).catch(() => {});
  }

  await audit(env, req, 'public_share_revoked', user.userId, { shareId });

  return json({ ok: true }, 200, headers);
}

async function handleGetPublicShare(env, req, url, headers) {
  const m = url.pathname.match(/^\/api\/public-shares\/([^/]+)$/);
  const shareId = m?.[1] || '';

  const row = await env.DB.prepare(
    `SELECT id, status, expires_at, revoked_at, updated_at, last_published_at,
            payload_object_key, payload_etag, payload_size_bytes
     FROM public_shares
     WHERE id = ?`
  ).bind(shareId).first();

  if (!isShareActive(row)) {
    return json({ error: 'not_found' }, 404, {
      ...headers,
      'cache-control': 'no-store',
    });
  }

  if (!row.payload_object_key) {
    return json({ error: 'not_published' }, 404, {
      ...headers,
      'cache-control': 'no-store',
    });
  }

  const obj = await env.OBJECTS.get(row.payload_object_key);

  if (!obj) {
    return json({ error: 'payload_missing' }, 404, {
      ...headers,
      'cache-control': 'no-store',
    });
  }

  const payload = await obj.text();

  return json({
    shareId: row.id,
    status: row.status,
    expiresAt: row.expires_at || null,
    updatedAt: row.updated_at,
    lastPublishedAt: row.last_published_at || null,
    etag: row.payload_etag || '',
    payloadSizeBytes: row.payload_size_bytes || 0,
    encryptedPayload: payload,
  }, 200, {
    ...headers,
    'cache-control': 'no-store',
  });
}

async function handleGetPublicShareAsset(env, req, url, headers) {
  const m = url.pathname.match(/^\/api\/public-shares\/([^/]+)\/assets\/([^/]+)$/);
  const shareId = m?.[1] || '';
  const assetObjectId = decodeURIComponent(m?.[2] || '');

  const share = await env.DB.prepare(
    `SELECT id, status, expires_at, revoked_at
     FROM public_shares
     WHERE id = ?`
  ).bind(shareId).first();

  if (!isShareActive(share)) {
    return json({ error: 'not_found' }, 404, {
      ...headers,
      'cache-control': 'no-store',
    });
  }

  const grant = await env.DB.prepare(
    `SELECT object_path, size_bytes, mime
     FROM public_share_assets
     WHERE share_id = ? AND asset_object_id = ?`
  ).bind(shareId, assetObjectId).first();

  if (!grant) {
    return json({ error: 'not_found' }, 404, {
      ...headers,
      'cache-control': 'no-store',
    });
  }

  const ownerRow = await env.DB.prepare(
    `SELECT owner_user_id, vault_id
     FROM public_shares
     WHERE id = ?`
  ).bind(shareId).first();

  if (!ownerRow?.owner_user_id || !ownerRow?.vault_id) {
    return json({ error: 'not_found' }, 404, headers);
  }

  const obj = await env.OBJECTS.get(
    r2Key(ownerRow.owner_user_id, ownerRow.vault_id, grant.object_path)
  );

  if (!obj) {
    return json({ error: 'object_missing' }, 404, {
      ...headers,
      'cache-control': 'no-store',
    });
  }

  return new Response(obj.body, {
    status: 200,
    headers: {
      ...headers,
      'content-type': 'application/octet-stream',
      'cache-control': 'no-store',
      'content-length': grant.size_bytes ? String(grant.size_bytes) : undefined,
    },
  });
}

async function route(req, env) {
  const headers = corsHeaders(env, req);
  if (!originAllowed(env, req)) {
    return json({ error: "origin_not_allowed" }, 403, headers);
  }
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }
  const url = new URL(req.url);
  try {
    if (url.pathname === "/" || url.pathname === "/healthz") {
      return text("ok\n", 200, headers);
    }
    if (url.pathname === "/api/auth/send-code" && req.method === "POST") {
      return await handleSendCode(env, req, headers);
    }
    if (url.pathname === "/api/auth/verify-code" && req.method === "POST") {
      return handleVerifyCode(env, req, headers);
    }
    if (url.pathname === "/api/auth/magic" && req.method === "GET") {
      return handleMagic(env, req, url, headers);
    }
    if (url.pathname === "/api/auth/logout" && req.method === "POST") {
      return handleLogout(env, req, headers);
    }
    if (url.pathname === "/api/me" && req.method === "GET") {
      return handleMe(env, req, headers);
    }
    if (url.pathname === "/api/vaults" && req.method === "GET") {
      return handleListVaults(env, req, headers);
    }
    if (url.pathname === "/api/vaults" && req.method === "POST") {
      return handleCreateVault(env, req, headers);
    }
    if (url.pathname === "/api/devices" && req.method === "GET") {
      return handleListDevices(env, req, url, headers);
    }
    if (url.pathname === "/api/devices" && req.method === "DELETE") {
      return handleRevokeDevice(env, req, url, headers);
    }
    if (url.pathname === "/api/usage" && req.method === "GET") {
      return handleUsage(env, req, headers);
    }
    if (url.pathname === "/api/storage/index" && req.method === "GET") {
      return handleStorageIndex(env, req, url, headers);
    }
    if (url.pathname === "/api/storage/breakdown" && req.method === "GET") {
      return handleStorageBreakdown(env, req, url, headers);
    }
    if (url.pathname === "/api/storage/list" && req.method === "GET") {
      return handleStorageList(env, req, url, headers);
    }
    if (url.pathname === "/api/storage/stat" && req.method === "GET") {
      return handleStorageStat(env, req, url, headers);
    }
    if (url.pathname === "/api/storage/object" && req.method === "GET") {
      return handleStorageGet(env, req, url, headers);
    }
    if (url.pathname === "/api/storage/object" && req.method === "PUT") {
      return handleStoragePut(env, req, url, headers);
    }
    if (url.pathname === "/api/storage/object" && req.method === "DELETE") {
      return handleStorageDelete(env, req, url, headers);
    }
    if (url.pathname === "/api/ai/chat/completions" && req.method === "POST") {
      return handleAiCompletions(env, req, headers);
    }
    if (url.pathname === "/api/rss/discover" && req.method === "GET") {
      return handleRssDiscover(env, req, url, headers);
    }
    if (url.pathname === "/api/rss/fetch" && req.method === "GET") {
      return handleRssFetch(env, req, url, headers);
    }
    if (url.pathname === "/api/rss/image" && req.method === "GET") {
      return handleRssImage(env, req, url, headers);
    }
    if (url.pathname === "/api/rss/search" && req.method === "GET") {
      return handleRssSearch(env, req, url, headers);
    }
    if (url.pathname === "/api/youtube/resolve" && req.method === "GET") {
      return handleYoutubeResolve(env, req, url, headers);
    }
    if (url.pathname === "/api/youtube/search" && req.method === "GET") {
      return handleYoutubeSearch(env, req, url, headers);
    }
    if (url.pathname === "/api/youtube/videos-info" && req.method === "GET") {
      return handleYoutubeVideosInfo(env, req, url, headers);
    }
    if (url.pathname === "/api/youtube/channel-videos" && req.method === "GET") {
      return handleYoutubeChannelVideos(env, req, url, headers);
    }

    // Owner Public Share APIs
    if (url.pathname === "/api/public-shares" && req.method === "GET") {
      return handleListPublicShares(env, req, headers);
    }

    if (url.pathname === "/api/public-shares" && req.method === "POST") {
      return handleCreatePublicShare(env, req, headers);
    }

    if (/^\/api\/public-shares\/[^/]+\/payload$/.test(url.pathname) && req.method === "PUT") {
      return handlePutPublicSharePayload(env, req, url, headers);
    }

    if (/^\/api\/public-shares\/[^/]+$/.test(url.pathname) && req.method === "PATCH") {
      return handlePatchPublicShare(env, req, url, headers);
    }

    if (/^\/api\/public-shares\/[^/]+$/.test(url.pathname) && req.method === "DELETE") {
      return handleDeletePublicShare(env, req, url, headers);
    }

    // Public APIs, no auth
    if (/^\/api\/public-shares\/[^/]+$/.test(url.pathname) && req.method === "GET") {
      return handleGetPublicShare(env, req, url, headers);
    }

    if (/^\/api\/public-shares\/[^/]+\/assets\/[^/]+$/.test(url.pathname) && req.method === "GET") {
      return handleGetPublicShareAsset(env, req, url, headers);
    }
    return json({ error: "not_found" }, 404, headers);
  } catch (err) {
    console.error("[YANTA Cloud Worker]", safeErrorForLog(err));
    return json({
      error: "internal_error",
      message: err?.message || String(err),
      status: err?.status || 500
    }, err.status || 500, headers);
  }
}
__name(route, "route");
var index_default = {
  async fetch(req, env) {
    try {
      return await route(req, env);
    } catch (err) {
      console.error("[YANTA Cloud Worker FATAL]", safeErrorForLog(err));

      let headers = {};

      try {
        headers = corsHeaders(env, req);
      } catch {}

      return json({
        error: "internal_error",
        message: err?.message || String(err),
        status: err?.status || 500
      }, err?.status || 500, headers);
    }
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map