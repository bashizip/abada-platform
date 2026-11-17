/**
 * Abada install worker
 *
 * Routing rules:
 *   /abada-platform-*.tar.gz[.sha256]  →  R2 (immutable release files)
 *   /latest                            →  R2 (promoted version pointer)
 *   everything else                   →  static assets
 *
 * The R2 bucket "abada-releases" is bound as R2_RELEASES in wrangler.toml.
 * Bundles are uploaded there by the publish-release-bundle CI workflow on
 * every v* tag push.
 *
 * Install events (install/README.md, "Install events"): requests for the
 * installer, the version pointer and a bundle are recorded, and the installer
 * may report one anonymous outcome to POST /v1/install-event. Recording is
 * best effort in a D1 database (USAGE_DB): it never delays, changes or fails
 * what is served, and it stores no IP address, host name, user name, path,
 * environment or key. Location comes from Cloudflare's request metadata.
 */

const BUNDLE_RE =
  /^\/abada-platform-[0-9]+\.[0-9]+\.[0-9]+(?:[.-][0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?\.tar\.gz(?:\.sha256)?$/;
const LATEST_PATH = "/latest";
const INSTALLER_PATH = "/install.sh";
const EVENT_PATH = "/v1/install-event";
const MAX_EVENT_BYTES = 2048;
/** Reported outcomes accepted per install id and day; the rest are dropped silently. */
const DAILY_EVENT_CAP = 20;
/** Rows older than this are deleted by the daily scheduled run (13 months). */
const RETENTION_DAYS = 395;
const MAX_USER_AGENT_CHARS = 200;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === EVENT_PATH) {
      return acceptInstallEvent(request, env, ctx);
    }

    if (BUNDLE_RE.test(url.pathname) || url.pathname === LATEST_PATH) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method not allowed\n", {
          status: 405,
          headers: { Allow: "GET, HEAD" },
        });
      }
      const response = await serveFromR2(request, url.pathname, env);
      if (request.method === "GET" && response.status === 200) {
        const kind = url.pathname === LATEST_PATH ? "version_check" : bundleKind(url.pathname);
        if (kind) defer(ctx, record(env, request, { kind, version: bundleVersion(url.pathname) }));
      }
      return response;
    }

    if (url.pathname === INSTALLER_PATH && request.method === "GET") {
      defer(ctx, record(env, request, { kind: "installer_fetch" }));
    }

    return env.ASSETS.fetch(request);
  },

  /** Daily: delete rows past the retention period. */
  async scheduled(_event, env, ctx) {
    defer(ctx, purge(env));
  },
};

/** The tarball is an install attempt; its checksum file is fetched alongside and is not counted. */
function bundleKind(pathname) {
  return BUNDLE_RE.test(pathname) && !pathname.endsWith(".sha256") ? "bundle_download" : null;
}

function bundleVersion(pathname) {
  const match = /^\/abada-platform-(.+?)\.tar\.gz(?:\.sha256)?$/.exec(pathname);
  return match ? match[1] : null;
}

function defer(ctx, promise) {
  const safe = Promise.resolve(promise).catch(() => {});
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(safe);
}

// --- install events ---------------------------------------------------------

/**
 * The only fields an installer may report, with how each is validated. Anything else is refused, so a client
 * can never add free text, identifiers of the machine or its owner, or anything the privacy page does not list.
 */
const EVENT_FIELDS = {
  event: (v) => ["install_succeeded", "install_failed"].includes(v) && v,
  version: (v) => /^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z]+)*$/.test(v) && v.length <= 40 && v,
  install_id: (v) => /^[0-9a-f-]{16,40}$/.test(v) && v,
  failed_step: (v) =>
    ["preflight", "resolve", "validate_key", "download", "verify", "extract", "configure", "start"].includes(v) && v,
  os: (v) => /^[A-Za-z0-9._ -]{1,20}$/.test(v) && v,
  arch: (v) => /^[A-Za-z0-9_-]{1,16}$/.test(v) && v,
  docker_version: (v) => /^[0-9A-Za-z.+_-]{1,40}$/.test(v) && v,
  profile: (v) => ["dev", "prod", "server"].includes(v) && v,
  duration_s: (v) => Number.isInteger(v) && v >= 0 && v <= 86400 && v,
  llm_key_provided: (v) => typeof v === "boolean" && (v ? 1 : 0),
  ci: (v) => typeof v === "boolean" && (v ? 1 : 0),
};

async function acceptInstallEvent(request, env, ctx) {
  if (request.method !== "POST") {
    return new Response("Method not allowed\n", { status: 405, headers: { Allow: "POST" } });
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_EVENT_BYTES) {
    return new Response("Event too large\n", { status: 413 });
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return new Response("Event must be JSON\n", { status: 400 });
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return new Response("Event must be a JSON object\n", { status: 400 });
  }
  const row = {};
  for (const [key, value] of Object.entries(body)) {
    const check = EVENT_FIELDS[key];
    if (!check) return new Response(`Unknown field: ${key}\n`, { status: 400 });
    const clean = value === null ? false : check(value);
    if (clean === false && value !== false) return new Response(`Invalid field: ${key}\n`, { status: 400 });
    row[key] = clean === false ? 0 : clean;
  }
  if (!row.event) return new Response("Missing field: event\n", { status: 400 });
  row.kind = row.event;
  delete row.event;
  defer(ctx, record(env, request, row, { capped: true }));
  return new Response(null, { status: 204 });
}

// --- recording --------------------------------------------------------------

const COLUMNS = [
  "received_at", "kind", "version", "install_id", "failed_step", "os", "arch", "docker_version", "profile",
  "duration_s", "llm_key_provided", "ci", "country", "region",
  "user_agent",
];

async function record(env, request, row, options = {}) {
  if (!env.USAGE_DB) return;
  const cf = request.cf ?? {};
  const now = new Date();
  if (options.capped && row.install_id) {
    const dayStart = `${now.toISOString().slice(0, 10)}T00:00:00.000Z`;
    const seen = await env.USAGE_DB.prepare(
      "SELECT COUNT(*) AS n FROM install_events WHERE install_id = ? AND kind IN ('install_succeeded', 'install_failed') AND received_at >= ?"
    ).bind(row.install_id, dayStart).first();
    if (seen && seen.n >= DAILY_EVENT_CAP) return;
  }
  const values = {
    received_at: now.toISOString(),
    ...row,
    country: cf.country ?? null,
    region: cf.region ?? null,
    user_agent: userAgent(request),
  };
  const params = COLUMNS.map((column) => (values[column] === undefined ? null : values[column]));
  await env.USAGE_DB.prepare(
    `INSERT INTO install_events (${COLUMNS.join(", ")}) VALUES (${COLUMNS.map(() => "?").join(", ")})`
  ).bind(...params).run();
}

/** The User-Agent header, printable ASCII only and trimmed, or null when absent. */
function userAgent(request) {
  const raw = request.headers.get("User-Agent");
  if (!raw) return null;
  const clean = raw.replace(/[^\x20-\x7E]/g, "").trim().slice(0, MAX_USER_AGENT_CHARS);
  return clean || null;
}

async function purge(env) {
  if (!env.USAGE_DB) return;
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400000).toISOString();
  await env.USAGE_DB.prepare("DELETE FROM install_events WHERE received_at < ?").bind(cutoff).run();
}

async function serveFromR2(request, pathname, env) {
  // Strip the leading slash to get the R2 object key.
  const key = pathname.slice(1);

  const object =
    request.method === "HEAD"
      ? await env.R2_RELEASES.head(key)
      : await env.R2_RELEASES.get(key);

  if (!object) {
    return new Response(
      `Published release file not found: ${key}\n`,
      {
        status: 404,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      }
    );
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);

  if (pathname === LATEST_PATH) {
    headers.set("Content-Type", "text/plain; charset=utf-8");
    headers.set("Cache-Control", "no-store");
  } else {
    headers.set(
      "Content-Type",
      pathname.endsWith(".sha256")
        ? "text/plain; charset=utf-8"
        : "application/gzip"
    );
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
  }

  if (object.httpEtag || object.etag) {
    headers.set("ETag", object.httpEtag || `"${object.etag}"`);
  }
  if (typeof object.size === "number") headers.set("Content-Length", String(object.size));

  return new Response(request.method === "HEAD" ? null : object.body, {
    status: 200,
    headers,
  });
}
