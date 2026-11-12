// The release this documentation describes, and the rules that keep it true (M5 S13).
// release.json says which release the pages describe and whether it is out yet:
//   in-development — the engine, Studio and documentation are still on the previous
//                    release; pages may already describe the next one.
//   released       — the engine, Studio and documentation versions equal `documents`.
// A page marks what is new with frontmatter `since: 1.2.0` (new page) or
// `updated: 1.2.0` (changed page); the sidebar shows New / Updated while that
// version's minor is the documented one, and the badge disappears on the next minor.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// The documentation directory: next to this file in the sources; the working directory
// once Astro has bundled this module into dist/ (builds run from documentation/).
const SOURCE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOT = existsSync(join(SOURCE_ROOT, 'release.json')) ? SOURCE_ROOT : process.cwd();
const REPO = join(ROOT, '..');
const DOCS = join(ROOT, 'src', 'content', 'docs');
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

export function parseVersion(value) {
  const match = SEMVER.exec(String(value ?? '').trim());
  if (!match) return null;
  return match.slice(1, 4).map(Number);
}

export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) throw new Error(`Not a version: ${!left ? a : b}`);
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

export const minorOf = (value) => parseVersion(value)?.slice(0, 2).join('.') ?? null;

/** The slug of a release's notes page: `release-notes/1-2` for 1.2.x. */
export const notesSlug = (version) => `release-notes/${minorOf(version).replace('.', '-')}`;

export function readRelease() {
  const release = JSON.parse(readFileSync(join(ROOT, 'release.json'), 'utf8'));
  if (!parseVersion(release.documents)) throw new Error('release.json: documents must be a version like 1.2.0');
  if (!['in-development', 'released'].includes(release.status)) {
    throw new Error('release.json: status must be in-development or released');
  }
  return release;
}

/** The versions the release must agree with. */
export function componentVersions() {
  const pom = readFileSync(join(REPO, 'engine', 'pom.xml'), 'utf8');
  const engine = /<artifactId>abada-engine<\/artifactId>\s*<version>([^<]+)<\/version>/.exec(pom)?.[1];
  const studio = JSON.parse(readFileSync(join(REPO, 'studio', 'package.json'), 'utf8')).version;
  const documentation = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  return { engine, studio, documentation };
}

/** Every page's `since` and `updated`, read from its frontmatter, by slug. */
export function pageVersions() {
  const pages = new Map();
  const walk = (directory) => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (!/\.(md|mdx)$/.test(name)) continue;
      const text = readFileSync(path, 'utf8');
      const frontmatter = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '';
      const field = (key) => new RegExp(`^${key}:\\s*['"]?([^'"\\n]+)['"]?\\s*$`, 'm').exec(frontmatter)?.[1]?.trim();
      let slug = relative(DOCS, path).replace(/\\/g, '/').replace(/\.(md|mdx)$/, '');
      if (slug.endsWith('/index')) slug = slug.slice(0, -'/index'.length);
      pages.set(slug, { file: relative(ROOT, path), since: field('since'), updated: field('updated') });
    }
  };
  walk(DOCS);
  return pages;
}

/** Problems that must fail the build; empty when the release and the pages agree. */
export function releaseProblems(release = readRelease(), versions = componentVersions(), pages = pageVersions()) {
  const problems = [];
  const named = Object.entries(versions);
  for (const [component, version] of named) {
    if (!parseVersion(version)) problems.push(`${component} version '${version}' is not a release version`);
  }
  if (problems.length) return problems;
  const distinct = new Set(named.map(([, version]) => version));
  if (distinct.size > 1) {
    problems.push(`engine, Studio and documentation versions disagree: ${named.map(([c, v]) => `${c} ${v}`).join(', ')}`);
  } else if (release.status === 'released' && versions.engine !== release.documents) {
    problems.push(`release.json says ${release.documents} is released, but the components are ${versions.engine}`);
  } else if (release.status === 'in-development' && compareVersions(versions.engine, release.documents) >= 0) {
    problems.push(`release.json says ${release.documents} is in development, but the components are already `
      + `${versions.engine}; set status to released`);
  }
  for (const page of pages.values()) {
    for (const key of ['since', 'updated']) {
      const value = page[key];
      if (value === undefined) continue;
      if (!parseVersion(value)) {
        problems.push(`${page.file}: ${key} '${value}' is not a version like 1.2.0`);
      } else if (compareVersions(value, release.documents) > 0) {
        problems.push(`${page.file}: ${key} ${value} is later than the documented release ${release.documents}`);
      }
    }
  }
  const notes = notesSlug(release.documents);
  if (!pages.has(notes)) problems.push(`no release notes page for ${minorOf(release.documents)} (${notes}.mdx)`);
  return problems;
}

/** The sidebar badge of a page: New while `since`, Updated while `updated` is the documented minor. */
export function badgeFor(page, release = readRelease()) {
  if (!page) return undefined;
  const current = minorOf(release.documents);
  if (page.since && minorOf(page.since) === current) return { text: 'New', variant: 'tip' };
  if (page.updated && minorOf(page.updated) === current) return { text: 'Updated', variant: 'note' };
  return undefined;
}

/** The sidebar with each page's badge attached (items given by slug). */
export function withBadges(sidebar, release = readRelease(), pages = pageVersions()) {
  const decorate = (item) => {
    if (item.items) return { ...item, items: item.items.map(decorate) };
    if (item.slug === undefined || item.badge) return item;
    const badge = badgeFor(pages.get(item.slug), release);
    return badge ? { ...item, badge } : item;
  };
  return sidebar.map(decorate);
}

/** "Abada 1.2.0" or "Abada 1.2.0 (in development)", shown on every page. */
export function versionLabel(release = readRelease()) {
  return `Abada ${release.documents}${release.status === 'in-development' ? ' (in development)' : ''}`;
}
