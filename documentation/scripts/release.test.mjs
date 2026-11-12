import assert from 'node:assert/strict';
import { test } from 'node:test';
import { badgeFor, compareVersions, releaseProblems, versionLabel, withBadges } from '../src/lib/release.mjs';

const pages = (entries) => new Map([['release-notes/1-2', { file: 'notes.mdx' }], ...entries]);
const same = (version) => ({ engine: version, studio: version, documentation: version });

test('a release in development needs the components still on an earlier version', () => {
  const release = { documents: '1.2.0', status: 'in-development' };
  assert.deepEqual(releaseProblems(release, same('1.1.2'), pages([])), []);
  assert.match(releaseProblems(release, same('1.2.0'), pages([]))[0], /set status to released/);
});

test('a released documentation needs every component on that version', () => {
  const release = { documents: '1.2.0', status: 'released' };
  assert.deepEqual(releaseProblems(release, same('1.2.0'), pages([])), []);
  assert.match(releaseProblems(release, same('1.1.2'), pages([]))[0], /components are 1.1.2/);
  assert.match(releaseProblems(release, { engine: '1.2.0', studio: '1.1.2', documentation: '1.2.0' }, pages([]))[0],
    /disagree/);
});

test('a page cannot claim a later version, and the release notes page must exist', () => {
  const release = { documents: '1.2.0', status: 'in-development' };
  const problems = releaseProblems(release, same('1.1.2'),
    new Map([['user/x', { file: 'x.mdx', since: '1.3.0' }], ['user/y', { file: 'y.mdx', updated: 'soon' }]]));
  assert.equal(problems.length, 3);
  assert.match(problems.join('\n'), /later than the documented release/);
  assert.match(problems.join('\n'), /not a version/);
  assert.match(problems.join('\n'), /no release notes page for 1.2/);
});

test('badges show for the documented minor only', () => {
  const release = { documents: '1.2.0', status: 'released' };
  assert.deepEqual(badgeFor({ since: '1.2.0' }, release), { text: 'New', variant: 'tip' });
  assert.deepEqual(badgeFor({ updated: '1.2.0' }, release), { text: 'Updated', variant: 'note' });
  assert.equal(badgeFor({ since: '1.1.0' }, release), undefined);
  assert.equal(badgeFor({ since: '1.2.0' }, { documents: '1.3.0', status: 'released' }), undefined);
  const sidebar = withBadges([{ label: 'Group', items: [{ label: 'A', slug: 'a' }, { label: 'B', slug: 'b' }] }],
    release, new Map([['a', { since: '1.2.0' }], ['b', {}]]));
  assert.deepEqual(sidebar[0].items[0].badge, { text: 'New', variant: 'tip' });
  assert.equal(sidebar[0].items[1].badge, undefined);
  assert.equal(versionLabel({ documents: '1.2.0', status: 'in-development' }), 'Abada 1.2.0 (in development)');
  assert.equal(compareVersions('1.10.0', '1.9.9') > 0, true);
});
