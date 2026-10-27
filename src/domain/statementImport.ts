import { centavos } from "./money";
import type { OfxEntry } from "./ofx";
import type { Id, Transaction } from "./types";

export interface ImportPlan {
  accountId: Id;
  /** Entries that will become new Transactions in the Account. */
  additions: OfxEntry[];
  /** Entries the Account already has (same FITID), which the import skips. */
  duplicates: OfxEntry[];
}

/**
 * Work out what importing a Statement into one Account would actually do.
 * Dedup keys on the bank's FITID, scoped to the target Account: re-importing an
 * overlapping statement adds nothing, and two genuinely identical purchases on
 * the same day are still two Transactions because their FITIDs differ.
 *
 * Pure: it decides, it doesn't apply.
 */
export function planImport(
  entries: readonly OfxEntry[],
  accountId: Id,
  existing: readonly Transaction[],
): ImportPlan {
  const seen = new Set<string>();
  for (const tx of existing) {
    if (tx.kind === "transfer") {
      // A Transfer the user recovered from imported entries no longer *contains*
      // those entries, but the bank still has them and will send them again. The
      // ids it recorded are what keeps a re-import from undoing the conversion.
      for (const imported of tx.recoveredFrom ?? []) {
        if (imported.accountId === accountId) seen.add(imported.fitid);
      }
      continue;
    }
    if (tx.accountId === accountId && tx.fitid !== undefined) {
      seen.add(tx.fitid);
    }
  }

  const additions: OfxEntry[] = [];
  const duplicates: OfxEntry[] = [];
  for (const entry of entries) {
    // `seen` grows as we go, so a FITID repeated inside one file is a duplicate too.
    if (seen.has(entry.fitid)) {
      duplicates.push(entry);
      continue;
    }
    seen.add(entry.fitid);
    additions.push(entry);
  }
  return { accountId, additions, duplicates };
}

/**
 * Turn planned entries into Transactions for an Account. The sign decides the
 * kind: negative is an Expense, anything else an Income. They start
 * uncategorized (`categoryId: null`) and are never auto-detected as Transfers.
 */
export function toTransactions(
  entries: readonly OfxEntry[],
  accountId: Id,
  makeId: () => Id,
): Transaction[] {
  return entries.map((entry) => ({
    id: makeId(),
    kind: entry.amount < 0 ? ("expense" as const) : ("income" as const),
    date: entry.date,
    amount: centavos(Math.abs(entry.amount)),
    description: entry.description,
    accountId,
    categoryId: null,
    fitid: entry.fitid,
  }));
}
