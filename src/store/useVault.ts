import { create } from "zustand";
import * as accountRules from "../domain/accounts";
import type { AccountInput } from "../domain/accounts";
import * as categoryRules from "../domain/categories";
import * as classification from "../domain/classificationRules";
import type { RuleInput } from "../domain/classificationRules";
import { categoryKind } from "../domain/categories";
import { newId } from "../domain/id";
import type { Centavos } from "../domain/money";
import { seedVault } from "../domain/seed";
import { type ImportPlan, toTransactions } from "../domain/statementImport";
import { type NewTransaction, createdTransaction } from "../domain/transactionCreate";
import { type TransactionEdit, editedTransaction } from "../domain/transactionEdit";
import {
  type SkippedEntry,
  entryFromTransfer,
  transferFromEntry,
  transfersFromEntries,
} from "../domain/transferRecovery";
import type {
  Account,
  Budget,
  Category,
  Group,
  ISODate,
  Id,
  ImportRecord,
  Rule,
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

/** Outcome of an action the domain may refuse, reported back to the UI that asked. */
export type ActionResult = { ok: true } | { ok: false; message: string };

/** Outcome of changing the vault folder, reported back to the UI that asked. */
export type VaultSwitchResult = ActionResult;

/** Outcome of editing a Transaction, reported back to the form that asked. */
export type TransactionEditResult = ActionResult;

/**
 * Outcome of marking a selection as Transfers: how many became one, and every
 * entry that could not, with its reason.
 *
 * The skips are carried back rather than counted and dropped. A batch chosen by
 * description will sometimes include an entry that cannot convert, and a user
 * who is told "188 converted" while 9 vanished silently has been misled about
 * their own records.
 */
export type BulkTransferResult =
  | { ok: true; converted: number; skipped: readonly SkippedEntry[] }
  | { ok: false; message: string };

type Refusal = { ok: false; message: string };

interface VaultState {
  vault: Vault;
  status: Status;
  repoLabel: string;
  error: string | null;
  /** Absolute folder the vault lives in, or null when it isn't folder-backed. */
  vaultDir: string | null;
  /** Whether this runtime can open a vault folder at all (desktop only). */
  canChooseVault: boolean;
  /**
   * Why the last save failed, or null when what is on screen is on disk.
   *
   * A failed save used to be swallowed: the change stayed on screen, the user
   * moved on, and it was gone at the next launch. Now the app says so until a
   * later save succeeds — every save writes the whole vault, so one success
   * means nothing is missing any more.
   */
  saveError: string | null;

  init: () => Promise<void>;
  /** Write the current vault again, after a save failed. */
  retrySave: () => Promise<void>;

  /** Ask the user for a folder. Returns null if they cancelled. */
  chooseVaultFolder: () => Promise<VaultFolderPick | null>;
  /** Switch to the vault already stored in `dir`, leaving the current one untouched. */
  openVaultAt: (dir: string) => Promise<VaultSwitchResult>;
  /** Write the current vault into `dir` and keep working there. */
  moveVaultTo: (dir: string) => Promise<VaultSwitchResult>;

  addAccount: (input: AccountInput) => { ok: true; account: Account } | Refusal;
  /** Rename, retype or correct an Account's opening balance. */
  editAccount: (accountId: Id, input: AccountInput) => ActionResult;
  /** Remove an Account no Transaction touches; refused otherwise. */
  deleteAccount: (accountId: Id) => ActionResult;

  addGroup: (input: { name: string; kind: Group["kind"] }) => { ok: true; group: Group } | Refusal;
  addCategory: (input: { name: string; groupId: Id }) => { ok: true; category: Category } | Refusal;
  renameGroup: (groupId: Id, name: string) => ActionResult;
  renameCategory: (categoryId: Id, name: string) => ActionResult;
  /** Move a Category under another Group of the same kind. */
  moveCategory: (categoryId: Id, groupId: Id) => ActionResult;
  /** Refused while Transactions or a Budget still use it — never cascaded. */
  deleteCategory: (categoryId: Id) => ActionResult;
  /** Refused while the Group still has Categories. */
  deleteGroup: (groupId: Id) => ActionResult;

  /** Add a classification Rule at the end of the order, where it decides last. */
  addRule: (input: RuleInput) => { ok: true; rule: Rule } | Refusal;
  /** Change a Rule's pattern or Category, keeping its place in the order. */
  editRule: (ruleId: Id, input: RuleInput) => ActionResult;
  /** Remove a Rule, leaving the Transactions it classified exactly as they are. */
  deleteRule: (ruleId: Id) => ActionResult;
  /** Move a Rule one place up (-1) or down (1): the order *is* the priority. */
  moveRule: (ruleId: Id, offset: -1 | 1) => ActionResult;
  /**
   * Run the Rules over the Transactions that have no Category yet, so writing a
   * Rule clears the backlog instead of only helping the next Import.
   *
   * One mutation and therefore one save, however many Transactions change — the
   * same invariant bulk classification and bulk marking rest on. Nothing is
   * written when no Rule matches anything.
   */
  applyRulesToUncategorized: () => { applied: number };

  addIncome: (input: {
    date: ISODate;
    amount: Centavos;
    accountId: Id;
    categoryId: Id | null;
    description: string;
  }) => ActionResult;
  addExpense: (input: {
    date: ISODate;
    amount: Centavos;
    accountId: Id;
    categoryId: Id | null;
    description: string;
  }) => ActionResult;
  addTransfer: (input: {
    date: ISODate;
    amount: Centavos;
    fromAccountId: Id;
    toAccountId: Id;
    description: string;
  }) => ActionResult;
  setBudget: (input: { categoryId: Id; monthlyLimit: Centavos }) => ActionResult;
  /**
   * Apply a planned Statement import, adding its new Transactions and recording
   * the Import. The Rules run over the additions in the same mutation, so a
   * routine month can arrive already classified.
   *
   * Reports what the Import did so the panel can say whether there is work
   * left: how many entries were added, and how many of them a Rule classified.
   */
  commitImport: (input: { plan: ImportPlan; fileName: string }) => {
    added: number;
    classified: number;
  };
  /**
   * Assign a Category to a Transaction, e.g. one that arrived uncategorized from
   * an import. A Category of the other kind is ignored: an Income never sits in
   * an expense Category, whatever the caller sent.
   */
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
  /**
   * Correct a Transaction. Refuses a change that would break an invariant and
   * leaves the vault untouched when it does, so an invalid edit can never be
   * half-applied.
   */
  editTransaction: (transactionId: Id, changes: TransactionEdit) => TransactionEditResult;
  /**
   * Remove a Transaction for good. The Import record it came from is left alone:
   * it stays an honest history of what that Import did. Note the `fitid` goes
   * with the Transaction, so re-importing the same Statement will add it back.
   */
  deleteTransaction: (transactionId: Id) => void;
  /**
   * Mark one imported entry as a Transfer between its own Account and
   * `otherAccountId`, replacing the entry rather than adding beside it.
   *
   * This is the only action here that moves a balance: the entry affected one
   * Account, and as a Transfer it affects two, so the chosen Account gains or
   * loses the amount. That is correct — money arriving in an Account that
   * wasn't tracking it has to show up — and the UI says so before asking.
   */
  markTransactionAsTransfer: (
    transactionId: Id,
    otherAccountId: Id,
  ) => TransactionEditResult;
  /**
   * Mark a whole selection as Transfers against one other Account — the only
   * practical way through a Statement's worth of internal moves.
   *
   * Deliberately not a loop over `markTransactionAsTransfer`, for the same
   * reason `setTransactionCategoryMany` is not a loop: every mutation persists
   * the whole vault, so N calls would queue N multi-file writes onto the save
   * chain. This is one mutation and therefore one save, whether it converts two
   * entries or two hundred.
   */
  markTransactionsAsTransfer: (
    transactionIds: readonly Id[],
    otherAccountId: Id,
  ) => BulkTransferResult;
  /**
   * Undo a marking, restoring the imported entry the Transfer was recovered
   * from — including its `fitid`, without which the next Import of that
   * Statement would add the entry all over again.
   */
  revertTransferToEntry: (transferId: Id) => TransactionEditResult;
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

/**
 * Queue a save of `vault`. `report` hears how it went — null on success, the
 * error otherwise — which is how a failure reaches the screen instead of
 * vanishing into the chain.
 */
function persist(vault: Vault, report?: (error: unknown) => void): Promise<void> {
  // Bind the save to the repository that was current when the change was made.
  // Reading `repository` when the chain later runs would send a change meant for
  // the old folder to a vault the user has since opened somewhere else.
  const target = repository;
  const run = saveChain
    // A failed save must not break the chain for every save after it.
    .catch(() => undefined)
    .then(() => target?.save(vault));
  saveChain = run;
  // Attaching the handlers here also keeps a failure from surfacing as an
  // unhandled rejection: it has been dealt with by reporting it.
  run.then(
    () => report?.(null),
    (error: unknown) => report?.(error),
  );
  return run as Promise<void>;
}

/** Test seam: drop module state so a fresh store starts from nothing. */
export function resetVaultPersistence(): void {
  repository = null;
  initPromise = null;
  saveChain = Promise.resolve();
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export const useVault = create<VaultState>((set, get) => {
  const reportSave = (error: unknown) => {
    set({ saveError: error === null ? null : messageOf(error) });
  };

  /** Apply a change to the vault, then persist it. */
  const mutate = (next: Vault) => {
    set({ vault: next });
    void persist(next, reportSave);
  };

  /** Write a domain verdict: the new Vault on `ok`, nothing at all on a refusal. */
  const apply = (change: categoryRules.VaultChange): ActionResult => {
    if (!change.ok) return { ok: false, message: change.message };
    if (change.vault !== get().vault) mutate(change.vault);
    return { ok: true };
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
        saveError: null,
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, message: messageOf(e) };
    }
  };

  const addTx = (input: NewTransaction): ActionResult => {
    const vault = get().vault;
    const outcome = createdTransaction(vault, input, newId());
    if (!outcome.ok) return { ok: false, message: outcome.message };
    mutate({ ...vault, transactions: [...vault.transactions, outcome.transaction] });
    return { ok: true };
  };

  return {
    vault: emptyVault(),
    status: "loading",
    repoLabel: "",
    error: null,
    vaultDir: null,
    canChooseVault: isTauri(),
    saveError: null,

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
          set({ status: "error", error: messageOf(e) });
          // Let a later call retry after a failure.
          initPromise = null;
        }
      })();
      return initPromise;
    },

    async retrySave() {
      await persist(get().vault, reportSave).catch(() => undefined);
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

    addAccount(input) {
      const outcome = accountRules.addAccount(get().vault, input, newId);
      if (!outcome.ok) return outcome;
      mutate(outcome.vault);
      return { ok: true, account: outcome.account };
    },

    editAccount(accountId, input) {
      return apply(accountRules.editAccount(get().vault, accountId, input));
    },

    deleteAccount(accountId) {
      return apply(accountRules.deleteAccount(get().vault, accountId));
    },

    addGroup(input) {
      const outcome = categoryRules.addGroup(get().vault, input, newId);
      if (!outcome.ok) return outcome;
      mutate(outcome.vault);
      return { ok: true, group: outcome.group };
    },

    addCategory(input) {
      const outcome = categoryRules.addCategory(get().vault, input, newId);
      if (!outcome.ok) return outcome;
      mutate(outcome.vault);
      return { ok: true, category: outcome.category };
    },

    renameGroup(groupId, name) {
      return apply(categoryRules.renameGroup(get().vault, groupId, name));
    },

    renameCategory(categoryId, name) {
      return apply(categoryRules.renameCategory(get().vault, categoryId, name));
    },

    moveCategory(categoryId, groupId) {
      return apply(categoryRules.moveCategory(get().vault, categoryId, groupId));
    },

    deleteCategory(categoryId) {
      return apply(categoryRules.deleteCategory(get().vault, categoryId));
    },

    deleteGroup(groupId) {
      return apply(categoryRules.deleteGroup(get().vault, groupId));
    },

    addRule(input) {
      const outcome = classification.addRule(get().vault, input, newId);
      if (!outcome.ok) return outcome;
      mutate(outcome.vault);
      return { ok: true, rule: outcome.rule };
    },

    editRule(ruleId, input) {
      return apply(classification.editRule(get().vault, ruleId, input));
    },

    deleteRule(ruleId) {
      return apply(classification.deleteRule(get().vault, ruleId));
    },

    moveRule(ruleId, offset) {
      return apply(classification.moveRule(get().vault, ruleId, offset));
    },

    applyRulesToUncategorized() {
      const vault = get().vault;
      const { transactions, assignments } = classification.applyRules(
        vault.rules,
        vault.transactions,
      );
      // Nothing matched, so there is nothing to write — and an empty save would
      // still rewrite every file in the vault.
      if (assignments.length === 0) return { applied: 0 };
      mutate({ ...vault, transactions: [...transactions] });
      return { applied: assignments.length };
    },

    addIncome(input) {
      return addTx({ kind: "income", ...input });
    },

    addExpense(input) {
      return addTx({ kind: "expense", ...input });
    },

    addTransfer(input) {
      return addTx({ kind: "transfer", ...input });
    },

    setBudget({ categoryId, monthlyLimit }) {
      const vault = get().vault;
      if (!Number.isInteger(monthlyLimit) || monthlyLimit < 0) {
        return { ok: false, message: "Informe um limite igual ou maior que zero." };
      }
      // Only expenses count toward a Budget, so a Budget on an income Category
      // would be a limit nothing could ever reach.
      if (categoryKind(vault, categoryId) !== "expense") {
        return { ok: false, message: "Orçamentos valem só para categorias de despesa." };
      }
      const existing = vault.budgets.find((b) => b.categoryId === categoryId);
      if (existing?.monthlyLimit === monthlyLimit) return { ok: true };
      const budgets = existing
        ? vault.budgets.map((b) =>
            b.categoryId === categoryId ? { ...b, monthlyLimit } : b,
          )
        : [...vault.budgets, { id: newId(), categoryId, monthlyLimit } satisfies Budget];
      mutate({ ...vault, budgets });
      return { ok: true };
    },

    commitImport({ plan, fileName }) {
      const vault = get().vault;
      const added = toTransactions(plan.additions, plan.accountId, newId);
      // The Rules run here rather than inside the import domain: `toTransactions`
      // keeps producing Uncategorized entries and stays separately testable, and
      // an Import in a vault with no Rules behaves exactly as it did before.
      // Only the additions are offered to the Rules — what was already in the
      // vault is the backlog action's business, not this one's.
      const { transactions: classified, assignments } = classification.applyRules(
        vault.rules,
        added,
      );
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
        transactions: [...vault.transactions, ...classified],
        imports: [...vault.imports, record],
      });
      return { added: added.length, classified: assignments.length };
    },

    setTransactionCategory(transactionId, categoryId) {
      get().setTransactionCategoryMany([transactionId], categoryId);
    },

    setTransactionCategoryMany(transactionIds, categoryId) {
      // No ids means no change, and an empty save would still rewrite every file.
      if (transactionIds.length === 0) return;
      const vault = get().vault;
      const kind = categoryKind(vault, categoryId);
      // A Category the vault doesn't have would orphan every Transaction it touched.
      if (kind === undefined) return;
      const wanted = new Set(transactionIds);
      let changed = false;
      const transactions = vault.transactions.map((tx) => {
        // A Transfer carries no Category, so it's never a target even if asked
        // for — and an Income never lands in an expense Category, or vice versa.
        if (!wanted.has(tx.id) || tx.kind !== kind || tx.categoryId === categoryId) return tx;
        changed = true;
        // Classifying by hand is the user speaking for themselves, so whatever
        // Rule had decided this Category stops being the explanation for it.
        const next = { ...tx, categoryId };
        delete next.ruleId;
        return next;
      });
      if (changed) mutate({ ...vault, transactions });
    },

    editTransaction(transactionId, changes) {
      const vault = get().vault;
      // The domain decides what the Transaction becomes, or refuses; nothing is
      // written until it says yes, so a refused edit leaves the vault as it was.
      const outcome = editedTransaction(vault, transactionId, changes);
      if (!outcome.ok) return { ok: false, message: outcome.message };

      mutate({
        ...vault,
        transactions: vault.transactions.map((tx) =>
          tx.id === transactionId ? outcome.transaction : tx,
        ),
      });
      return { ok: true };
    },

    deleteTransaction(transactionId) {
      const vault = get().vault;
      // Nothing to remove means nothing to save.
      if (!vault.transactions.some((tx) => tx.id === transactionId)) return;
      mutate({
        ...vault,
        transactions: vault.transactions.filter((tx) => tx.id !== transactionId),
      });
    },

    markTransactionAsTransfer(transactionId, otherAccountId) {
      const vault = get().vault;
      const outcome = transferFromEntry(vault, transactionId, otherAccountId);
      if (!outcome.ok) return { ok: false, message: outcome.message };

      // One mutation, so one save: the entry is replaced in place rather than
      // removed and re-added, which would be two writes and a vault that is
      // briefly missing the money.
      mutate({
        ...vault,
        transactions: vault.transactions.map((tx) =>
          tx.id === transactionId ? outcome.transaction : tx,
        ),
      });
      return { ok: true };
    },

    markTransactionsAsTransfer(transactionIds, otherAccountId) {
      const vault = get().vault;
      const outcome = transfersFromEntries(vault, transactionIds, otherAccountId);
      if (!outcome.ok) return { ok: false, message: outcome.message };

      if (outcome.transfers.length > 0) {
        // Each Transfer kept the id of the entry it replaces, so the whole batch
        // is spliced in by one pass over the Transactions — one new vault, one
        // save.
        const byId = new Map(outcome.transfers.map((tx) => [tx.id, tx]));
        mutate({
          ...vault,
          transactions: vault.transactions.map((tx) => byId.get(tx.id) ?? tx),
        });
      }
      return {
        ok: true,
        converted: outcome.transfers.length,
        skipped: outcome.skipped,
      };
    },

    revertTransferToEntry(transferId) {
      const vault = get().vault;
      const outcome = entryFromTransfer(vault, transferId);
      if (!outcome.ok) return { ok: false, message: outcome.message };

      mutate({
        ...vault,
        transactions: vault.transactions.map((tx) =>
          tx.id === transferId ? outcome.transaction : tx,
        ),
      });
      return { ok: true };
    },
  };
});
