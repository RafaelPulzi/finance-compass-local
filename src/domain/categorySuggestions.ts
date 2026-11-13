import { categoryKind } from "./categories";
import type { CommandOutcome } from "./command";
import { normalizeForSearch } from "./text";
import type { Id, Transaction, Vault } from "./types";

/**
 * Suggested Categories: what the user's own frequent decisions imply about the
 * Transactions they have not classified yet.
 *
 * A Rule is something the user wrote; a Suggestion is read off what they have
 * already done. When the same description has been filed by hand under the same
 * Category at least twice, an Uncategorized Transaction with that description
 * is offered that Category — offered, never imposed. Like a Rule (ADR-0008),
 * a Suggestion only ever fills a gap: it looks only at Transactions whose
 * `categoryId` is null, so applying Suggestions is idempotent and can never
 * overrule a person.
 *
 * The evidence is hand decisions only (`ruleId` absent). Counting what Rules
 * assigned would make Suggestions an echo of the Rules — and anything a Rule
 * can classify never reaches the backlog Suggestions exist for.
 */

/** One Uncategorized Transaction and the Category the user's decisions point to. */
export interface CategorySuggestion {
  transactionId: Id;
  categoryId: Id;
  /** How many times the user filed this same description under that Category. */
  occurrences: number;
}

/** A hand decision must repeat this often before it reads as a habit. */
const MIN_OCCURRENCES = 2;

/**
 * The description as decisions are compared: normalised, with pure-number
 * tokens dropped. Bank descriptions bury the merchant in dates, document
 * numbers and amounts ("PIX IFOOD 12/03 745211"), so two purchases at the same
 * place rarely match verbatim but almost always match with the numbers gone.
 * Null when nothing is left to compare — a description that is all numbers says
 * nothing about where the money went.
 */
export function decisionKey(description: string): string | null {
  const words = normalizeForSearch(description)
    .split(/[^0-9a-z]+/)
    .filter((token) => token !== "" && /[a-z]/.test(token));
  return words.length === 0 ? null : words.join(" ");
}

/** The key one Transaction's decisions are grouped under: kind plus description. */
function keyOf(tx: Transaction): string | null {
  if (tx.kind === "transfer") return null;
  const key = decisionKey(tx.description);
  return key === null ? null : `${tx.kind}\n${key}`;
}

/**
 * The Suggestions the Vault currently supports: for each Uncategorized
 * Transaction, the Category the user filed that same description under, when
 * they did so at least twice and no other Category competes for it. A tie is no
 * suggestion — guessing between two of the user's own habits would be wrong
 * half the time, and a wrong prefilled guess costs more than silence.
 */
export function suggestCategories(vault: Vault): CategorySuggestion[] {
  // How often each hand decision (key → category) repeats.
  const decisions = new Map<string, Map<Id, number>>();
  for (const tx of vault.transactions) {
    if (tx.kind === "transfer" || tx.categoryId === null || tx.ruleId !== undefined) continue;
    const key = keyOf(tx);
    if (key === null) continue;
    const byCategory = decisions.get(key) ?? new Map<Id, number>();
    byCategory.set(tx.categoryId, (byCategory.get(tx.categoryId) ?? 0) + 1);
    decisions.set(key, byCategory);
  }

  // The one Category each key points to, when it points anywhere at all.
  const habit = new Map<string, { categoryId: Id; occurrences: number }>();
  for (const [key, byCategory] of decisions) {
    let best: { categoryId: Id; occurrences: number } | null = null;
    let tied = false;
    for (const [categoryId, occurrences] of byCategory) {
      if (best === null || occurrences > best.occurrences) {
        best = { categoryId, occurrences };
        tied = false;
      } else if (occurrences === best.occurrences) {
        tied = true;
      }
    }
    if (best === null || tied || best.occurrences < MIN_OCCURRENCES) continue;
    // A Category since deleted (edits can orphan nothing, but data can predate
    // checks) must not be suggested back into existence.
    if (categoryKind(vault, best.categoryId) === undefined) continue;
    habit.set(key, best);
  }
  if (habit.size === 0) return [];

  const suggestions: CategorySuggestion[] = [];
  for (const tx of vault.transactions) {
    if (tx.kind === "transfer" || tx.categoryId !== null) continue;
    const key = keyOf(tx);
    if (key === null) continue;
    const found = habit.get(key);
    if (found === undefined) continue;
    suggestions.push({
      transactionId: tx.id,
      categoryId: found.categoryId,
      occurrences: found.occurrences,
    });
  }
  return suggestions;
}

/**
 * The Vault with every current Suggestion applied, one mutation however many
 * Transactions change. The user asked for it in bulk, so each applied Category
 * is their decision and carries no `ruleId` — a Suggestion is not a Rule, and
 * these Transactions become evidence for future Suggestions in their own right.
 * Nothing to apply returns the same Vault, which the store reads as no save.
 */
export function applySuggestions(vault: Vault): CommandOutcome<{ applied: number }> {
  const suggestions = suggestCategories(vault);
  if (suggestions.length === 0) return { ok: true, vault, applied: 0 };

  const byId = new Map(suggestions.map((s) => [s.transactionId, s.categoryId]));
  return {
    ok: true,
    vault: {
      ...vault,
      transactions: vault.transactions.map((tx) => {
        const categoryId = byId.get(tx.id);
        // `suggestCategories` only ever names Uncategorized non-Transfers, so no
        // further guard is needed: a Suggestion fills a gap by construction.
        if (categoryId === undefined || tx.kind === "transfer") return tx;
        return { ...tx, categoryId };
      }),
    },
    applied: suggestions.length,
  };
}
