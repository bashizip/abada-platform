// Fails the build when the documented release and the component versions disagree,
// or when a page claims a version later than the one documented (M5 S13).
import { componentVersions, readRelease, releaseProblems, versionLabel } from '../src/lib/release.mjs';

const problems = releaseProblems();
if (problems.length) {
  console.error('Release check failed:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
const versions = componentVersions();
console.log(`Release check OK: documenting ${versionLabel(readRelease())}; engine, Studio and documentation at ${versions.engine}.`);
