#!/usr/bin/env python3
"""Seeds a capture stack for the 1.2 user-guide screenshots (M5 S14).

Against an engine with OIDC on the dev realm (see README.md): a project with a
sectioned upload form and the employer-declaration process, then instances in
every state the guide shows. The agent steps are played by a script holding the
agent worker's service account, so no model is called: the answers are fixed.

Prints the project id as JSON on the last line.
"""
import base64
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ENGINE = os.environ.get("CAPTURE_ENGINE", "http://localhost:5611/api")
REALM = os.environ.get("CAPTURE_REALM", "http://keycloak.localhost/realms/abada-dev")
HERE = os.path.dirname(os.path.abspath(__file__))
WORKER_ID = "docs-capture-worker"


def token(**form):
    body = urllib.parse.urlencode(form).encode()
    with urllib.request.urlopen(f"{REALM}/protocol/openid-connect/token", body) as response:
        return json.load(response)["access_token"]


ALICE = token(grant_type="password", client_id="abada-frontend", username="alice", password="alice")
BOB = token(grant_type="password", client_id="abada-frontend", username="bob", password="bob")
WORKER = token(grant_type="client_credentials", client_id="abada-agent-worker",
               client_secret="abada-dev-agent-worker-secret")


def call(method, path, body=None, bearer=ALICE, raw=None, headers=None, ok=(200, 201, 204)):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    request = urllib.request.Request(ENGINE + path, data=data, method=method)
    request.add_header("Authorization", f"Bearer {bearer}")
    if raw is None:
        request.add_header("Content-Type", "application/json")
    for key, value in (headers or {}).items():
        request.add_header(key, value)
    try:
        with urllib.request.urlopen(request) as response:
            text = response.read().decode()
            status = response.status
    except urllib.error.HTTPError as error:
        text = error.read().decode()
        status = error.code
    if status not in ok:
        raise SystemExit(f"{method} {path} -> {status}: {text[:400]}")
    return json.loads(text) if text.strip().startswith(("{", "[")) else text


def pdf(title, lines):
    """A small valid one-page PDF with text, standing in for a scanned declaration."""
    content = "BT /F1 16 Tf 60 780 Td (" + title + ") Tj ET\n"
    y = 740
    for line in lines:
        content += f"BT /F1 11 Tf 60 {y} Td ({line}) Tj ET\n"
        y -= 22
    objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R "
        "/Resources << /Font << /F1 5 0 R >> >> >>",
        f"<< /Length {len(content)} >>\nstream\n{content}endstream",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = b"%PDF-1.4\n"
    offsets = []
    for number, obj in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n{obj}\nendobj\n".encode()
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    for offset in offsets:
        out += f"{offset:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return out


def main():
    slug = f"contributions-{int(time.time()) % 100000}"
    project = call("POST", "/v1/projects", {"slug": slug, "name": "Social contributions",
                                             "description": "Employer declarations and contribution checks"})
    pid = project["id"]
    # The creator works the declarations queue too: a task group of the project.
    me = call("GET", f"/v1/projects/{pid}/members")[0]
    call("PUT", f"/v1/projects/{pid}/members/{me['principalId']}", {
        "expectedVersion": me.get("version"), "roles": me["roles"], "reviewLanes": [],
        "taskGroups": ["declarations"]})
    tree = call("GET", f"/v1/projects/{pid}/tree")
    forms = next(node["id"] for node in tree if node["kind"] == "FOLDER" and node["name"] == "forms")
    form = open(os.path.join(HERE, "declaration-depot.json"), "rb").read()
    call("POST", f"/v1/projects/{pid}/resources", {
        "name": "declaration-depot.json", "kind": "FORM", "contentType": "application/json",
        "contentBase64": base64.b64encode(form).decode(), "folderId": forms})
    source = open(os.path.join(HERE, "declaration.apl.yaml")).read()
    document = call("POST", f"/v1/projects/{pid}/documents", {
        "processKey": "employer_declaration", "description": "Monthly employer declaration",
        "aplSource": source, "folderId": None, "fileName": "employer-declaration.apl.yaml"})
    call("POST", f"/v1/projects/{pid}/documents/{document['id']}/deploy",
         headers={"If-Match": f"\"{document.get('revision', document.get('version', 0))}\""})

    # The agent worker's service account serves agent work, as the real worker would.
    call("PUT", "/v1/workers/me", {"topics": ["abada:agent"], "models": []}, bearer=WORKER)

    employers = [("Kivu Logistics SARL", "EMP-104233", 42, 186_400_000, 26_096_000, 92),
                 ("Lualaba Mining Services", "EMP-208871", 310, 1_402_000_000, 168_240_000, 88),
                 ("Bandal Print House", "EMP-311902", 9, 21_600_000, 1_944_000, 55),
                 ("Gombe Pharmacies", "EMP-117045", 17, 48_300_000, 6_762_000, None)]
    created = {}
    for name, number, headcount, payroll, contributions, confidence in employers:
        iid = call("POST", f"/v1/projects/{pid}/processes/employer_declaration/start",
                   {"employer": name, "employer_number": number})["processInstanceId"]
        task = next(t for t in call("GET", f"/v1/projects/{pid}/tasks?status=AVAILABLE")
                    if t.get("processInstanceId") == iid)
        scan = pdf(f"Monthly declaration - {name}", [
            f"Employer number: {number}", "Period: 2026-10", f"Headcount: {headcount}",
            f"Gross payroll (CDF): {payroll:,}", f"Contributions due (CDF): {contributions:,}",
            "Signed and stamped by the employer"])
        uploaded = call("POST", f"/v1/projects/{pid}/tasks/{task['id']}/files?field=declaration_scan&name="
                        + urllib.parse.quote(f"declaration-{number}-2026-10.pdf"),
                        raw=scan, headers={"Content-Type": "application/octet-stream"})
        call("POST", f"/v1/projects/{pid}/tasks/{task['id']}/complete", {
            "employer": name, "employer_number": number, "period": "2026-10",
            "headcount_declared": headcount, "declaration_scan": uploaded["fileId"],
            "notes": "Original stamped copy received at the counter"})
        created[name] = (iid, uploaded, payroll, contributions, headcount, confidence, scan)

    # The agent reads each declaration (fixed answers), except the last, which fails for good.
    for _ in range(10):
        locked = call("POST", "/v1/external-tasks/fetch-and-lock", {
            "workerId": WORKER_ID, "topics": ["abada:agent"], "lockDuration": 120000, "maxTasks": 10},
            bearer=WORKER)
        if not locked:
            break
        for work in locked:
            entry = next(v for v in created.values() if v[0] == work["processInstanceId"])
            iid, uploaded, payroll, contributions, headcount, confidence, scan = entry
            files = [{"name": f["name"], "fileId": f["fileId"], "sha256": f["sha256"]}
                     for f in work["agentWork"].get("resolvedFiles", [])]
            downloaded = call("GET", f"/v1/external-tasks/{work['id']}/files/{uploaded['fileId']}"
                              f"?workerId={WORKER_ID}", bearer=WORKER, ok=(200,))
            assert hashlib.sha256(downloaded.encode("latin-1") if isinstance(downloaded, str)
                                  else downloaded).hexdigest() or True
            attempt = work.get("attempt") or 1
            if confidence is None:
                call("POST", f"/v1/external-tasks/{work['id']}/failure", {
                    "workerId": WORKER_ID, "errorMessage": "google-gemini model 'gemini-3.6-flash' could not read"
                    " the files of this call (HTTP 400: image too blurry to read)", "retries": 0,
                    "retryTimeout": 0}, bearer=WORKER)
                continue
            request = {"turn": 1, "model": "gemini-3.6-flash", "files": files}
            answer = {"payroll": payroll, "headcount": headcount, "contributions": contributions,
                      "_confidence": confidence}
            for state, result, tokens in (("STARTED", None, (None, None)),
                                          ("COMPLETED", {"value": answer, "confidence": confidence}, (2310, 64))):
                step = {"workerId": WORKER_ID, "attempt": attempt, "sequence": 1, "kind": "MODEL_CALL",
                        "state": state, "request": request, "model": "gemini-3.6-flash"}
                if result is not None:
                    step.update(result=result, promptTokens=tokens[0], completionTokens=tokens[1])
                call("POST", f"/v1/external-tasks/{work['id']}/steps", step, bearer=WORKER)
            call("POST", f"/v1/external-tasks/{work['id']}/complete", {
                "workerId": WORKER_ID, "variables": {"lecture": answer},
                "agent": {"model": "gemini-3.6-flash", "provider": "google-gemini", "attempt": 1,
                          "durationMs": 4120, "tools": [], "resultVariable": "lecture",
                          "confidence": confidence, "promptTokens": 2310, "completionTokens": 64}},
                bearer=WORKER)

    # The first declaration is confirmed by the officer: a complete path from start to end.
    first = created["Kivu Logistics SARL"][0]
    verification = next(t for t in call("GET", f"/v1/projects/{pid}/tasks?status=AVAILABLE")
                        if t.get("processInstanceId") == first)
    call("POST", f"/v1/projects/{pid}/tasks/{verification['id']}/decision", {"outcome": "accept"})

    # Two declarations still to upload, so the inbox and the live view have work.
    for name, number in (("Matadi Port Handling", "EMP-402219"), ("Kasai Agro Cooperative", "EMP-509334")):
        call("POST", f"/v1/projects/{pid}/processes/employer_declaration/start",
             {"employer": name, "employer_number": number})

    # Administrative changes for the audit trail, and one refused attempt.
    call("PUT", f"/v1/projects/{pid}", {"expectedVersion": project["version"], "name": "Social contributions",
                                        "description": "Employer declarations, contribution checks and follow-up"})
    call("PUT", f"/v1/projects/{pid}/file-policy", {"retentionDays": 3650})
    call("PUT", "/v1/ai-providers/gemini-docs", {"providerType": "gemini", "apiKey": "docs-capture-key",
                                                 "enabled": False}, ok=(200,))
    call("PUT", "/v1/ai-providers/gemini-docs", {"providerType": "gemini"}, bearer=BOB, ok=(403,))
    call("PUT", f"/v1/projects/{pid}", {"expectedVersion": 0, "name": "Taken over"}, bearer=BOB, ok=(404,))

    print(json.dumps({"projectId": pid, "instances": {k: v[0] for k, v in created.items()}}))


if __name__ == "__main__":
    sys.exit(main())
