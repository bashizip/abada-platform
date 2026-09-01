#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

require_command curl
require_command jq
require_command base64

temporary="$(mktemp -d)"
trap 'rm -rf "$temporary"' EXIT
AUTH_HEADER="$temporary/alice.header"
create_alice_auth_header "$AUTH_HEADER"

projects="$(curl --fail --silent --show-error -H @"$AUTH_HEADER" "$API_URL/v1/projects")"
project_id="$(jq -r --arg slug "$PROJECT_SLUG" '.[] | select(.slug == $slug) | .id' <<<"$projects" | head -1)"
if [[ -z "$project_id" ]]; then
  project_id="$(curl --fail --silent --show-error -X POST "$API_URL/v1/projects" \
    -H @"$AUTH_HEADER" -H 'Content-Type: application/json' \
    --data '{"slug":"google-ai-lab-demo","name":"Google AI Lab Demo","description":"Local, non-sensitive submission demo"}' \
    | jq -er '.id')"
fi

tree="$(curl --fail --silent --show-error -H @"$AUTH_HEADER" "$API_URL/v1/projects/$project_id/tree")"
processes_folder="$(jq -r '.. | objects | select(.kind == "FOLDER" and .name == "processes") | .id' <<<"$tree" | head -1)"
forms_folder="$(jq -r '.. | objects | select(.kind == "FOLDER" and .name == "forms") | .id' <<<"$tree" | head -1)"
[[ -n "$processes_folder" && -n "$forms_folder" ]] || { echo "Error: system folders are missing" >&2; exit 69; }

form_node="$(jq -c '.. | objects | select(.kind == "RESOURCE" and .name == "lead-triage-review.json")' <<<"$tree" | head -1)"
form_base64="$(base64 <"$DEMO_DIR/lead-triage-review.json" | tr -d '\n')"
if [[ -z "$form_node" ]]; then
  curl --fail --silent --show-error -o /dev/null -X POST "$API_URL/v1/projects/$project_id/resources" \
    -H @"$AUTH_HEADER" -H 'Content-Type: application/json' \
    --data "$(jq -n --arg name 'lead-triage-review.json' --arg folder "$forms_folder" --arg content "$form_base64" \
      '{name:$name,folderId:$folder,kind:"FORM",contentType:"application/json",contentBase64:$content}')"
else
  form_id="$(jq -r '.id' <<<"$form_node")"
  form_revision="$(jq -r '.revision' <<<"$form_node")"
  curl --fail --silent --show-error -o /dev/null -X PUT "$API_URL/v1/projects/$project_id/resources/$form_id" \
    -H @"$AUTH_HEADER" -H 'Content-Type: application/json' \
    --data "$(jq -n --argjson revision "$form_revision" --arg content "$form_base64" \
      '{expectedRevision:$revision,contentType:"application/json",contentBase64:$content}')"
fi

documents="$(curl --fail --silent --show-error -H @"$AUTH_HEADER" "$API_URL/v1/projects/$project_id/documents?size=100")"
document="$(jq -c --arg key "$PROCESS_KEY" '.[] | select(.processKey == $key)' <<<"$documents" | head -1)"
apl_source="$(<"$DEMO_DIR/lead-triage.apl.yaml")"
if [[ -z "$document" ]]; then
  document="$(curl --fail --silent --show-error -X POST "$API_URL/v1/projects/$project_id/documents" \
    -H @"$AUTH_HEADER" -H 'Content-Type: application/json' \
    --data "$(jq -n --arg key "$PROCESS_KEY" --arg description 'Real Gemini lead-triage and governed Insight demo' \
      --arg source "$apl_source" --arg folder "$processes_folder" \
      '{processKey:$key,description:$description,aplSource:$source,folderId:$folder,fileName:"google-lab-lead-triage.apl.yaml"}')")"
else
  document_id="$(jq -r '.id' <<<"$document")"
  revision="$(jq -r '.revision' <<<"$document")"
  document="$(curl --fail --silent --show-error -X PUT "$API_URL/v1/projects/$project_id/documents/$document_id" \
    -H @"$AUTH_HEADER" -H 'Content-Type: application/json' -H "If-Match: $revision" \
    --data "$(jq -n --arg description 'Real Gemini lead-triage and governed Insight demo' --arg source "$apl_source" \
      '{description:$description,aplSource:$source}')")"
fi

document_id="$(jq -r '.id' <<<"$document")"
revision="$(jq -r '.revision' <<<"$document")"
deployment="$(curl --fail --silent --show-error -X POST "$API_URL/v1/projects/$project_id/documents/$document_id/deploy" \
  -H @"$AUTH_HEADER" -H "If-Match: $revision")"

printf '%s\n' "$project_id" >"$DEMO_DIR/.project-id"
printf '%s\n' "$document_id" >"$DEMO_DIR/.document-id"
echo "Project: Google AI Lab Demo ($project_id)"
echo "Process: $PROCESS_KEY v$(jq -r '.version' <<<"$deployment")"
echo "Form: lead-triage-review"
