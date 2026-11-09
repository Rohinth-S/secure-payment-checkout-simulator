import assert from "node:assert/strict";
import test from "node:test";
import { createCheckout, evaluateFraud, type FraudPolicy } from "../src/domain/checkout.js";
import { MetricsRegistry } from "../src/metrics.js";
import { ReconciliationOutbox } from "../src/outbox.js";

test("risk policy versions make fraud decisions reproducible", () => {
  const input = { orderId: "ord_policy_1", amountMinor: 5000, currency: "USD", paymentMethodToken: "tok_demo", customer: { email: "buyer@example.com", ip: "203.0.113.8" } };
  const conservative: FraudPolicy = { version: "2026-02-conservative", highAmountMinor: 4000, highAmountScore: 60, syntheticDomainScore: 40, testNetworkScore: 25, reviewThreshold: 35, denyThreshold: 70 };
  const decision = evaluateFraud(input, conservative);
  assert.equal(decision.decision, "review");
  assert.equal(decision.score, 60);
  assert.equal(createCheckout(input, new Date("2026-02-01T00:00:00Z"), conservative).fraud.score, 60);
});

test("reconciliation outbox deduplicates provider events and supports acknowledgement", () => {
  const outbox = new ReconciliationOutbox();
  outbox.enqueue({ providerId: "pi_1", status: "processing", receivedAt: "2026-02-01T00:00:00Z" });
  outbox.enqueue({ providerId: "pi_1", status: "succeeded", receivedAt: "2026-02-01T00:00:01Z" });
  outbox.enqueue({ providerId: "pi_2", status: "failed", receivedAt: "2026-02-01T00:00:02Z" });
  assert.equal(outbox.size(), 2);
  assert.deepEqual(outbox.peek(10).map((event) => event.status), ["succeeded", "failed"]);
  assert.equal(outbox.acknowledge("pi_1"), true);
  assert.equal(outbox.acknowledge("pi_1"), false);
  assert.equal(outbox.size(), 1);
});

test("metrics registry returns immutable snapshots of counters and gauges", () => {
  const metrics = new MetricsRegistry();
  metrics.increment("checkouts.created");
  metrics.increment("checkouts.created", 2);
  metrics.setGauge("reconciliation.pending", 3);
  const snapshot = metrics.snapshot();
  assert.deepEqual(snapshot, { counters: { "checkouts.created": 3 }, gauges: { "reconciliation.pending": 3 } });
  snapshot.counters["checkouts.created"] = 99;
  assert.equal(metrics.snapshot().counters["checkouts.created"], 3);
});
