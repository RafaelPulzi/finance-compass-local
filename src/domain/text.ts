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
