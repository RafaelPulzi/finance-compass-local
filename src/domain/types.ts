import type { Centavos } from "./money";

/** A calendar date with no time component, stored as ISO "YYYY-MM-DD". */
export type ISODate = string;

export type Id = string;

// --- Accounts -------------------------------------------------------------

export type AccountType = "checking" | "savings" | "cash" | "credit-card";

/**
 * A place money sits. Its current balance is always derived from the opening
 * balance plus its Transactions (see deriveAccountBalance) and is never stored.
 * A credit-card is a liability: its balance is normally negative (what you owe).
 */
export interface Account {
  id: Id;
  name: string;
  type: AccountType;
  openingBalance: Centavos;
}

/** Credit cards are liabilities; everything else is an asset you hold. */
export function isLiability(account: Account): boolean {
  return account.type === "credit-card";
}

// --- Categories -----------------------------------------------------------

/** Income and expense categories are kept strictly separate. */
export type CategoryKind = "income" | "expense";

/** A named collection of Categories, itself income or expense. */
export interface Group {
  id: Id;
  name: string;
  kind: CategoryKind;
}

/** What an Income or Expense was for. Belongs to exactly one Group (two-level: Group -> Category). */
export interface Category {
  id: Id;
  name: string;
  groupId: Id;
}

// --- Transactions ---------------------------------------------------------

interface TransactionBase {
  id: Id;
  date: ISODate;
  /** Always a positive magnitude; the effect on balances is decided by `kind`. */
  amount: Centavos;
  description: string;
}

/**
 * Fields shared by the two kinds that hit a single Account and carry a Category.
 * `categoryId` is null while a Transaction is uncategorized, which is how every
 * imported Transaction starts; the user assigns the Category afterward.
 * `fitid` is the bank's own id, present only on imported Transactions, and is
 * what an Import dedups against within an Account.
 */
interface SingleAccountTransaction extends TransactionBase {
  accountId: Id;
  categoryId: Id | null;
  fitid?: string;
}

/** Money coming into one Account, classified by an income Category. */
export interface IncomeTransaction extends SingleAccountTransaction {
  kind: "income";
}

/** Money leaving one Account, classified by an expense Category. */
export interface ExpenseTransaction extends SingleAccountTransaction {
  kind: "expense";
}

/**
 * One imported Statement entry a Transfer was built from: the bank's own id and
 * the Account it was imported on. The Account matters because a FITID is only
 * unique within the Account it came from, which is how Import already scopes its
 * dedup.
 */
export interface ImportedEntry {
  fitid: string;
  accountId: Id;
}

/**
 * Money moving between two of the user's own Accounts. Carries no Category and
 * never counts as Income or Expense, so it stays out of budget/category math.
 */
export interface TransferTransaction extends TransactionBase {
  kind: "transfer";
  fromAccountId: Id;
  toAccountId: Id;
  /**
   * The imported entries this Transfer was recovered from: two when both sides
   * were imported, one when only one was, and absent for a Transfer the user
   * entered by hand, which never came from a Statement.
   *
   * This is what stops an Import from re-adding entries the user has converted:
   * the entries themselves are gone, so their FITIDs would otherwise look new.
   */
  recoveredFrom?: ImportedEntry[];
}

export type Transaction =
  | IncomeTransaction
  | ExpenseTransaction
  | TransferTransaction;

// --- Budgets --------------------------------------------------------------

/** A monthly spending limit for a single expense Category. No rollover. */
export interface Budget {
  id: Id;
  categoryId: Id;
  monthlyLimit: Centavos;
}

// --- Imports --------------------------------------------------------------

/**
 * The record of one Statement having been imported into one Account: what was
 * added, and what was skipped because the Account already had it.
 */
export interface ImportRecord {
  id: Id;
  accountId: Id;
  /** ISO timestamp of when the import ran. */
  importedAt: string;
  fileName: string;
  added: number;
  skipped: number;
}

// --- Vault ----------------------------------------------------------------

// --- Recovering Transfers -------------------------------------------------

/**
 * A candidate pair the user said no to, so it is never offered again.
 *
 * The two Transaction ids *are* the identity here — there is nothing else to a
 * dismissal — so unlike the other entities it carries no id of its own. The two
 * ids are compared without regard to order, since which side is listed first is
 * an accident of how the pair was found.
 */
export interface DismissedTransferPair {
  transactionIds: [Id, Id];
}

// --- Vault ----------------------------------------------------------------

/**
 * Current on-disk schema version for the vault files (see docs/adr/0002).
 * v2 added Import records, and made Transactions carry an optional bank `fitid`
 * and a nullable `categoryId` so imported entries can start uncategorized.
 * v3 lets a Transfer record the imported entries it was recovered from, and
 * remembers candidate pairs the user dismissed (see docs/adr/0006).
 */
export const VAULT_SCHEMA_VERSION = 3 as const;

/** The whole in-memory model, mirrored to the JSON files in the vault folder. */
export interface Vault {
  schemaVersion: typeof VAULT_SCHEMA_VERSION;
  accounts: Account[];
  groups: Group[];
  categories: Category[];
  transactions: Transaction[];
  budgets: Budget[];
  imports: ImportRecord[];
  dismissedTransferPairs: DismissedTransferPair[];
}

export function emptyVault(): Vault {
  return {
    schemaVersion: VAULT_SCHEMA_VERSION,
    accounts: [],
    groups: [],
    categories: [],
    transactions: [],
    budgets: [],
    imports: [],
    dismissedTransferPairs: [],
  };
}
