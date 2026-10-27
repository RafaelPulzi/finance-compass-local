import type { Centavos } from "./money";
import type { Id, ISODate, Transaction, Vault } from "./types";

/**
 * Finding the two sides of one Transfer among imported entries.
 *
 * A Statement describes one Account, so an internal move arrives as two
 * unrelated-looking Transactions: an Expense on the Account the money left and
 * an Income on the Account it reached (ADR-0006). Nothing in either entry says
 * they are the same money.
 *
 * Pure: this proposes, the user decides. A candidate is not a Transaction and
 * nothing here is persisted — same-amount coincidences are common enough that
 * converting without being asked would merge two real expenses into one
 * non-event, which is a worse error than the double-counting it would fix.
 */

/**
 * How many days apart the two sides of one move may be.
 *
 * A PIX between the user's own banks usually lands the same day; a TED or a
 * weekend transfer can take a couple of business days. Three days covers that
 * without turning every repeated subscription charge into a candidate.
 */
export const TRANSFER_WINDOW_DAYS = 3;

/** One side of a candidate: enough to show it without looking the Transaction up again. */
export interface CandidateSide {
  transactionId: Id;
  accountId: Id;
  date: ISODate;
  description: string;
}

/**
 * Two imported entries the app believes are the two sides of one Transfer,
 * offered to the user and never converted on its own.
 */
export interface TransferCandidate {
  /** The Expense: the Account the money left. Becomes the Transfer's source. */
  outgoing: CandidateSide;
  /** The Income: the Account the money reached. Becomes the Transfer's destination. */
  incoming: CandidateSide;
  amount: Centavos;
  /** Whole days between the two dates. 0 means the same day. */
  daysApart: number;
}

const MS_PER_DAY = 86_400_000;

/** Whole days between two date-only ISO strings, always positive. */
function daysBetween(a: ISODate, b: ISODate): number {
  const ms = Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`);
  return Math.abs(Math.round(ms / MS_PER_DAY));
}

/**
 * Order-insensitive key for a pair of Transaction ids. Which side was found
 * first is an accident of iteration, so a dismissal must match either way.
 */
function pairKey(a: Id, b: Id): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

function sideOf(tx: Transaction & { accountId: Id }): CandidateSide {
  return {
    transactionId: tx.id,
    accountId: tx.accountId,
    date: tx.date,
    description: tx.description,
  };
}

/**
 * The candidate pairs in a Vault, closest dates first.
 *
 * Only an Expense and an Income can pair, and only across two different
 * Accounts for the same exact amount: an unequal pair (a transfer that arrived
 * with a fee deducted) stays a manual judgement rather than widening the
 * suggestion set faster than it helps.
 *
 * Each Transaction is offered in at most one pair, so the user cannot accept two
 * conflicting conversions from one list. Where several pairings are possible the
 * closest dates win, which is both the likeliest reading and a stable one.
 */
export function findTransferCandidates(vault: Vault): TransferCandidate[] {
  const dismissed = new Set(
    vault.dismissedTransferPairs.map((pair) =>
      pairKey(pair.transactionIds[0], pair.transactionIds[1]),
    ),
  );

  // Only equal amounts can pair, so group by amount and never compare across
  // groups. A Transfer is not a candidate side: it is already the thing a
  // candidate would become.
  const byAmount = new Map<
    number,
    { outgoing: CandidateSide[]; incoming: CandidateSide[] }
  >();
  for (const tx of vault.transactions) {
    if (tx.kind === "transfer") continue;
    let group = byAmount.get(tx.amount);
    if (group === undefined) {
      group = { outgoing: [], incoming: [] };
      byAmount.set(tx.amount, group);
    }
    (tx.kind === "expense" ? group.outgoing : group.incoming).push(sideOf(tx));
  }

  const plausible: TransferCandidate[] = [];
  for (const [amount, group] of byAmount) {
    for (const outgoing of group.outgoing) {
      for (const incoming of group.incoming) {
        // Money moving within one Account is not a move between two Accounts.
        if (outgoing.accountId === incoming.accountId) continue;
        const daysApart = daysBetween(outgoing.date, incoming.date);
        if (daysApart > TRANSFER_WINDOW_DAYS) continue;
        if (dismissed.has(pairKey(outgoing.transactionId, incoming.transactionId))) {
          continue;
        }
        plausible.push({
          outgoing,
          incoming,
          amount: amount as Centavos,
          daysApart,
        });
      }
    }
  }

  // Closest dates first, then by date and id so the order never depends on how
  // the Vault happened to be iterated.
  plausible.sort(
    (a, b) =>
      a.daysApart - b.daysApart ||
      (a.outgoing.date < b.outgoing.date ? -1 : a.outgoing.date > b.outgoing.date ? 1 : 0) ||
      (a.outgoing.transactionId < b.outgoing.transactionId ? -1 : 1),
  );

  // Take the best pairing for each Transaction and drop any later pair that
  // would reuse a side already claimed.
  const claimed = new Set<Id>();
  const candidates: TransferCandidate[] = [];
  for (const candidate of plausible) {
    const out = candidate.outgoing.transactionId;
    const inc = candidate.incoming.transactionId;
    if (claimed.has(out) || claimed.has(inc)) continue;
    claimed.add(out);
    claimed.add(inc);
    candidates.push(candidate);
  }
  return candidates;
}
