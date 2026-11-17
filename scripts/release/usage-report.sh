#!/usr/bin/env bash
# Install report: who installed Abada, when, from where and with what result.
#
#   scripts/release/usage-report.sh [summary|daily|countries|failures|versions|platforms|agents|recent|raw "<sql>"] [--local] [DAYS]
#
# Reads the D1 database `abada-usage` behind install.abadaplatform.com (install/README.md,
# "Install events"). Needs `wrangler` logged in to the Cloudflare account. Rows older than
# 13 months are deleted by the Worker, and a row never holds an IP address.
#
# Reading the numbers:
#   installer_fetch    the installer script was downloaded (intent; includes people who only read it)
#   version_check      /latest was asked for (a started install, or a script that checks the version)
#   bundle_download    the release archive was downloaded (an install that got this far)
#   install_succeeded / install_failed   the one report the installer sends when it finishes, unless the
#                      person opted out (ABADA_USAGE_PING=0 or DO_NOT_TRACK=1). Opt-outs are therefore
#                      visible only as fetches without a report; treat reports as a floor, not a count.
#   unique installers  distinct random install ids: one installation counts once.
set -euo pipefail

MODE="summary"
LOCAL=""
DAYS=30
RAW_SQL=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    summary|daily|countries|failures|versions|platforms|agents|recent) MODE="$1" ;;
    raw) MODE="raw"; shift; RAW_SQL="${1:?raw needs an SQL statement}" ;;
    --local) LOCAL="--local" ;;
    ''|*[!0-9]*) echo "Unknown argument: $1" >&2; exit 2 ;;
    *) DAYS="$1" ;;
  esac
  shift
done
[[ "$DAYS" -ge 1 && "$DAYS" -le 400 ]] || { echo "DAYS must be between 1 and 400" >&2; exit 2; }

# wrangler finds the database through the Worker's configuration.
cd "$(dirname "${BASH_SOURCE[0]}")/../../install/worker"

command -v wrangler >/dev/null 2>&1 || { echo "wrangler is required (npm i -g wrangler)" >&2; exit 1; }
SINCE="date('now','-${DAYS} days')"
REMOTE="${LOCAL:---remote}"

query() {
  printf '\n== %s\n' "$1"
  wrangler d1 execute abada-usage $REMOTE --json --command "$2" 2>/dev/null | python3 -c '
import json, sys
try:
    rows = json.load(sys.stdin)[0]["results"]
except Exception:
    sys.exit("no result (is wrangler logged in, and does the database exist?)")
if not rows:
    print("(no rows)")
    sys.exit(0)
cols = list(rows[0])
cells = [[("" if r[c] is None else str(r[c])) for c in cols] for r in rows]
width = [max(len(c), *(len(row[i]) for row in cells)) for i, c in enumerate(cols)]
print("  ".join(c.ljust(w) for c, w in zip(cols, width)))
print("  ".join("-" * w for w in width))
for row in cells:
    print("  ".join(v.ljust(w) for v, w in zip(row, width)))
'
}

case "$MODE" in
  summary)
    query "Last ${DAYS} days by kind" \
      "SELECT kind, COUNT(*) AS events, COUNT(DISTINCT install_id) AS distinct_installs FROM install_events WHERE received_at >= ${SINCE} GROUP BY kind ORDER BY events DESC"
    query "Install outcome (reports from installers; ci = our own runners)" \
      "SELECT kind, ci, COUNT(*) AS n FROM install_events WHERE kind IN ('install_succeeded','install_failed') AND received_at >= ${SINCE} GROUP BY kind, ci"
    ;;
  daily)
    query "Per day: downloads, reports, unique installers" \
      "SELECT substr(received_at,1,10) AS day, SUM(kind='bundle_download') AS bundle_downloads, SUM(kind='install_succeeded') AS succeeded, SUM(kind='install_failed') AS failed, COUNT(DISTINCT install_id) AS distinct_installs FROM install_events WHERE received_at >= ${SINCE} GROUP BY day ORDER BY day DESC"
    ;;
  countries)
    query "Where installs come from (reports, excluding CI)" \
      "SELECT country, region, COUNT(*) AS installs FROM install_events WHERE kind='install_succeeded' AND COALESCE(ci,0)=0 AND received_at >= ${SINCE} GROUP BY country, region ORDER BY installs DESC LIMIT 50"
    ;;
  failures)
    query "Failed installs by step" \
      "SELECT failed_step, COUNT(*) AS n, group_concat(DISTINCT os) AS os FROM install_events WHERE kind='install_failed' AND COALESCE(ci,0)=0 AND received_at >= ${SINCE} GROUP BY failed_step ORDER BY n DESC"
    ;;
  versions)
    query "Installs per release" \
      "SELECT version, SUM(kind='bundle_download') AS bundle_downloads, SUM(kind='install_succeeded') AS succeeded, SUM(kind='install_failed') AS failed FROM install_events WHERE version IS NOT NULL AND received_at >= ${SINCE} GROUP BY version ORDER BY version DESC"
    ;;
  platforms)
    query "OS, CPU and Docker" \
      "SELECT os, arch, docker_version, COUNT(*) AS installs FROM install_events WHERE kind='install_succeeded' AND COALESCE(ci,0)=0 AND received_at >= ${SINCE} GROUP BY os, arch, docker_version ORDER BY installs DESC LIMIT 30"
    ;;
  agents)
    query "Clients by User-Agent (recorded since migration 0003; older rows show no agent)" \
      "SELECT COALESCE(user_agent,'(none)') AS user_agent, SUM(kind='installer_fetch') AS script_fetches, SUM(kind='version_check') AS version_checks, SUM(kind='bundle_download') AS bundle_downloads, SUM(kind IN ('install_succeeded','install_failed')) AS reports FROM install_events WHERE received_at >= ${SINCE} GROUP BY user_agent ORDER BY COUNT(*) DESC LIMIT 40"
    ;;
  recent)
    query "Most recent reports" \
      "SELECT received_at, kind, version, country, os, arch, failed_step, duration_s FROM install_events WHERE kind IN ('install_succeeded','install_failed') ORDER BY id DESC LIMIT 25"
    ;;
  raw)
    query "raw" "$RAW_SQL"
    ;;
esac
