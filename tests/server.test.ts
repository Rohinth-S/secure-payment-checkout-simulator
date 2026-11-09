import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "../src/server.js";
import { MemoryCheckoutRepository } from "../src/persistence.js";

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
