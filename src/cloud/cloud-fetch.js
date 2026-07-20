// ============================================================
// YANTA Cloud — shared fetch helpers
//
// Retry/backoff + error normalization used by every client that talks
// to the YANTA Cloud worker (vault object store, shared spaces, …).
// Extracted from sync2/yanta-cloud-object-store.js so new stores don't
// duplicate the transport layer.
// ============================================================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function retryAfterMs(res) {
  const raw = res.headers?.get?.('retry-after');
  if (!raw) return 0;

  const seconds = Number(raw);

  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const date = Date.parse(raw);

  if (Number.isFinite(date)) {
    return Math.max(0, date - Date.now());
  }

  return 0;
}

export function retryableStatus(status) {
  return (
    status === 408 ||
    status === 425 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}

export async function fetchWithRetry(url, options = {}, {
  attempts = 4,
  label = 'YANTA Cloud request',
  fetchImpl = fetch.bind(globalThis),
} = {}) {
  let lastRes = null;
  let lastErr = null;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await fetchImpl(url, options);

      if (!retryableStatus(res.status) || attempt === attempts - 1) {
        return res;
      }

      lastRes = res;

      const fromHeader = retryAfterMs(res);
      const backoff =
        fromHeader ||
        (500 * Math.pow(2, attempt) + Math.random() * 350);

      await sleep(Math.min(backoff, 8000));
    } catch (err) {
      lastErr = err;

      if (attempt === attempts - 1) {
        throw err;
      }

      const backoff = 500 * Math.pow(2, attempt) + Math.random() * 350;
      await sleep(Math.min(backoff, 8000));
    }
  }

  if (lastRes) return lastRes;
  throw lastErr || new Error(label);
}

// Turn a non-OK worker response into a rich Error carrying the server
// error code, quota details and retry hints. Mirrors the semantics the
// sync2 engine already relies on (EQUOTA / ERATE_LIMIT / EOBJECT_TOO_LARGE).
export async function errorFromResponse(res, fallback) {
  let message = fallback;
  let parsed = null;

  try {
    parsed = await res.json();
    message =
      parsed?.message ||
      parsed?.error?.message ||
      parsed?.error ||
      message;
  } catch {
    try {
      message = await res.text();
    } catch {}
  }

  const err = new Error(`${fallback}: ${res.status} ${message}`);

  err.status = res.status;
  err.response = parsed;

  if (parsed?.maxBytes != null) {
    err.maxBytes = Number(parsed.maxBytes || 0);
  }

  if (parsed?.maxObjects != null) {
    err.maxObjects = Number(parsed.maxObjects || 0);
  }

  const errorCode =
    typeof parsed?.error === 'string'
      ? parsed.error
      : parsed?.error?.code ||
        parsed?.code ||
        '';

  if (errorCode) {
    err.serverCode = errorCode;
  }

  if (res.status === 413) {
    err.code = 'EOBJECT_TOO_LARGE';

    if (parsed?.gotBytes != null) {
      err.gotBytes = Number(parsed.gotBytes || 0);
    }
  }

  if (res.status === 429) {
    err.code = 'ERATE_LIMIT';

    const retryAfter = Number(res.headers.get('retry-after') || 0);

    err.retryAfterMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : 5 * 60 * 1000;
  }

  if (
    res.status === 403 &&
    [
      'storage_quota_exceeded',
      'object_quota_exceeded',
      'upload_day_quota_exceeded',
      'writes_day_quota_exceeded',
      'download_quota_exceeded',
      'space_quota_exceeded',
    ].includes(errorCode)
  ) {
    err.code = 'EQUOTA';
    err.retryAfterMs = 60 * 60 * 1000;
    err.serverCode = errorCode;
  }

  if (res.status === 403 && parsed?.code === 'DEVICE_REVOKED') {
    err.code = 'EDEVICE_REVOKED';
    err.serverCode = 'DEVICE_REVOKED';
  }

  return err;
}
