"""Scripted OpenAI-compatible model for the M1 exit demo.

Process inputs `mode` (OK|INVALID|LOW|SLOW) and `caseId` select the reply. Every call is
recorded; GET /calls returns the log so duplicate model calls can be counted.
"""
import json, re, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SLOW_SECONDS = 30
CALLS, LOCK = [], threading.Lock()

REPLIES = {
    "OK": {"priority": "HIGH", "_confidence": 95},
    "SLOW": {"priority": "MEDIUM", "_confidence": 92},
    "LOW": {"priority": "LOW", "_confidence": 40},          # below threshold 85
    "INVALID": {"priority": "URGENT", "_confidence": 99},   # not in the schema enum
}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send(self, code, payload):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/calls":
            with LOCK:
                return self._send(200, CALLS)
        self._send(200, {"ok": True})

    def do_POST(self):
        request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        text = " ".join(str(m.get("content", "")) for m in request.get("messages", []))
        # T6: values arrive as <input name="x">"value"</input> in the user message.
        mode = (re.search(r'<input name="mode">"(\w+)"', text) or [None, "OK"])[1]
        case = (re.search(r'<input name="caseId">"([\w-]+)"', text) or [None, "?"])[1]
        started = time.time()
        with LOCK:
            CALLS.append({"case": case, "mode": mode, "path": self.path,
                          "model": request.get("model"), "started": started,
                          "messages": request.get("messages")})
        print(f"{time.strftime('%H:%M:%S')} call case={case} mode={mode}", flush=True)
        if mode == "SLOW":
            time.sleep(SLOW_SECONDS)
        reply = REPLIES.get(mode, REPLIES["OK"])
        self._send(200, {
            "id": f"demo-{case}", "object": "chat.completion", "model": request.get("model"),
            "choices": [{"index": 0, "finish_reason": "stop",
                         "message": {"role": "assistant", "content": json.dumps(reply)}}],
            "usage": {"prompt_tokens": 42, "completion_tokens": 12, "total_tokens": 54},
        })


ThreadingHTTPServer(("0.0.0.0", 8000), Handler).serve_forever()
