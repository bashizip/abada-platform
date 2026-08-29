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
 */

const BUNDLE_RE =
  /^\/abada-platform-[0-9]+\.[0-9]+\.[0-9]+(?:[.-][0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?\.tar\.gz(?:\.sha256)?$/;
const LATEST_PATH = "/latest";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (BUNDLE_RE.test(url.pathname) || url.pathname === LATEST_PATH) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method not allowed\n", {
          status: 405,
          headers: { Allow: "GET, HEAD" },
        });
      }
      return serveFromR2(request, url.pathname, env);
    }

    return env.ASSETS.fetch(request);
  },
};

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
