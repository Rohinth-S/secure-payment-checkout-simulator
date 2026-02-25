export type MetricsSnapshot = { counters: Record<string, number>; gauges: Record<string, number> };

export class MetricsRegistry {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();
  increment(name: string, value = 1) { this.counters.set(name, (this.counters.get(name) ?? 0) + value); }
  setGauge(name: string, value: number) { this.gauges.set(name, value); }
  snapshot(): MetricsSnapshot { return { counters: Object.fromEntries(this.counters), gauges: Object.fromEntries(this.gauges) }; }
}
