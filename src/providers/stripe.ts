import { createHmac, timingSafeEqual } from "node:crypto";

export type StripePaymentIntent = { id: string; status: string; client_secret?: string };

export class StripePaymentClient {
  constructor(private readonly secretKey: string, private readonly fetcher: typeof fetch = fetch) {}

  async createPaymentIntent(input: { amountMinor: number; currency: string; paymentMethodToken: string; orderId: string; idempotencyKey: string }): Promise<StripePaymentIntent> {
    const form = new URLSearchParams({ amount: String(input.amountMinor), currency: input.currency.toLowerCase(), payment_method: input.paymentMethodToken, confirm: "true" });
    form.set("metadata[order_id]", input.orderId);
    const response = await this.fetcher("https://api.stripe.com/v1/payment_intents", { method: "POST", headers: { authorization: `Bearer ${this.secretKey}`, "content-type": "application/x-www-form-urlencoded", "idempotency-key": input.idempotencyKey }, body: form });
    const payload = await response.json() as StripePaymentIntent & { error?: { message?: string } };
    if (!response.ok) throw new Error(payload.error?.message ?? `Stripe request failed (${response.status})`);
    return payload;
  }
}

/** Verifies Stripe's `t=timestamp,v1=signature` header before parsing an event. */
export function verifyStripeSignature(rawBody: string, signatureHeader: string | undefined, secret: string, nowSeconds = Math.floor(Date.now() / 1000), toleranceSeconds = 300): boolean {
  if (!signatureHeader) return false;
  const parts = Object.fromEntries(signatureHeader.split(",").map((part) => { const [key, value] = part.split("=", 2); return [key, value]; }));
  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp) || Math.abs(nowSeconds - timestamp) > toleranceSeconds || !parts.v1) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const actual = Buffer.from(parts.v1, "utf8"); const digest = Buffer.from(expected, "utf8");
  return actual.length === digest.length && timingSafeEqual(actual, digest);
}
