import { z } from "zod";

const FX_URL = "https://api.frankfurter.dev/v1/latest?base=EUR";
const REFRESH_MS = 12 * 3600 * 1000;

/** Unités de devise pour 1 EUR, utilisées si l'API de taux est injoignable. */
const FALLBACK_PER_EUR: Record<string, number> = {
  EUR: 1,
  USD: 1.1,
  GBP: 0.85,
  CAD: 1.5,
  AUD: 1.65,
  CHF: 0.95,
  JPY: 165,
  HKD: 8.6,
};

export interface Converter {
  convert(amount: number, from: string, to: string): number | null;
}

/** Taux BCE (via frankfurter.dev), rafraîchis toutes les 12 h. */
export class Fx implements Converter {
  private perEur: Record<string, number> = { ...FALLBACK_PER_EUR };
  private fetchedAt = 0;

  constructor(private readonly fetchImpl: typeof fetch = globalThis.fetch) {}

  async refresh(): Promise<void> {
    if (Date.now() - this.fetchedAt < REFRESH_MS) return;
    try {
      const response = await this.fetchImpl(FX_URL);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const { rates } = z.object({ rates: z.record(z.string(), z.number()) }).parse(await response.json());
      this.perEur = { ...this.perEur, ...rates, EUR: 1 };
      this.fetchedAt = Date.now();
    } catch (error) {
      console.warn("[fx] taux indisponibles, taux de repli conservés:", (error as Error).message);
    }
  }

  convert(amount: number, from: string, to: string): number | null {
    const source = this.perEur[from.toUpperCase()];
    const target = this.perEur[to.toUpperCase()];
    if (source === undefined || target === undefined) return null;
    return (amount / source) * target;
  }
}
