# Abada Java worker client

`io.abada:abada-worker-client:1.0.0-rc.4` implements Abada external-worker
protocol version 1. It supports bounded fetch-and-lock, heartbeat and explicit
lock extension, completion, BPMN error, technical failure/retry, idempotency
keys, bearer authentication, and W3C trace-context propagation.

```java
var client = new AbadaWorkerClient(
    URI.create("https://engine.example.com/api"),
    () -> accessTokenProvider.currentToken());

var tasks = client.fetchAndLock(
    "payments-worker-1",
    List.of("payments"),
    Duration.ofSeconds(30),
    10,
    new RequestOptions(UUID.randomUUID().toString(), traceparent, tracestate));

for (var task : tasks) {
    client.complete(task.id(), "payments-worker-1", Map.of("paid", true),
        RequestOptions.defaults());
}
```

Workers must reuse a stable idempotency key when retrying the same mutation.
External side effects remain at-least-once and must be deduplicated by the
worker. The engine URL passed to the client includes the `/api` context path.
