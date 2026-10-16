import { describe, expect, it } from "vitest";
import {
  addCentavos,
  centavos,
  formatBRL,
  parseBRL,
  sumCentavos,
} from "./money";

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
