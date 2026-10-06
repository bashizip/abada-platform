"""Scripted OpenAI-compatible model for the M3 demo and the "agent that acts" tutorial.

Plays the refund agent deterministically, so runs and screenshots are reproducible:
  1. it reads the order with payments__get_order;
  2. when the order arrived damaged or was lost, it proposes payments__refund for
     the amount paid; otherwise it refunds nothing;
  3. after the refund's result (or its rejection) it answers with the decision.
Agents without tools get a generic confident answer. Every reply reports token
usage, so the engine can price the calls. Listens on port 8000 (/v1/chat/completions).
"""
import json
import os
import re
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("STUB_LLM_PORT", "8000"))


def log(message):
    print(f"{time.strftime('%H:%M:%S')} {message}", flush=True)


def tool_call(name, arguments, call_id):
    return {"role": "assistant", "content": None, "tool_calls": [
        {"id": call_id, "type": "function", "function": {"name": name, "arguments": json.dumps(arguments)}}]}


def answer(payload):
    return {"role": "assistant", "content": json.dumps(payload)}


def refund_agent(messages):
    text = " ".join(str(m.get("content") or "") for m in messages if m.get("role") == "user")
    match = re.search(r'<input name="request">(.*?)</input>', text, re.S)
    request = json.loads(match.group(1)) if match else {}
    order_id = request.get("order_id", "A-1042")
    calls = {}  # call id -> function name
    for message in messages:
        for call in message.get("tool_calls") or []:
            calls[call["id"]] = call["function"]["name"]
    results = [(calls.get(m.get("tool_call_id")), str(m.get("content") or ""))
               for m in messages if m.get("role") == "tool"]
    done = {name for name, _ in results}

    if "payments__refund" in done:
        content = next(content for name, content in reversed(results) if name == "payments__refund")
        if re.search(r"reject|denied|not performed", content, re.I):
            return answer({"refunded": False, "reason": "Finance rejected the refund: " + content[:200],
                           "_confidence": 90})
        amount = next((json.loads(c).get("paid") for n, c in results if n == "payments__get_order"), None)
        return answer({"refunded": True, "amount": amount,
                       "reason": f"Order {order_id} arrived damaged; the amount paid was refunded.",
                       "_confidence": 92})
    if "payments__get_order" in done:
        order = json.loads(next(c for n, c in results if n == "payments__get_order"))
        note = (order.get("delivery_note", "") + " " + order.get("status", "")).lower()
        if any(word in note for word in ("broken", "damaged", "lost")):
            return tool_call("payments__refund", {"order_id": order_id, "amount": order.get("paid")}, "call-refund")
        return answer({"refunded": False, "amount": 0,
                       "reason": f"Order {order_id} was delivered in good condition.", "_confidence": 90})
    return tool_call("payments__get_order", {"order_id": order_id}, "call-get-order")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        self._send(200, {"ok": True})

    def do_POST(self):
        request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        messages = request.get("messages", [])
        offered = {tool.get("function", {}).get("name") for tool in request.get("tools") or []}
        if "payments__get_order" in offered:
            message = refund_agent(messages)
        else:
            message = answer({"summary": "Handled by the scripted test model", "_confidence": 90})
        kind = message["tool_calls"][0]["function"]["name"] if message.get("tool_calls") else "answer"
        log(f"{request.get('model')} -> {kind}")
        self._send(200, {
            "id": f"stub-{time.time_ns()}", "object": "chat.completion", "model": request.get("model"),
            "choices": [{"index": 0, "message": message,
                         "finish_reason": "tool_calls" if message.get("tool_calls") else "stop"}],
            "usage": {"prompt_tokens": 1200, "completion_tokens": 80, "total_tokens": 1280},
        })

    def _send(self, code, payload):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


log(f"scripted model on :{PORT}")
ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
