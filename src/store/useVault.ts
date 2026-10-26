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
import {
  type VaultFolderPick,
  type VaultRepository,
  createVaultRepositoryAt,
  inspectVaultFolder,
  isTauri,
  pickRepository,
} from "../persistence/repository";

type Status = "loading" | "ready" | "error";

/** Outcome of changing the vault folder, reported back to the UI that asked. */
export type VaultSwitchResult = { ok: true } | { ok: false; message: string };

interface VaultState {
  vault: Vault;
  status: Status;
  repoLabel: string;
  error: string | null;
  /** Absolute folder the vault lives in, or null when it isn't folder-backed. */
  vaultDir: string | null;
  /** Whether this runtime can open a vault folder at all (desktop only). */
  canChooseVault: boolean;

  init: () => Promise<void>;

  /** Ask the user for a folder. Returns null if they cancelled. */
  chooseVaultFolder: () => Promise<VaultFolderPick | null>;
  /** Switch to the vault already stored in `dir`, leaving the current one untouched. */
  openVaultAt: (dir: string) => Promise<VaultSwitchResult>;
  /** Write the current vault into `dir` and keep working there. */
  moveVaultTo: (dir: string) => Promise<VaultSwitchResult>;

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
  /**
   * Assign one Category to many Transactions at once — the only practical way to
   * classify a statement's worth of imported Transactions.
   *
   * Deliberately not a loop over `setTransactionCategory`: every mutation
   * persists the whole vault, so N calls would queue N multi-file writes onto
   * the save chain. This is one mutation and therefore one save, whether it's
   * two Transactions or five hundred.
   */
  setTransactionCategoryMany: (transactionIds: readonly Id[], categoryId: Id) => void;
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
  // Bind the save to the repository that was current when the change was made.
  // Reading `repository` when the chain later runs would send a change meant for
  // the old folder to a vault the user has since opened somewhere else.
  const target = repository;
  saveChain = saveChain
    // A failed save must not break the chain for every save after it.
    .catch(() => undefined)
    .then(() => target?.save(vault));
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

  /**
   * Point the app at another vault folder. `take` decides what the vault there
   * should be — loaded from it, or the current one written into it.
   *
   * Order matters: everything that can fail happens before the swap, so a failed
   * switch leaves the app exactly where it was, still attached to a working
   * folder. The remembered path is written before the swap too, so the running
   * app and the next launch can never disagree about which folder is in use.
   */
  const switchTo = async (
    dir: string,
    take: (repo: VaultRepository) => Promise<Vault>,
  ): Promise<VaultSwitchResult> => {
    try {
      // Let saves already queued finish against the old folder first.
      await saveChain.catch(() => undefined);

      const repo = await createVaultRepositoryAt(dir, { mustExist: true });
      const vault = await take(repo);

      const { rememberVaultDir } = await import("../persistence/vaultLocation");
      await rememberVaultDir(dir);

      repository = repo;
      // The app is attached to a vault now, so a remount must not re-run init
      // and overwrite it with whatever the old location held.
      initPromise = Promise.resolve();
      set({
        vault,
        status: "ready",
        repoLabel: repo.label,
        vaultDir: repo.dir,
        error: null,
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
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
    vaultDir: null,
    canChooseVault: isTauri(),

    init() {
      // One run per session, however many times this is called.
      initPromise ??= (async () => {
        try {
          const repo = await pickRepository();
          repository = repo;
          const loaded = await repo.load();
          const vault = loaded ?? seedVault();
          if (loaded === null) await persist(vault);
          set({
            vault,
            status: "ready",
            repoLabel: repo.label,
            vaultDir: repo.dir,
          });
        } catch (e) {
          set({ status: "error", error: e instanceof Error ? e.message : String(e) });
          // Let a later call retry after a failure.
          initPromise = null;
        }
      })();
      return initPromise;
    },

    async chooseVaultFolder() {
      const { promptForVaultFolder } = await import("../persistence/vaultLocation");
      const dir = await promptForVaultFolder();
      if (dir === null) return null;
      return inspectVaultFolder(dir);
    },

    openVaultAt(dir) {
      return switchTo(dir, async (repo) => {
        const loaded = await repo.load();
        if (loaded === null) {
          throw new Error(
            "Essa pasta não contém um cofre do Finance Compass. Escolha uma pasta vazia para mover o cofre atual para lá.",
          );
        }
        return loaded;
      });
    },

    moveVaultTo(dir) {
      // Read the current vault before the switch starts, so what gets written is
      // what the user was looking at when they asked.
      const current = get().vault;
      return switchTo(dir, async (repo) => {
        if ((await repo.load()) !== null) {
          throw new Error(
            "Essa pasta já contém um cofre. Abra esse cofre em vez de sobrescrevê-lo.",
          );
        }
        await repo.save(current);
        return current;
      });
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

    setTransactionCategoryMany(transactionIds, categoryId) {
      // No ids means no change, and an empty save would still rewrite every file.
      if (transactionIds.length === 0) return;
      const wanted = new Set(transactionIds);
      const vault = get().vault;
      mutate({
        ...vault,
        transactions: vault.transactions.map((tx) =>
          // A Transfer carries no Category, so it's never a target even if asked for.
          wanted.has(tx.id) && tx.kind !== "transfer" ? { ...tx, categoryId } : tx,
        ),
      });
    },
  };
});
