// Fails the build when a page links to a site page or heading that does not exist.
// Runs on the built site (dist/), so it checks exactly what readers get.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const root = new URL('../dist/', import.meta.url).pathname;
const skip = /^\/(_astro|pagefind)\/|\.(svg|xml|webp|png|jpg|ico|txt|js|css)$/;

function htmlFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return htmlFiles(path);
    return name.endsWith('.html') ? [path] : [];
  });
}

const pages = new Map();
for (const file of htmlFiles(root)) {
  const html = readFileSync(file, 'utf8');
  const url = '/' + relative(root, file).split(sep).join('/').replace(/index\.html$/, '');
  pages.set(url, { html, ids: new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])) });
}

const broken = [];
for (const [url, { html }] of pages) {
  for (const [, path, fragment] of html.matchAll(/href="(\/[^"#?]*)(?:\?[^"#]*)?(?:#([^"]*))?"/g)) {
    if (skip.test(path) || path === '/') continue;
    const target = path.endsWith('/') ? path : `${path}/`;
    const page = pages.get(target);
    if (!page) broken.push(`${url} → ${path}`);
    else if (fragment && !page.ids.has(decodeURIComponent(fragment))) broken.push(`${url} → ${path}#${fragment}`);
  }
}

if (broken.length) {
  console.error(`Broken internal links (${broken.length}):\n  ${[...new Set(broken)].join('\n  ')}`);
  process.exit(1);
}
console.log(`Internal links OK across ${pages.size} pages.`);
