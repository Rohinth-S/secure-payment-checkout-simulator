import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { StripePaymentClient, verifyStripeSignature } from "../src/providers/stripe.js";

test("verifies a fresh Stripe webhook signature and rejects stale timestamps", () => {
  const secret = "whsec_test"; const timestamp = 1_700_000_000; const body = JSON.stringify({ type: "payment_intent.succeeded" });
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  assert.equal(verifyStripeSignature(body, `t=${timestamp},v1=${signature}`, secret, timestamp), true);
  assert.equal(verifyStripeSignature(body, `t=${timestamp},v1=${signature}`, secret, timestamp + 301), false);
});

test("Stripe client sends an opaque token and idempotency key", async () => {
  let captured: RequestInit | undefined;
  const client = new StripePaymentClient("sk_test_demo", async (_url, init) => { captured = init; return new Response(JSON.stringify({ id: "pi_123", status: "succeeded" }), { status: 200 }); });
  const result = await client.createPaymentIntent({ amountMinor: 1299, currency: "USD", paymentMethodToken: "pm_card_visa", orderId: "ord_1", idempotencyKey: "idem_123456" });
  assert.equal(result.id, "pi_123"); assert.equal(captured?.headers && new Headers(captured.headers).get("idempotency-key"), "idem_123456");
  assert.match(String(captured?.body), /payment_method=pm_card_visa/);
});
