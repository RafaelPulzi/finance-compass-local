import { categoryKind } from "./categories";
import type { VaultChange } from "./categories";
import { normalizeForSearch } from "./text";
import type { CategoryKind, Id, Rule, Transaction, Vault } from "./types";

/**
 * Rules: what the app remembers about how the user classifies.
 *
 * A Rule maps a description pattern to a Category and is applied only to
 * Uncategorized Transactions. That single restriction is what the whole feature
 * rests on — automation fills gaps, it never overrules a person — and it is
 * also what makes applying Rules idempotent and therefore safe to repeat
 * (ADR-0008).
 *
 * Everything here is pure: it decides which Transaction would get which
 * Category, and counts what it would do. The store applies the result in one
 * mutation; the Import path calls the same function on its own additions.
 */

/** What a Rule would do to one Transaction. */
export interface RuleAssignment {
  transactionId: Id;
  categoryId: Id;
  ruleId: Id;
}

/** Input for a new or edited Rule. The kind is not asked for; see `addRule`. */
export interface RuleInput {
  pattern: string;
  categoryId: Id;
}

/**
 * The pattern as it is actually compared: lowercased, accents stripped, outer
 * whitespace gone. Bank descriptions shout in caps and are inconsistently
 * accented ("ACAI DA PRACA", "Açaí da Praça"), so a rule the user typed in
 * either style has to match both.
 */
export function normalizedPattern(pattern: string): string {
  return normalizeForSearch(pattern).trim();
}

/** Whether a Rule's pattern occurs in a description. Plain substring, never a regex. */
export function ruleMatches(rule: Rule, description: string): boolean {
  const pattern = normalizedPattern(rule.pattern);
  if (pattern === "") return false;
  return normalizeForSearch(description).includes(pattern);
}

/**
 * Which Rule classifies which Transaction, for Transactions that have no
 * Category yet.
 *
 * The first matching Rule in the user's order wins and the rest are skipped, so
 * a specific Rule can be placed above a general one and the outcome is the one
 * the list reads as. "Most specific wins" would be cleverer and would require
 * the user to model the app's idea of specificity to predict anything.
 *
 * A Transfer is never classified: it carries no Category at all. Neither is a
 * Transaction whose Category the user already set — not even by a Rule of a
 * better-fitting kind — which is the invariant that makes this safe to run
 * again and again.
 */
export function assignmentsFromRules(
  rules: readonly Rule[],
  transactions: readonly Transaction[],
): RuleAssignment[] {
  if (rules.length === 0) return [];
  const assignments: RuleAssignment[] = [];

  for (const tx of transactions) {
    if (tx.kind === "transfer" || tx.categoryId !== null) continue;
    for (const rule of rules) {
      // A Rule for Incomes has nothing to say about an Expense: the two sets of
      // Categories are separate, so the wrong kind is not a weaker match but no
      // match at all.
      if (rule.kind !== tx.kind) continue;
      if (!ruleMatches(rule, tx.description)) continue;
      assignments.push({
        transactionId: tx.id,
        categoryId: rule.categoryId,
        ruleId: rule.id,
      });
      break;
    }
  }
  return assignments;
}

/**
 * The Transactions with the Rules applied, and what was applied.
 *
 * The same array is returned when nothing matched, so a caller can tell "no
 * change" without comparing contents — which is how the store avoids rewriting
 * the whole vault to record that nothing happened.
 */
export function applyRules(
  rules: readonly Rule[],
  transactions: readonly Transaction[],
): { transactions: readonly Transaction[]; assignments: RuleAssignment[] } {
  const assignments = assignmentsFromRules(rules, transactions);
  if (assignments.length === 0) return { transactions, assignments };

  const byId = new Map(assignments.map((a) => [a.transactionId, a]));
  return {
    transactions: transactions.map((tx) => {
      const assignment = byId.get(tx.id);
      if (assignment === undefined || tx.kind === "transfer") return tx;
      // The Rule's id travels with the Category it assigned: without it, a
      // surprising Category six months from now is untraceable.
      return { ...tx, categoryId: assignment.categoryId, ruleId: assignment.ruleId };
    }),
    assignments,
  };
}

/**
 * How many Transactions each Rule currently accounts for, by Rule id.
 *
 * Read from the Transactions themselves rather than by re-matching, because
 * this answers "what has this Rule actually done to my records", not "what
 * would it do now" — a Rule the user has since narrowed still owns the
 * Transactions it classified while it was broad.
 */
export function ruleMatchCounts(vault: Vault): Map<Id, number> {
  const counts = new Map<Id, number>();
  for (const tx of vault.transactions) {
    if (tx.kind === "transfer" || tx.ruleId === undefined) continue;
    counts.set(tx.ruleId, (counts.get(tx.ruleId) ?? 0) + 1);
  }
  return counts;
}

/** How many Uncategorized Transactions the current Rules would classify. */
export function pendingRuleCount(vault: Vault): number {
  return assignmentsFromRules(vault.rules, vault.transactions).length;
}

// --- Suggesting a Rule from work the user just did -------------------------

/** Tokens of a normalised description: the words a pattern can be built from. */
function tokensOf(description: string): string[] {
  return normalizeForSearch(description)
    .split(/[^0-9a-z]+/)
    .filter((token) => token !== "");
}

/** Every contiguous run of tokens in `tokens`, longest first. */
function tokenRuns(tokens: readonly string[]): string[] {
  const runs: string[] = [];
  for (let length = tokens.length; length > 0; length--) {
    for (let start = 0; start + length <= tokens.length; start++) {
      runs.push(tokens.slice(start, start + length).join(" "));
    }
  }
  return runs;
}

/**
 * A pattern proposed from descriptions the user has just classified by hand:
 * the longest run of words all of them share.
 *
 * The app has been told, a dozen times over, what `IFOOD *IFOOD COM AGEN` is.
 * Offering to remember it turns work the user was going to do anyway into a
 * Rule — but only as a starting point they edit and confirm, because the
 * merchant name inside a bank description is a guess.
 *
 * With one description there is nothing to generalise from, so the proposal is
 * that description itself, normalised, for the user to trim.
 *
 * Returns null when there is no shared run worth proposing. An unhelpful
 * prefilled guess — one letter, a date, a lone amount — is worse than no offer,
 * because the user has to notice and undo it.
 */
export function suggestedPattern(descriptions: readonly string[]): string | null {
  const tokenised = descriptions.map(tokensOf).filter((tokens) => tokens.length > 0);
  if (tokenised.length === 0) return null;

  const others = tokenised.slice(1);
  for (const run of tokenRuns(tokenised[0])) {
    if (!worthProposing(run)) continue;
    if (others.every((tokens) => tokens.join(" ").includes(run))) return run;
  }
  return null;
}

/**
 * Whether a run of words is specific enough to offer. A pure number is a date
 * or an amount, not a merchant, and two characters match half the Statement.
 */
function worthProposing(run: string): boolean {
  return run.length >= 3 && /[a-z]/.test(run);
}

// --- Changing the Rules ---------------------------------------------------

/**
 * Add a Rule at the end of the order, where it cannot change what the Rules
 * above it already decide.
 *
 * The kind is derived from the Category rather than asked for. It is already
 * implied — an expense Category can only classify Expenses — and a field the
 * user can set independently is a field that can contradict itself.
 */
export function addRule(
  vault: Vault,
  input: RuleInput,
  newId: () => Id,
): { ok: true; vault: Vault; rule: Rule } | { ok: false; message: string } {
  const prepared = prepare(vault, input, null);
  if (!prepared.ok) return prepared;

  const rule: Rule = {
    id: newId(),
    pattern: prepared.pattern,
    categoryId: input.categoryId,
    kind: prepared.kind,
  };
  return { ok: true, vault: { ...vault, rules: [...vault.rules, rule] }, rule };
}

/** Change a Rule's pattern or Category, keeping its place in the order. */
export function editRule(vault: Vault, ruleId: Id, input: RuleInput): VaultChange {
  const existing = vault.rules.find((r) => r.id === ruleId);
  if (existing === undefined) return { ok: false, message: "Regra não encontrada." };

  const prepared = prepare(vault, input, ruleId);
  if (!prepared.ok) return prepared;

  return {
    ok: true,
    vault: {
      ...vault,
      rules: vault.rules.map((rule) =>
        rule.id === ruleId
          ? {
              ...rule,
              pattern: prepared.pattern,
              categoryId: input.categoryId,
              kind: prepared.kind,
            }
          : rule,
      ),
    },
  };
}

/**
 * Remove a Rule. The Transactions it classified keep their Categories — and
 * their reference to it — because deleting a Rule is a decision about what
 * happens next, not a way to lose a year of classification. A `ruleId` pointing
 * at a Rule that no longer exists reads as exactly that.
 */
export function deleteRule(vault: Vault, ruleId: Id): VaultChange {
  if (!vault.rules.some((r) => r.id === ruleId)) {
    return { ok: false, message: "Regra não encontrada." };
  }
  return { ok: true, vault: { ...vault, rules: vault.rules.filter((r) => r.id !== ruleId) } };
}

/**
 * Move a Rule one place up or down, which is how the user makes a specific Rule
 * win over a general one. Moving past either end is not an error, it is simply
 * nothing to do.
 */
export function moveRule(vault: Vault, ruleId: Id, offset: -1 | 1): VaultChange {
  const from = vault.rules.findIndex((r) => r.id === ruleId);
  if (from === -1) return { ok: false, message: "Regra não encontrada." };

  const to = from + offset;
  if (to < 0 || to >= vault.rules.length) return { ok: true, vault };

  const rules = [...vault.rules];
  const [moved] = rules.splice(from, 1);
  rules.splice(to, 0, moved);
  return { ok: true, vault: { ...vault, rules } };
}

/**
 * The checks a new or edited Rule shares: a pattern that can match something,
 * a Category that exists, and no other Rule already claiming the same pattern
 * for the same kind.
 */
function prepare(
  vault: Vault,
  input: RuleInput,
  excludeRuleId: Id | null,
): { ok: true; pattern: string; kind: CategoryKind } | { ok: false; message: string } {
  const pattern = input.pattern.trim();
  // A pattern of punctuation alone normalises to nothing and would match every
  // description in the vault.
  if (normalizedPattern(pattern) === "") {
    return { ok: false, message: "Informe o texto que a descrição deve conter." };
  }

  const kind = categoryKind(vault, input.categoryId);
  if (kind === undefined) {
    return { ok: false, message: "Escolha uma categoria existente." };
  }

  const normalized = normalizedPattern(pattern);
  const clash = vault.rules.some(
    (rule) =>
      rule.id !== excludeRuleId &&
      rule.kind === kind &&
      normalizedPattern(rule.pattern) === normalized,
  );
  if (clash) {
    // Two identical patterns of the same kind: the second could never win, so
    // it is a mistake rather than an ordering choice.
    return { ok: false, message: "Já existe uma regra com esse padrão." };
  }

  return { ok: true, pattern, kind };
}
