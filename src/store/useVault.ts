import { create } from "zustand";
import { newId } from "../domain/id";
import type { Centavos } from "../domain/money";
import { seedVault } from "../domain/seed";
import { type ImportPlan, toTransactions } from "../domain/statementImport";
import type {
  Account,
  AccountType,
  Budget,
  Category,
  Group,
  ISODate,
  Id,
  ImportRecord,
  Transaction,
  Vault,
} from "../domain/types";
import { emptyVault } from "../domain/types";
import { type VaultRepository, pickRepository } from "../persistence/repository";

type Status = "loading" | "ready" | "error";

interface VaultState {
  vault: Vault;
  status: Status;
  repoLabel: string;
  error: string | null;

  init: () => Promise<void>;

  addAccount: (input: {
    name: string;
    type: AccountType;
    openingBalance: Centavos;
  }) => void;
  addGroup: (input: { name: string; kind: Group["kind"] }) => Group;
  addCategory: (input: { name: string; groupId: Id }) => Category;
  addIncome: (input: {
    date: ISODate;
    amount: Centavos;
    accountId: Id;
    categoryId: Id;
    description: string;
  }) => void;
  addExpense: (input: {
    date: ISODate;
    amount: Centavos;
    accountId: Id;
    categoryId: Id;
    description: string;
  }) => void;
  addTransfer: (input: {
    date: ISODate;
    amount: Centavos;
    fromAccountId: Id;
    toAccountId: Id;
    description: string;
  }) => void;
  setBudget: (input: { categoryId: Id; monthlyLimit: Centavos }) => void;
  /** Apply a planned Statement import, adding its new Transactions and recording the Import. */
  commitImport: (input: { plan: ImportPlan; fileName: string }) => void;
  /** Assign a Category to a Transaction, e.g. one that arrived uncategorized from an import. */
  setTransactionCategory: (transactionId: Id, categoryId: Id) => void;
}

let repository: VaultRepository | null = null;

/**
 * Guards `init` so concurrent or repeated calls share a single run. Without it,
 * two inits on an empty vault each generate their own seed (fresh ids) and save
 * both, leaving groups and categories describing different vaults. React's
 * StrictMode invokes effects twice in development, so this is the normal case.
 */
let initPromise: Promise<void> | null = null;

/**
 * Serializes persistence. A Tauri vault is several JSON files written one after
 * another, so two overlapping saves interleave their writes and tear the vault
 * (groups.json from one state, categories.json from another). Chaining makes
 * each save finish before the next starts; every save writes the whole state,
 * so the last one to run leaves the vault correct.
 */
let saveChain: Promise<unknown> = Promise.resolve();

function persist(vault: Vault): Promise<void> {
  saveChain = saveChain
    // A failed save must not break the chain for every save after it.
    .catch(() => undefined)
    .then(() => repository?.save(vault));
  return saveChain as Promise<void>;
}

/** Test seam: drop module state so a fresh store starts from nothing. */
export function resetVaultPersistence(): void {
  repository = null;
  initPromise = null;
  saveChain = Promise.resolve();
}

export const useVault = create<VaultState>((set, get) => {
  /** Apply a change to the vault, then persist it. */
  const mutate = (next: Vault) => {
    set({ vault: next });
    void persist(next);
  };

  const addTx = (tx: Transaction) => {
    const vault = get().vault;
    mutate({ ...vault, transactions: [...vault.transactions, tx] });
  };

  return {
    vault: emptyVault(),
    status: "loading",
    repoLabel: "",
    error: null,

    init() {
      // One run per session, however many times this is called.
      initPromise ??= (async () => {
        try {
          const repo = await pickRepository();
          repository = repo;
          const loaded = await repo.load();
          const vault = loaded ?? seedVault();
          if (loaded === null) await persist(vault);
          set({ vault, status: "ready", repoLabel: repo.label });
        } catch (e) {
          set({ status: "error", error: e instanceof Error ? e.message : String(e) });
          // Let a later call retry after a failure.
          initPromise = null;
        }
      })();
      return initPromise;
    },

    addAccount({ name, type, openingBalance }) {
      const vault = get().vault;
      const account: Account = { id: newId(), name, type, openingBalance };
      mutate({ ...vault, accounts: [...vault.accounts, account] });
    },

    addGroup({ name, kind }) {
      const vault = get().vault;
      const group: Group = { id: newId(), name, kind };
      mutate({ ...vault, groups: [...vault.groups, group] });
      return group;
    },

    addCategory({ name, groupId }) {
      const vault = get().vault;
      const category: Category = { id: newId(), name, groupId };
      mutate({ ...vault, categories: [...vault.categories, category] });
      return category;
    },

    addIncome({ date, amount, accountId, categoryId, description }) {
      addTx({ id: newId(), kind: "income", date, amount, accountId, categoryId, description });
    },

    addExpense({ date, amount, accountId, categoryId, description }) {
      addTx({ id: newId(), kind: "expense", date, amount, accountId, categoryId, description });
    },

    addTransfer({ date, amount, fromAccountId, toAccountId, description }) {
      addTx({ id: newId(), kind: "transfer", date, amount, fromAccountId, toAccountId, description });
    },

    setBudget({ categoryId, monthlyLimit }) {
      const vault = get().vault;
      const existing = vault.budgets.find((b) => b.categoryId === categoryId);
      const budgets = existing
        ? vault.budgets.map((b) =>
            b.categoryId === categoryId ? { ...b, monthlyLimit } : b,
          )
        : [...vault.budgets, { id: newId(), categoryId, monthlyLimit } satisfies Budget];
      mutate({ ...vault, budgets });
    },

    commitImport({ plan, fileName }) {
      const vault = get().vault;
      const added = toTransactions(plan.additions, plan.accountId, newId);
      const record: ImportRecord = {
        id: newId(),
        accountId: plan.accountId,
        importedAt: new Date().toISOString(),
        fileName,
        added: added.length,
        skipped: plan.duplicates.length,
      };
      mutate({
        ...vault,
        transactions: [...vault.transactions, ...added],
        imports: [...vault.imports, record],
      });
    },

    setTransactionCategory(transactionId, categoryId) {
      const vault = get().vault;
      mutate({
        ...vault,
        transactions: vault.transactions.map((tx) =>
          tx.id === transactionId && tx.kind !== "transfer"
            ? { ...tx, categoryId }
            : tx,
        ),
      });
    },
  };
});
