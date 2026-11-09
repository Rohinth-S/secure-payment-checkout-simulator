import http from "node:http"; import { randomUUID } from "node:crypto"; import { Pool } from "pg"; import { createCheckout, type CheckoutRequest } from "./domain/checkout.js"; import { AuditLog } from "./audit.js"; import { MemoryCheckoutRepository, PostgresCheckoutRepository, type CheckoutRepository } from "./persistence.js"; import { StripePaymentClient, verifyStripeSignature } from "./providers/stripe.js";
function send(res:http.ServerResponse,status:number,body:unknown){res.writeHead(status,{"content-type":"application/json","cache-control":"no-store"});res.end(JSON.stringify(body))}
async function rawBody(req:http.IncomingMessage){let raw=""; for await(const chunk of req) raw+=chunk; if(raw.length>100_000) throw new Error("payload too large"); return raw;}
export function createServer(repository: CheckoutRepository = defaultRepository(), stripeClient?: StripePaymentClient) {
  const audit = new AuditLog();
  return http.createServer(async (req, res) => {
    const requestId = req.headers["x-request-id"]?.toString() ?? randomUUID();
    try {
      if (req.method === "GET" && req.url === "/health") { send(res, 200, { ok: true }); return; }
      if (req.method === "POST" && req.url === "/v1/webhooks/stripe") {
        const raw = await rawBody(req);
        const secret = process.env.STRIPE_WEBHOOK_SECRET;
        if (!secret || !verifyStripeSignature(raw, req.headers["stripe-signature"]?.toString(), secret)) { send(res, 400, { error: "invalid_webhook_signature", requestId }); return; }
        const event = JSON.parse(raw) as { type?: string; data?: { object?: { id?: string; status?: string } } };
        const providerId = event.data?.object?.id;
        const providerStatus = event.data?.object?.status;
        const updated = providerId && providerStatus ? await repository.updateProvider(providerId, { id: providerId, status: providerStatus }) : undefined;
        send(res, 200, { received: true, updated: Boolean(updated), requestId }); return;
      }
      if (req.method !== "POST" || req.url !== "/v1/checkouts") { send(res, 404, { error: "not_found", requestId }); return; }
      const key = req.headers["idempotency-key"]?.toString();
      if (!key || key.length < 12 || key.length > 128) { send(res, 400, { error: "idempotency_key_required", requestId }); return; }
      const existing = await repository.findByIdempotencyKey(key);
      if (existing) { audit.append({ type: "checkout.replayed", checkoutId: existing.id, orderId: existing.orderId, requestId, at: new Date().toISOString() }); send(res, 200, { ...existing, replayed: true, requestId }); return; }
      const input = JSON.parse(await rawBody(req)) as CheckoutRequest;
      let result = await repository.save(key, createCheckout(input));
      if (stripeClient && result.status === "authorized") {
        try {
          const intent = await stripeClient.createPaymentIntent({ amountMinor: result.amountMinor, currency: result.currency, paymentMethodToken: input.paymentMethodToken, orderId: result.orderId, idempotencyKey: key });
          result = await repository.updateProvider(result.id, { id: intent.id, status: intent.status }) ?? result;
        } catch (error) {
          const message = error instanceof Error ? error.message : "provider request failed";
          send(res, 502, { error: "provider_error", message, requestId }); return;
        }
      }
      audit.append({ type: "checkout.created", checkoutId: result.id, orderId: result.orderId, requestId, at: result.createdAt });
      send(res, result.status === "declined" ? 402 : 201, { ...result, replayed: false, requestId });
    } catch (error) {
      const message = error instanceof Error ? error.message : "invalid_request";
      send(res, 400, { error: "invalid_request", message, requestId });
    }
  });
}

function defaultRepository(): CheckoutRepository {
  const url = process.env.DATABASE_URL;
  return url ? new PostgresCheckoutRepository(new Pool({ connectionString: url, max: 10 })) : new MemoryCheckoutRepository();
}

function defaultStripeClient() {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) return undefined;
  if (!/^sk_(test|live)_/.test(secret)) throw new Error("STRIPE_SECRET_KEY must be a Stripe secret key");
  if (secret.startsWith("sk_live_") && process.env.ALLOW_LIVE_STRIPE !== "true") throw new Error("live Stripe keys require ALLOW_LIVE_STRIPE=true");
  if (!process.env.STRIPE_WEBHOOK_SECRET) throw new Error("STRIPE_WEBHOOK_SECRET is required when Stripe is enabled");
  return new StripePaymentClient(secret);
}

const invokedAsServer = process.argv[1]?.endsWith("server.js") || process.argv[1]?.endsWith("server.ts");
if (invokedAsServer && process.env.NODE_ENV !== "test") {
  const server = createServer(defaultRepository(), defaultStripeClient());
  const port = Number(process.env.PORT ?? "8080");
  server.listen(port, () => console.log(`checkout simulator listening on :${port}`));
}
