/**
 * Single source for release facts shown on the site. Update from the recorded
 * release-gate report (docs/development/*gate-report*) when a candidate is
 * published; never hand-edit numbers in components.
 */
export const RELEASE_VERSION = "1.0.0-rc.6";
export const RELEASE_LABEL = "Evaluation release candidate";
/** Tests in the recorded release gate for RELEASE_VERSION, or null when not recorded. */
export const RELEASE_GATE_TESTS: number | null = 390;
