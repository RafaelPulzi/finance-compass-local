/**
 * Normalise text for matching: lowercase, with accents stripped.
 *
 * Bank descriptions are inconsistently accented and often shouting in caps
 * ("ACAI DA PRACA", "Açaí da Praça", "SUPERMERCADO SAO JOSE"), so matching the
 * raw string makes searching for a merchant a guessing game. Both sides of a
 * comparison go through this.
 *
 * Decomposing with NFD splits an accented letter into its base letter plus a
 * combining mark, which the range below then removes; every accent used in
 * Portuguese lives in that block.
 */
export function normalizeForSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * A user-given name, trimmed and with runs of spaces collapsed; null when
 * nothing is left. Account and Category names both go through this, so the two
 * kinds of name can never diverge in how they are cleaned.
 */
export function cleanName(name: string): string | null {
  const cleaned = name.trim().replace(/\s+/g, " ");
  return cleaned === "" ? null : cleaned;
}
