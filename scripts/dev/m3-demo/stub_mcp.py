"""Stub `payments` MCP server for the M3 demo and the "agent that acts" tutorial.

MCP over streamable HTTP (JSON responses) on port 8765, path /mcp, with two tools:
  get_order(order_id)        read: the order, its status and the amount paid
  refund(order_id, amount)   write: records a refund; takes no idempotency key

Touch the crash flag (default /tmp/payments-crash-next-refund) to make the next
refund take effect and then fail before answering, as a server crashing mid-write
would. GET /refunds lists the refunds that took effect, so you can check what
really happened before confirming an unknown outcome. Demo data only.
"""
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("STUB_MCP_PORT", "8765"))
CRASH_FLAG = os.environ.get("STUB_MCP_CRASH_FLAG", "/tmp/payments-crash-next-refund")

ORDERS = {
    "A-1042": {"order_id": "A-1042", "item": "Electric kettle", "paid": 49.90, "currency": "EUR",
               "status": "delivered", "delivery_note": "Customer reported the kettle arrived broken"},
    "A-2001": {"order_id": "A-2001", "item": "Desk lamp", "paid": 35.00, "currency": "EUR",
               "status": "delivered", "delivery_note": "Delivered in good condition"},
    "A-3300": {"order_id": "A-3300", "item": "Headphones", "paid": 89.00, "currency": "EUR",
               "status": "lost", "delivery_note": "Carrier confirmed the parcel was lost"},
}
TOOLS = [
    {"name": "get_order", "description": "Read an order: item, amount paid, delivery status",
     "inputSchema": {"type": "object", "required": ["order_id"],
                     "properties": {"order_id": {"type": "string"}}}},
    {"name": "refund", "description": "Refund an amount of an order to the customer",
     "inputSchema": {"type": "object", "required": ["order_id", "amount"],
                     "properties": {"order_id": {"type": "string"}, "amount": {"type": "number"}}}},
]
REFUNDS, LOCK = [], threading.Lock()


def log(message):
    print(f"{time.strftime('%H:%M:%S')} {message}", flush=True)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _json(self, code, payload, headers=None):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def _empty(self, code):
        self.send_response(code)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        if self.path == "/refunds":
            with LOCK:
                return self._json(200, REFUNDS)
        self._empty(405)  # no server-initiated stream

    def do_DELETE(self):
        self._empty(200)

    def do_POST(self):
        if self.path != "/mcp":
            return self._empty(404)
        request = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))) or b"{}")
        if "id" not in request:  # a notification
            return self._empty(202)
        method, params = request.get("method"), request.get("params") or {}
        headers = {}
        if method == "initialize":
            result = {"protocolVersion": params.get("protocolVersion", "2025-06-18"),
                      "capabilities": {"tools": {}},
                      "serverInfo": {"name": "stub-payments", "version": "1"}}
            headers["Mcp-Session-Id"] = "stub-payments-session"
        elif method == "tools/list":
            result = {"tools": TOOLS}
        elif method == "tools/call":
            result = self._call(params.get("name"), params.get("arguments") or {})
            if result is None:  # crashed after the write took effect
                return self._empty(503)
        else:
            return self._json(200, {"jsonrpc": "2.0", "id": request["id"],
                                    "error": {"code": -32601, "message": "Method not found"}})
        self._json(200, {"jsonrpc": "2.0", "id": request["id"], "result": result}, headers)

    def _call(self, tool, arguments):
        if tool == "get_order":
            order = ORDERS.get(str(arguments.get("order_id", "")))
            log(f"get_order {arguments.get('order_id')}")
            if order is None:
                return text({"error": "no such order"}, error=True)
            return text(order)
        if tool == "refund":
            order_id, amount = str(arguments.get("order_id", "")), arguments.get("amount")
            if order_id not in ORDERS or not isinstance(amount, (int, float)) or amount <= 0:
                return text({"error": "invalid refund"}, error=True)
            with LOCK:
                refund = {"refund_id": f"R-{len(REFUNDS) + 1:04d}", "order_id": order_id, "amount": amount,
                          "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
                REFUNDS.append(refund)
            log(f"refund {order_id} {amount} -> {refund['refund_id']}")
            if os.path.exists(CRASH_FLAG):
                os.remove(CRASH_FLAG)
                log("crash flag set: the refund took effect, failing before the answer")
                return None
            return text(refund)
        return text({"error": f"unknown tool {tool}"}, error=True)


def text(payload, error=False):
    result = {"content": [{"type": "text", "text": json.dumps(payload)}]}
    if error:
        result["isError"] = True
    return result


log(f"stub payments MCP server on :{PORT}/mcp (crash flag {CRASH_FLAG})")
ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
