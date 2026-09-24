export const GITHUB_URL = "https://github.com/bashizip/abada-platform";
export const DOCS_URL = "https://docs.abadaplatform.com";
export const DEMO_URL = "/#quickstart";
export const EMAIL = "patrick@abadaplatform.com";
export const CALENDAR_URL = `mailto:${EMAIL}?subject=Abada%20%E2%80%94%20intro%20call`;
export const PILOT_URL = `mailto:${EMAIL}?subject=Abada%20%E2%80%94%20design-partner%20pilot`;
export const INSTALL_CMD = "curl -fsSL https://install.abadaplatform.com/install.sh | bash";

/** Links into the public repository; every target is checked to exist on main. */
const BLOB = `${GITHUB_URL}/blob/main`;
const TREE = `${GITHUB_URL}/tree/main`;
export const LICENSE_URL = `${BLOB}/LICENSE`;
export const SDK_LICENSE_URL = `${BLOB}/sdk/java/LICENSE`;
export const GATE_REPORT_URL = `${BLOB}/docs/development/1.0-rc.6-gate-report-2026-09-23.md`;
export const RELEASE_NOTES_URL = `${BLOB}/docs/release-notes/1.0.0-rc.6-release-notes.md`;
export const EXIT_DEMO_URL = `${TREE}/scripts/test/m1-exit-demo`;
export const EXPRESSION_SANDBOX_URL = `${TREE}/engine/src/main/java/com/abada/engine/expression`;
export const OUTPUT_VALIDATOR_URL = `${BLOB}/engine/src/main/java/com/abada/engine/core/agent/AgentOutputValidator.java`;
export const RUNTIME_STATE_URL = `${BLOB}/docs/architecture/runtime-state.md`;
export const APL_SPEC_URL = `${BLOB}/docs/reference/apl-specification.md`;
