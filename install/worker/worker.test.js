import assert from "node:assert/strict";
import test from "node:test";

import worker from "./worker.js";

function object(body, contentType = "application/octet-stream") {
  return {
    body,
    size: Buffer.byteLength(body),
    httpEtag: '"fixture-etag"',
    writeHttpMetadata(headers) {
      headers.set("Content-Type", contentType);
    },
  };
}

function environment(entries = {}) {
  const calls = [];
  const env = {
    R2_RELEASES: {
      async get(key) {
        calls.push(["get", key]);
        return entries[key] ?? null;
      },
      async head(key) {
        calls.push(["head", key]);
        return entries[key] ?? null;
      },
    },
    ASSETS: {
      async fetch() {
        calls.push(["assets"]);
        return new Response("static", { status: 200 });
      },
    },
  };
  return { calls, env };
}

test("serves immutable versioned bundles from R2", async () => {
  const key = "abada-platform-1.0.0-rc.4.tar.gz";
  const { calls, env } = environment({ [key]: object("archive") });

  const response = await worker.fetch(
    new Request(`https://install.abadaplatform.com/${key}`),
    env
  );

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "archive");
  assert.equal(response.headers.get("Content-Type"), "application/gzip");
  assert.equal(
    response.headers.get("Cache-Control"),
    "public, max-age=31536000, immutable"
  );
  assert.deepEqual(calls, [["get", key]]);
});

test("serves the promoted latest pointer without caching it", async () => {
  const { calls, env } = environment({
    latest: object("1.0.0-rc.4\n", "text/plain"),
  });

  const response = await worker.fetch(
    new Request("https://install.abadaplatform.com/latest"),
    env
  );

  assert.equal(await response.text(), "1.0.0-rc.4\n");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(calls, [["get", "latest"]]);
});

test("uses R2 metadata for HEAD without reading the object body", async () => {
  const key = "abada-platform-1.0.0.tar.gz.sha256";
  const { calls, env } = environment({ [key]: object("checksum") });

  const response = await worker.fetch(
    new Request(`https://install.abadaplatform.com/${key}`, { method: "HEAD" }),
    env
  );

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "");
  assert.deepEqual(calls, [["head", key]]);
});

test("does not expose arbitrary R2 keys", async () => {
  const { calls, env } = environment({ secret: object("private") });

  const response = await worker.fetch(
    new Request("https://install.abadaplatform.com/secret"),
    env
  );

  assert.equal(await response.text(), "static");
  assert.deepEqual(calls, [["assets"]]);
});

test("returns a release-specific 404 for an unpublished valid version", async () => {
  const key = "abada-platform-1.0.0-rc.99.tar.gz";
  const { calls, env } = environment();
  const response = await worker.fetch(
    new Request(`https://install.abadaplatform.com/${key}`),
    env
  );

  assert.equal(response.status, 404);
  assert.match(await response.text(), /Published release file not found/);
  assert.deepEqual(calls, [["get", key]]);
});

test("rejects mutation methods for public release objects", async () => {
  const { calls, env } = environment();
  const response = await worker.fetch(
    new Request("https://install.abadaplatform.com/latest", { method: "POST" }),
    env
  );

  assert.equal(response.status, 405);
  assert.equal(response.headers.get("Allow"), "GET, HEAD");
  assert.deepEqual(calls, []);
});
