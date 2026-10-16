import { type Centavos, centavos } from "./money";
import type { Account, Id, ISODate, Transaction, Vault } from "./types";

/**
 * The signed effect a Transaction has on one Account's balance.
 * Income adds, Expense subtracts, a Transfer subtracts from its source and
 * adds to its destination. A Transaction that doesn't touch `accountId` has no effect.
 */
export function effectOnAccount(tx: Transaction, accountId: Id): number {
  switch (tx.kind) {
    case "income":
      return tx.accountId === accountId ? tx.amount : 0;
    case "expense":
      return tx.accountId === accountId ? -tx.amount : 0;
    case "transfer":
      if (tx.fromAccountId === accountId) return -tx.amount;
      if (tx.toAccountId === accountId) return tx.amount;
      return 0;
  }
}

/** Opening balance plus the net effect of every Transaction that touches the account. */
export function deriveAccountBalance(
  account: Account,
  transactions: readonly Transaction[],
): Centavos {
  let total: number = account.openingBalance;
  for (const tx of transactions) {
    total += effectOnAccount(tx, account.id);
  }
  return centavos(total);
}

/** Sum of every account's derived balance. Liabilities (negative balances) pull it down naturally. */
export function deriveNetWorth(vault: Vault): Centavos {
  let total = 0;
  for (const account of vault.accounts) {
    total += deriveAccountBalance(account, vault.transactions);
  }
  return centavos(total);
}

/** The "YYYY-MM" month key for an ISO date. */
export function monthKey(date: ISODate): string {
  return date.slice(0, 7);
}

/**
 * Total Expense amount booked to a Category within a calendar month.
 * Only expenses count toward budgets; income and transfers are ignored.
 */
export function spentInCategoryForMonth(
  transactions: readonly Transaction[],
  categoryId: Id,
  month: string,
): Centavos {
  let total = 0;
  for (const tx of transactions) {
    if (
      tx.kind === "expense" &&
      tx.categoryId === categoryId &&
      monthKey(tx.date) === month
    ) {
      total += tx.amount;
    }
  }
  return centavos(total);
}
