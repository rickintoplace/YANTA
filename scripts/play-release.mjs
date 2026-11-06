#!/usr/bin/env node
// ============================================================
// YANTA — upload the Android app bundle to Google Play
//
//   node scripts/play-release.mjs                      # check access, change nothing
//   node scripts/play-release.mjs --apply              # upload to the internal track
//   node scripts/play-release.mjs --apply --track=production
//   node scripts/play-release.mjs --assetlinks         # write the Play signing SHA-256
//                                                      # into public/.well-known/assetlinks.json
//
// Release notes come from android/fastlane/metadata/android/<lang>/
// changelogs/<versionCode>.txt; the versionCode is read from the bundle's
// build.gradle.kts. While the app is still a draft in the Play Console,
// Play only accepts releases with status "draft" — the script retries
// with it and says so.
//
// Credentials: a Play Developer API service account key, from
// PLAY_SERVICE_ACCOUNT_JSON or ~/.yanta-release/play-service-account.json.
// The service account must be invited in the Play Console (Users and
// permissions) with release rights for page.yanta.app.
// ============================================================

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSign } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG = 'page.yanta.app';
const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3';
const UPLOAD = 'https://androidpublisher.googleapis.com/upload/androidpublisher/v3';

const args = process.argv.slice(2);
const arg = (name, fallback = '') => (args.find((a) => a.startsWith(`--${name}=`)) || '').split('=').slice(1).join('=') || fallback;
const TRACK = arg('track', 'internal');
const APPLY = args.includes('--apply');
const AAB = arg('aab', path.join(ROOT, 'android/app/build/outputs/bundle/release/app-release.aab'));

const keyFile = process.env.PLAY_SERVICE_ACCOUNT_JSON || path.join(os.homedir(), '.yanta-release/play-service-account.json');

function fail(message) {
  console.error(`\n${message}`);
  process.exit(1);
}

if (!fs.existsSync(keyFile)) fail(`No service account key at ${keyFile}.`);
const sa = JSON.parse(fs.readFileSync(keyFile, 'utf8'));

// ---- OAuth: a signed JWT for the service account, exchanged for a token.
async function accessToken() {
  const b64 = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key).toString('base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
  });
  const json = await res.json();
  if (!json.access_token) fail(`Token request failed: ${JSON.stringify(json)}`);
  return json.access_token;
}

const token = await accessToken();

async function call(url, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body && !(body instanceof Uint8Array) ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body instanceof Uint8Array ? body : body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = new Error(json?.error?.message || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

function versionCode() {
  const gradle = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle.kts'), 'utf8');
  return Number(/versionCode\s*=\s*(\d+)/.exec(gradle)?.[1]);
}

function releaseNotes(code) {
  const base = path.join(ROOT, 'android/fastlane/metadata/android');
  return fs.readdirSync(base).flatMap((language) => {
    const file = path.join(base, language, 'changelogs', `${code}.txt`);
    return fs.existsSync(file) ? [{ language, text: fs.readFileSync(file, 'utf8').trim().slice(0, 500) }] : [];
  });
}

// ---- 1. Access
let edit;
try {
  edit = await call(`${API}/applications/${PKG}/edits`, { method: 'POST' });
} catch (err) {
  if (err.status === 404) {
    fail([
      `Play does not know ${PKG} for ${sa.client_email}.`,
      'Either the app has not been created in the Play Console yet, or this',
      'service account has not been invited to the developer account that owns it.',
      'See android/PLAY_RELEASE.md, "Uploading from this machine".',
    ].join('\n'));
  }
  if (err.status === 403) fail(`The service account has no release rights for ${PKG}: ${err.message}`);
  throw err;
}

const discard = () => call(`${API}/applications/${PKG}/edits/${edit.id}`, { method: 'DELETE' }).catch(() => {});

// ---- assetlinks: the SHA-256 of the key Play signs installs with.
if (args.includes('--assetlinks')) {
  await discard();
  const code = Number(arg('version-code', versionCode()));
  const generated = await call(`${API}/applications/${PKG}/generatedApks/${code}`);
  const sha = generated.generatedApks?.[0]?.certificateSha256Hash;
  if (!sha) fail(`No generated APKs for versionCode ${code} yet — upload it first.`);
  const hex = Buffer.from(sha, 'base64').toString('hex').toUpperCase().match(/../g).join(':');
  const file = path.join(ROOT, 'public/.well-known/assetlinks.json');
  const links = JSON.parse(fs.readFileSync(file, 'utf8'));
  const prints = links[0].target.sha256_cert_fingerprints;
  if (prints.includes(hex)) {
    console.log(`Play signing key already listed: ${hex}`);
  } else {
    prints.push(hex);
    fs.writeFileSync(file, `${JSON.stringify(links, null, 2)}\n`);
    console.log(`Added Play signing key to assetlinks.json: ${hex}`);
  }
  process.exit(0);
}

const code = versionCode();
const notes = releaseNotes(code);
const tracks = await call(`${API}/applications/${PKG}/edits/${edit.id}/tracks`);

console.log(`Access OK: ${sa.client_email} → ${PKG}`);
console.log(`Tracks: ${(tracks.tracks || []).map((t) => `${t.track}[${(t.releases || []).map((r) => `${r.status}:${(r.versionCodes || []).join(',')}`).join(' ')}]`).join(' ') || '(none yet)'}`);
console.log(`Bundle: ${AAB} (${(fs.statSync(AAB).size / 1048576).toFixed(1)} MB), versionCode ${code}`);
console.log(`Notes: ${notes.map((n) => n.language).join(', ') || 'none'}`);

if (!APPLY) {
  await discard();
  console.log('\nDry run — nothing uploaded. Add --apply to upload.');
  process.exit(0);
}

// ---- 2. Upload, assign to the track, commit.
try {
  const bundle = await call(`${UPLOAD}/applications/${PKG}/edits/${edit.id}/bundles?uploadType=media`, {
    method: 'POST',
    body: new Uint8Array(fs.readFileSync(AAB)),
    headers: { 'content-type': 'application/octet-stream' },
  });
  console.log(`Uploaded versionCode ${bundle.versionCode}`);

  const release = (status) => call(`${API}/applications/${PKG}/edits/${edit.id}/tracks/${TRACK}`, {
    method: 'PUT',
    body: { track: TRACK, releases: [{ versionCodes: [String(bundle.versionCode)], status, releaseNotes: notes }] },
  });

  let status = 'completed';
  await release(status);

  try {
    await call(`${API}/applications/${PKG}/edits/${edit.id}:commit`, { method: 'POST' });
  } catch (err) {
    if (!/draft/i.test(err.message)) throw err;
    // A draft app accepts draft releases only; roll them out in the console.
    status = 'draft';
    await release(status);
    await call(`${API}/applications/${PKG}/edits/${edit.id}:commit`, { method: 'POST' });
  }

  console.log(`\nCommitted to "${TRACK}" as ${status}.`);
  if (status === 'draft') console.log('The app is still a draft in the Play Console: open the release there and roll it out.');
} catch (err) {
  await discard();
  fail(`Upload failed, nothing changed: ${err.message}`);
}
