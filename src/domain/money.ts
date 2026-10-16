/**
 * Money is stored and computed as integer centavos (see docs/adr/0003).
 * R$ 12,34 is the value 1234. Never use floats for stored/computed money;
 * convert to reais only at the display boundary.
 */

/** An integer number of centavos. Branded so it can't be mixed with raw numbers by accident. */
export type Centavos = number & { readonly __brand: "Centavos" };

/** Build Centavos from an integer. Throws on non-integers to catch float leaks early. */
export function centavos(n: number): Centavos {
  if (!Number.isInteger(n)) {
    throw new Error(`Centavos must be an integer, got ${n}`);
  }
  return n as Centavos;
}

export const ZERO: Centavos = centavos(0);

export function addCentavos(a: Centavos, b: Centavos): Centavos {
  return centavos(a + b);
}

export function sumCentavos(values: Iterable<Centavos>): Centavos {
  let total = 0;
  for (const v of values) total += v;
  return centavos(total);
}

export function negate(a: Centavos): Centavos {
  return centavos(-a);
}

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

/** Format centavos as "R$ 12,34" (pt-BR). */
export function formatBRL(value: Centavos): string {
  return brl.format(value / 100);
}

/**
 * Parse a pt-BR money string ("1.234,56", "12,34", "12", "R$ 9,90") into Centavos.
 * Rounds to the nearest centavo at the boundary; the result is always an integer.
 */
export function parseBRL(input: string): Centavos {
  const cleaned = input
    .replace(/[R$\s ]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  if (cleaned === "" || Number.isNaN(Number(cleaned))) {
    throw new Error(`Not a valid BRL amount: "${input}"`);
  }
  return centavos(Math.round(Number(cleaned) * 100));
}
