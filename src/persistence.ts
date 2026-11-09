import { Pool } from "pg";
import type { CheckoutResult } from "./domain/checkout.js";

export interface CheckoutRepository {
  findByIdempotencyKey(key: string): Promise<CheckoutResult | undefined>;
  save(key: string, result: CheckoutResult): Promise<CheckoutResult>;
  updateProvider(id: string, provider: { id: string; status: string }): Promise<CheckoutResult | undefined>;
  close?(): Promise<void>;
}

export class MemoryCheckoutRepository implements CheckoutRepository {
  private readonly entries = new Map<string, CheckoutResult>();

  async findByIdempotencyKey(key: string) { return this.entries.get(key); }

  async save(key: string, result: CheckoutResult) {
    const existing = this.entries.get(key);
    if (existing) return existing;
    this.entries.set(key, result);
    return result;
  }

  async updateProvider(id: string, provider: { id: string; status: string }) {
    for (const [key, value] of this.entries) {
      if (value.id === id) {
        const updated = { ...value, provider };
        this.entries.set(key, updated);
        return updated;
      }
    }
    return undefined;
  }
}

/** PostgreSQL adapter used by Docker Compose and production deployments. */
export class PostgresCheckoutRepository implements CheckoutRepository {
  constructor(private readonly pool: Pool) {}

  async findByIdempotencyKey(key: string) {
    const { rows } = await this.pool.query(
      `select id, order_id, amount_minor, currency, status, fraud_score, fraud_reasons,
        token_fingerprint, provider_id, provider_status, created_at
         from checkout_attempts where idempotency_key = $1`,
      [key],
    );
    const row = rows[0];
    if (!row) return undefined;
    return {
      id: row.id,
      orderId: row.order_id,
      status: row.status,
      amountMinor: Number(row.amount_minor),
      currency: row.currency,
      fraud: { decision: row.status === "authorized" ? "allow" : row.status === "review" ? "review" : "deny", score: row.fraud_score, reasons: row.fraud_reasons ?? [] },
      tokenFingerprint: row.token_fingerprint,
      createdAt: new Date(row.created_at).toISOString(),
      provider: row.provider_id ? { id: row.provider_id, status: row.provider_status } : undefined,
    } as CheckoutResult;
  }

  async save(key: string, result: CheckoutResult) {
    await this.pool.query(
      `insert into checkout_attempts
        (id, idempotency_key, order_id, amount_minor, currency, status, fraud_score, fraud_reasons, token_fingerprint, provider_id, provider_status, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12)
       on conflict (idempotency_key) do nothing`,
      [result.id, key, result.orderId, result.amountMinor, result.currency, result.status, result.fraud.score, JSON.stringify(result.fraud.reasons), result.tokenFingerprint, result.provider?.id ?? null, result.provider?.status ?? null, result.createdAt],
    );
    const stored = await this.findByIdempotencyKey(key);
    if (!stored) throw new Error("checkout could not be persisted");
    return stored;
  }

  async updateProvider(id: string, provider: { id: string; status: string }) {
    const { rows } = await this.pool.query(
      `update checkout_attempts set provider_id = $1, provider_status = $2 where id = $3 returning id, order_id, amount_minor, currency, status, fraud_score, fraud_reasons, token_fingerprint, provider_id, provider_status, created_at`,
      [provider.id, provider.status, id],
    );
    const row = rows[0];
    if (!row) return undefined;
    return this.findByIdempotencyKey((await this.pool.query("select idempotency_key from checkout_attempts where id = $1", [id])).rows[0].idempotency_key);
  }

  async close() { await this.pool.end(); }
}
