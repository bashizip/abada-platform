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

// --- install events ---------------------------------------------------------

/** A D1 stand-in that keeps what is inserted and answers the per-day count. */
function usageDatabase({ failing = false, seen = 0 } = {}) {
  const rows = [];
  return {
    rows,
    prepare(sql) {
      return {
        bind(...params) {
          return {
            async run() {
              if (failing) throw new Error("D1 unavailable");
              if (/LIKE/.test(sql)) throw new Error("the daily cap must name its kinds, not use a wildcard");
              if (/^DELETE/.test(sql)) rows.push({ deleted: params[0] });
              else rows.push({ sql, params });
              return {};
            },
            async first() {
              if (/LIKE/.test(sql)) throw new Error("the daily cap must name its kinds, not use a wildcard");
              assert.match(sql, /kind IN \('install_succeeded', 'install_failed'\)/);
              return { n: seen };
            },
          };
        },
      };
    },
  };
}

function requestWith(url, { method = "GET", cf, headers = {}, body } = {}) {
  const request = new Request(url, { method, headers, body });
  Object.defineProperty(request, "cf", { value: cf });
  return request;
}

function context() {
  const pending = [];
  return { pending, waitUntil: (p) => pending.push(p), done: () => Promise.all(pending) };
}

function column(row, name) {
  const names = /INSERT INTO install_events \(([^)]*)\)/.exec(row.sql)[1].split(", ");
  return row.params[names.indexOf(name)];
}

const EDGE = {
  country: "BE", region: "Brussels Capital", city: "Brussels", continent: "EU", timezone: "Europe/Brussels",
  asn: 5432, asOrganization: "Proximus NV",
}; // the edge offers more than we keep: only country and region are stored

test("records an installer fetch with location from the edge and never the address", async () => {
  const { env } = environment();
  env.USAGE_DB = usageDatabase();
  const ctx = context();

  const response = await worker.fetch(
    requestWith("https://install.abadaplatform.com/install.sh", {
      cf: EDGE,
      headers: { "CF-Connecting-IP": "203.0.113.7", "User-Agent": "curl/8.7.1" },
    }),
    env,
    ctx
  );
  await ctx.done();

  assert.equal(await response.text(), "static");
  assert.equal(env.USAGE_DB.rows.length, 1);
  const row = env.USAGE_DB.rows[0];
  assert.equal(column(row, "kind"), "installer_fetch");
  assert.equal(column(row, "country"), "BE");
  assert.equal(column(row, "region"), "Brussels Capital");
  assert.equal(column(row, "user_agent"), "curl/8.7.1");
  // Nothing finer than region, no network owner, no address: not even as columns.
  assert.ok(!/city|asn|as_org|ip_hash|timezone|continent/.test(row.sql));
  const stored = JSON.stringify(row);
  for (const value of ["203.0.113.7", "Brussels\"", "Proximus", "5432"]) {
    assert.ok(!stored.includes(value), value);
  }
});

test("counts the version pointer and a bundle download, not HEAD requests or checksum files", async () => {
  const bundle = "abada-platform-1.1.0.tar.gz";
  const { env } = environment({
    latest: object("1.1.0\n", "text/plain"),
    [bundle]: object("archive"),
    [`${bundle}.sha256`]: object("sum"),
  });
  env.USAGE_DB = usageDatabase();
  const ctx = context();
  const get = (path, method = "GET") =>
    worker.fetch(requestWith(`https://install.abadaplatform.com${path}`, { method, cf: EDGE }), env, ctx);

  await get("/latest");
  await get(`/${bundle}`);
  await get(`/${bundle}.sha256`);
  await get(`/${bundle}`, "HEAD");
  await ctx.done();

  const kinds = env.USAGE_DB.rows.map((row) => [column(row, "kind"), column(row, "version")]);
  assert.deepEqual(kinds, [["version_check", null], ["bundle_download", "1.1.0"]]);
});

test("serving never depends on recording: no database, or a failing one, changes nothing", async () => {
  const key = "abada-platform-1.1.0.tar.gz";
  for (const database of [undefined, usageDatabase({ failing: true })]) {
    const { env } = environment({ [key]: object("archive") });
    if (database) env.USAGE_DB = database;
    const ctx = context();
    const response = await worker.fetch(
      requestWith(`https://install.abadaplatform.com/${key}`, { cf: EDGE }),
      env,
      ctx
    );
    await ctx.done();
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "archive");
  }
});

test("accepts a reported outcome with only the allowed fields and takes location from the edge", async () => {
  const { env } = environment();
  env.USAGE_DB = usageDatabase();
  const ctx = context();
  const report = {
    event: "install_failed", version: "1.1.0", install_id: "0b8f3c52-9f1f-4c0e-8a58-0d5b4c0f6e11",
    failed_step: "start", os: "Darwin", arch: "arm64", docker_version: "27.3.1", profile: "dev",
    duration_s: 212, llm_key_provided: false, ci: false,
  };

  const response = await worker.fetch(
    requestWith("https://install.abadaplatform.com/v1/install-event", {
      method: "POST", cf: EDGE, body: JSON.stringify(report),
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "198.51.100.9" },
    }),
    env,
    ctx
  );
  await ctx.done();

  assert.equal(response.status, 204);
  const row = env.USAGE_DB.rows[0];
  assert.equal(column(row, "kind"), "install_failed");
  assert.equal(column(row, "failed_step"), "start");
  assert.equal(column(row, "os"), "Darwin");
  assert.equal(column(row, "duration_s"), 212);
  assert.equal(column(row, "llm_key_provided"), 0);
  assert.equal(column(row, "country"), "BE");
  assert.ok(!JSON.stringify(row).includes("198.51.100.9"));
  assert.ok(!/city|asn|ip_hash/.test(row.sql));
});

test("stores the user agent trimmed to printable characters, and null when it is missing", async () => {
  const { env } = environment();
  env.USAGE_DB = usageDatabase();
  const ctx = context();
  const fetchWith = (headers) =>
    worker.fetch(requestWith("https://install.abadaplatform.com/install.sh", { cf: EDGE, headers }), env, ctx);

  await fetchWith({ "User-Agent": `  Mozilla/5.0 \u00e9${"x".repeat(400)}` });
  await fetchWith({ "User-Agent": "   " });
  await fetchWith({});
  await ctx.done();

  const agents = env.USAGE_DB.rows.map((row) => column(row, "user_agent"));
  assert.equal(agents[0].length, 200);
  assert.ok(agents[0].startsWith("Mozilla/5.0 xxx"));
  assert.equal(agents[1], null);
  assert.equal(agents[2], null);
});

test("refuses anything that is not on the list, is the wrong shape or is too large", async () => {
  const { env } = environment();
  env.USAGE_DB = usageDatabase();
  const send = (body, method = "POST") =>
    worker.fetch(
      requestWith("https://install.abadaplatform.com/v1/install-event", { method, cf: EDGE, body }),
      env,
      context()
    );
  const ok = { event: "install_succeeded", version: "1.1.0" };

  assert.equal((await send(JSON.stringify({ ...ok, hostname: "laptop" }))).status, 400);
  assert.equal((await send(JSON.stringify({ ...ok, ip: "1.2.3.4" }))).status, 400);
  assert.equal((await send(JSON.stringify({ ...ok, event: "something_else" }))).status, 400);
  assert.equal((await send(JSON.stringify({ ...ok, version: "1.1.0; rm -rf /" }))).status, 400);
  assert.equal((await send(JSON.stringify({ ...ok, failed_step: "free text here" }))).status, 400);
  assert.equal((await send(JSON.stringify({ version: "1.1.0" }))).status, 400);
  assert.equal((await send("not json")).status, 400);
  assert.equal((await send("[1,2]")).status, 400);
  assert.equal((await send(JSON.stringify({ ...ok, os: "x".repeat(3000) }))).status, 413);
  const wrongMethod = await send(undefined, "GET");
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get("Allow"), "POST");
  assert.equal(env.USAGE_DB.rows.length, 0);
});

test("drops reports beyond the daily cap per installer without telling the sender", async () => {
  const { env } = environment();
  env.USAGE_DB = usageDatabase({ seen: 20 });
  const ctx = context();
  const response = await worker.fetch(
    requestWith("https://install.abadaplatform.com/v1/install-event", {
      method: "POST", cf: EDGE, body: JSON.stringify({ event: "install_succeeded", version: "1.1.0", install_id: "0b8f3c52-9f1f-4c0e-8a58-0d5b4c0f6e11" }),
    }),
    env,
    ctx
  );
  await ctx.done();
  assert.equal(response.status, 204);
  assert.equal(env.USAGE_DB.rows.length, 0);
});

test("the daily run deletes events older than the retention period", async () => {
  const { env } = environment();
  env.USAGE_DB = usageDatabase();
  const ctx = context();
  await worker.scheduled({}, env, ctx);
  await ctx.done();
  const [deletion] = env.USAGE_DB.rows;
  const age = (Date.now() - Date.parse(deletion.deleted)) / 86400000;
  assert.ok(age > 394 && age < 396, `cutoff is ${age.toFixed(1)} days old`);
});

test("accepts exactly the payload the installer sends, for both outcomes", async () => {
  // Copied from what install.sh builds (see scripts/test/verify-install-distribution.sh): the two must agree.
  const payloads = [
    '{"event":"install_succeeded","version":"1.1.0","install_id":"bf0dc5a6-d6cd-451e-9d17-e38c1b593f50","os":"Darwin","arch":"arm64","docker_version":"27.0.1","profile":"dev","duration_s":0,"llm_key_provided":false,"ci":false}',
    '{"event":"install_failed","install_id":"0b8f3c529f1f4c0e8a580d5b4c0f6e11","os":"Linux","arch":"x86_64","profile":"dev","duration_s":3,"llm_key_provided":true,"ci":true,"failed_step":"resolve"}',
  ];
  for (const body of payloads) {
    const { env } = environment();
    env.USAGE_DB = usageDatabase();
    const ctx = context();
    const response = await worker.fetch(
      requestWith("https://install.abadaplatform.com/v1/install-event", { method: "POST", cf: EDGE, body }),
      env,
      ctx
    );
    await ctx.done();
    assert.equal(response.status, 204, body);
    assert.equal(env.USAGE_DB.rows.length, 1);
  }
});
