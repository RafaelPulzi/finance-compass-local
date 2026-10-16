import type { Centavos } from "../../domain/money";
import type { MonthKey } from "../../domain/reporting";

/** "2026-10" -> "out/26". */
export function monthLabel(month: MonthKey): string {
  const [year, m] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, m - 1, 1));
  const name = new Intl.DateTimeFormat("pt-BR", {
    month: "short",
    timeZone: "UTC",
  })
    .format(date)
    .replace(".", "");
  return `${name}/${String(year).slice(2)}`;
}

/** "2026-10" -> "outubro de 2026", for headings. */
export function monthLongLabel(month: MonthKey): string {
  const [year, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, m - 1, 1)));
}

const compact = new Intl.NumberFormat("pt-BR", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** Short axis-tick form of a money value, in reais. */
export function compactBRL(value: Centavos | number): string {
  return compact.format(value / 100);
}
