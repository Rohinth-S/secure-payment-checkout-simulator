export type ReconciliationEvent = { providerId: string; checkoutId?: string; status: string; receivedAt: string };

export class ReconciliationOutbox {
  private readonly events = new Map<string, ReconciliationEvent>();
  enqueue(event: ReconciliationEvent) { this.events.set(event.providerId, event); }
  peek(limit = 100) { return [...this.events.values()].slice(0, limit); }
  acknowledge(providerId: string) { return this.events.delete(providerId); }
  size() { return this.events.size; }
}
