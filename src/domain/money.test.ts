import { describe, expect, it } from "vitest";
import {
  addCentavos,
  centavos,
  formatBRL,
  formatBRLInput,
  parseBRL,
  sumCentavos,
} from "./money";

describe("parseBRL, the ways people actually type money", () => {
  it("reads a dot followed by one or two final digits as a decimal point", () => {
    // The bug this guards: "12.50" used to be read as R$ 1.250,00.
    expect(parseBRL("12.50")).toBe(1250);
    expect(parseBRL("12.5")).toBe(1250);
    expect(parseBRL("0.99")).toBe(99);
    expect(parseBRL("1500.75")).toBe(150075);
  });

  it("reads dots in groups of three as thousands", () => {
    expect(parseBRL("1.234")).toBe(123400);
    expect(parseBRL("1.234.567")).toBe(123456700);
    expect(parseBRL("1.234,5")).toBe(123450);
  });

  it("accepts a sign, for an opening balance that is a debt", () => {
    expect(parseBRL("-1.234,56")).toBe(-123456);
    expect(parseBRL("R$ -5,00")).toBe(-500);
    expect(parseBRL("-R$ 5,00")).toBe(-500);
    expect(parseBRL("+7")).toBe(700);
  });

  it("ignores the currency symbol and any kind of space, including Intl's non-breaking one", () => {
    expect(parseBRL("R$ 1.234,56")).toBe(123456);
    expect(parseBRL("  1 234,56 ")).toBe(123456);
    expect(parseBRL("r$ 3,00")).toBe(300);
  });

  it("accepts a leading decimal separator", () => {
    expect(parseBRL(",5")).toBe(50);
    expect(parseBRL(".5")).toBe(50);
  });

  it("rounds half-up past the second decimal, from the text and not a float", () => {
    // 12.345 * 100 is 1234.4999… as a float, which Math.round took to 1234.
    expect(parseBRL("12,345")).toBe(1235);
    expect(parseBRL("12,344")).toBe(1234);
    expect(parseBRL("0,005")).toBe(1);
  });

  it("never produces a negative zero", () => {
    expect(Object.is(parseBRL("-0,00"), 0)).toBe(true);
    expect(formatBRL(parseBRL("-0"))).toBe("R$ 0,00");
  });

  it("refuses what it would otherwise have to guess", () => {
    for (const ambiguous of [
      "1,234.56", // US order: a comma before a dot
      "1.2345", // neither a decimal nor a thousands group
      "12.34.5",
      "1,2,3",
      "12,3,4",
      "1.23,45", // a thousands group that is not three digits
    ]) {
      expect(() => parseBRL(ambiguous), ambiguous).toThrow();
    }
  });

  it("refuses what Number() would have let through", () => {
    for (const junk of ["1e5", "0x10", "Infinity", "NaN", "--5", "5-", "R$", "-", ",", "."]) {
      expect(() => parseBRL(junk), junk).toThrow();
    }
  });

  it("refuses amounts too large to hold exactly", () => {
    expect(() => parseBRL("999999999999999999")).toThrow();
  });
});

describe("formatBRLInput", () => {
  it("is what a money field shows: no symbol, pt-BR separators", () => {
    expect(formatBRLInput(centavos(123456))).toBe("1.234,56");
    expect(formatBRLInput(centavos(-500))).toBe("-5,00");
    expect(formatBRLInput(centavos(0))).toBe("0,00");
  });

  it("round-trips through parseBRL for every amount, so editing never changes a value", () => {
    // A deterministic sweep: small values, every centavo boundary, and large ones.
    const samples: number[] = [];
    for (let i = -1000; i <= 1000; i++) samples.push(i);
    for (let i = 0; i < 2000; i++) samples.push(Math.round(((i * 7919) % 100_000_000) * (i % 2 ? 1 : -1)));
    samples.push(99_999_999_999, -99_999_999_999);
    for (const value of samples) {
      expect(parseBRL(formatBRLInput(centavos(value))), String(value)).toBe(value === 0 ? 0 : value);
      expect(parseBRL(formatBRL(centavos(value))), String(value)).toBe(value === 0 ? 0 : value);
    }
  });
});

describe("centavos", () => {
  it("rejects non-integer values so float leaks are caught early", () => {
    expect(() => centavos(12.34)).toThrow();
  });
});

describe("formatBRL", () => {
  it("formats centavos as pt-BR currency", () => {
    // Non-breaking space between symbol and number, as Intl pt-BR produces it.
    expect(formatBRL(centavos(1234))).toBe("R$ 12,34");
    expect(formatBRL(centavos(0))).toBe("R$ 0,00");
    expect(formatBRL(centavos(-500))).toBe("-R$ 5,00");
  });
});

describe("parseBRL", () => {
  it("parses pt-BR formatted amounts to integer centavos", () => {
    expect(parseBRL("12,34")).toBe(1234);
    expect(parseBRL("1.234,56")).toBe(123456);
    expect(parseBRL("R$ 9,90")).toBe(990);
    expect(parseBRL("12")).toBe(1200);
  });

  it("throws on junk", () => {
    expect(() => parseBRL("abc")).toThrow();
    expect(() => parseBRL("")).toThrow();
  });
});

describe("integer money is exact where floats are not", () => {
  it("sums 0,10 ten times to exactly 1,00", () => {
    const dime = parseBRL("0,10");
    const total = sumCentavos(Array.from({ length: 10 }, () => dime));
    expect(total).toBe(100);
    expect(formatBRL(total)).toBe("R$ 1,00");
    // The float version famously does not: 0.1 * 10 === 1.0 but 0.1 summed is 0.999...
    expect(Array.from({ length: 10 }).reduce((a: number) => a + 0.1, 0)).not.toBe(1);
  });

  it("adds 841,35 three times to exactly 2.524,05", () => {
    const x = parseBRL("841,35");
    const total = addCentavos(addCentavos(x, x), x);
    expect(total).toBe(252405);
  });
});

describe("formatBRL and negative zero", () => {
  it("shows a negative zero as plain zero, not -R$ 0,00", () => {
    expect(formatBRL(centavos(-0))).toBe("R$ 0,00");
  });
});
