import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "../src/server.js";
import { MemoryCheckoutRepository } from "../src/persistence.js";
import { createHmac } from "node:crypto";

test("checkout endpoint replays an idempotent request", async () => {
  const server = createServer(new MemoryCheckoutRepository());
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/v1/checkouts`;
  const request = { orderId: "ord_server_1", amountMinor: 1299, currency: "USD", paymentMethodToken: "tok_demo", customer: { email: "demo@example.com", ip: "203.0.113.10" } };
  const first = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": "idem_server_123" }, body: JSON.stringify(request) });
  const firstBody = await first.json() as { id: string; replayed: boolean };
  const second = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": "idem_server_123" }, body: JSON.stringify(request) });
  const secondBody = await second.json() as { id: string; replayed: boolean };
  assert.equal(first.status, 201); assert.equal(second.status, 200);
  assert.equal(firstBody.id, secondBody.id); assert.equal(firstBody.replayed, false); assert.equal(secondBody.replayed, true);
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("Stripe webhook updates a persisted provider status after signature verification", async () => {
  const previous = process.env.STRIPE_WEBHOOK_SECRET; process.env.STRIPE_WEBHOOK_SECRET = "whsec_server";
  const repository = new MemoryCheckoutRepository();
  const server = createServer(repository, { createPaymentIntent: async () => ({ id: "pi_server_1", status: "processing" }) });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const checkoutRequest = { orderId: "ord_webhook_1", amountMinor: 1299, currency: "USD", paymentMethodToken: "tok_demo", customer: { email: "demo@example.com", ip: "203.0.113.10" } };
  const checkoutResponse = await fetch(`http://127.0.0.1:${address.port}/v1/checkouts`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": "idem_webhook_123" }, body: JSON.stringify(checkoutRequest) });
  const checkout = await checkoutResponse.json() as { provider?: { id: string } };
  const webhookBody = JSON.stringify({ type: "payment_intent.succeeded", data: { object: { id: checkout.provider?.id, status: "succeeded" } } });
  const timestamp = Math.floor(Date.now() / 1000); const signature = createHmac("sha256", "whsec_server").update(`${timestamp}.${webhookBody}`).digest("hex");
  const webhookResponse = await fetch(`http://127.0.0.1:${address.port}/v1/webhooks/stripe`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": `t=${timestamp},v1=${signature}` }, body: webhookBody });
  const webhook = await webhookResponse.json() as { received: boolean; updated: boolean };
  assert.equal(webhookResponse.status, 200); assert.equal(webhook.received, true); assert.equal(webhook.updated, true);
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (previous === undefined) delete process.env.STRIPE_WEBHOOK_SECRET; else process.env.STRIPE_WEBHOOK_SECRET = previous;
});
