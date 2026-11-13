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
  // `|| 0` turns a negative zero (e.g. negate(ZERO)) into zero: Intl would
  // otherwise print "-R$ 0,00".
  return brl.format(value / 100 || 0);
}

/** Dots used as pt-BR thousands separators: groups of exactly three digits. */
const THOUSANDS = /^\d{1,3}(\.\d{3})+$/;

/**
 * Parse a pt-BR money string ("1.234,56", "12,34", "12", "R$ 9,90", "-5,00")
 * into Centavos, exactly — the digits are read as text and never pass through a
 * float (ADR-0003).
 *
 * A comma is always the decimal separator. Without one, a dot followed by one or
 * two final digits is read as a decimal point ("12.50" is R$ 12,50, which is what
 * anyone typing it on a numeric keypad meant), and dots in groups of three are
 * thousands ("1.234" is R$ 1.234,00). Anything else is ambiguous and refused
 * rather than guessed: misreading "12.50" as R$ 1.250,00 is the kind of error
 * nobody notices until the month's numbers are wrong.
 *
 * More than two decimals round half-up to the nearest centavo.
 */
export function parseBRL(input: string): Centavos {
  const invalid = () => new Error(`Not a valid BRL amount: "${input}"`);

  let body = input.replace(/R\$/gi, "").replace(/[\s ]/g, "");
  let sign = 1;
  if (body.startsWith("-")) {
    sign = -1;
    body = body.slice(1);
  } else if (body.startsWith("+")) {
    body = body.slice(1);
  }

  let integerPart: string;
  let fractionPart: string;
  if (body.includes(",")) {
    const parts = body.split(",");
    if (parts.length !== 2) throw invalid();
    [integerPart, fractionPart] = parts;
    if (integerPart.includes(".")) {
      if (!THOUSANDS.test(integerPart)) throw invalid();
      integerPart = integerPart.replace(/\./g, "");
    }
  } else {
    const parts = body.split(".");
    if (parts.length === 2 && /^\d{1,2}$/.test(parts[1])) {
      [integerPart, fractionPart] = parts;
    } else {
      if (parts.length > 1 && !THOUSANDS.test(body)) throw invalid();
      integerPart = body.replace(/\./g, "");
      fractionPart = "";
    }
  }

  if (!/^\d*$/.test(integerPart) || !/^\d*$/.test(fractionPart)) throw invalid();
  if (integerPart === "" && fractionPart === "") throw invalid();

  const roundUp = fractionPart.length > 2 && Number(fractionPart[2]) >= 5;
  const cents =
    Number(integerPart || "0") * 100 +
    Number(fractionPart.slice(0, 2).padEnd(2, "0")) +
    (roundUp ? 1 : 0);
  if (!Number.isSafeInteger(cents)) throw invalid();
  // No "-R$ 0,00": zero has no sign.
  return centavos(cents === 0 ? 0 : sign * cents);
}

/** Centavos as the text a money field is typed in: 123456 -> "1.234,56", no "R$". */
export function formatBRLInput(value: Centavos): string {
  return formatBRL(value).replace(/^(-?)R\$\s*/u, "$1");
}
