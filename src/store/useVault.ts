import { create } from "zustand";
import * as accountRules from "../domain/accounts";
import type { AccountInput } from "../domain/accounts";
import * as budgetRules from "../domain/budgets";
import * as categoryRules from "../domain/categories";
import * as suggestions from "../domain/categorySuggestions";
import * as classification from "../domain/classificationRules";
import type { RuleInput } from "../domain/classificationRules";
import type { CommandOutcome } from "../domain/command";
import { newId } from "../domain/id";
import type { Centavos } from "../domain/money";
import { seedVault } from "../domain/seed";
import * as statementImport from "../domain/statementImport";
import type { ImportPlan } from "../domain/statementImport";
import * as txCreate from "../domain/transactionCreate";
import * as txEdit from "../domain/transactionEdit";
import type { TransactionEdit } from "../domain/transactionEdit";
import * as recovery from "../domain/transferRecovery";
import type { SkippedEntry } from "../domain/transferRecovery";
import type {
  Account,
  Category,
  Group,
  ISODate,
  Id,
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
   */
  applyRulesToUncategorized: () => { applied: number };
  /**
   * Classify every Uncategorized Transaction whose description the user has
   * already filed, by hand and repeatedly, under one Category — the Suggestions
   * the Transactions page shows, applied in one mutation. Fills gaps only,
   * exactly like the Rules (ADR-0008), so it is idempotent and never overrules
   * a decision.
   */
  applySuggestedCategories: () => { applied: number };

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
   * classify a statement's worth of imported Transactions. One mutation and
   * therefore one save, whether it's two Transactions or five hundred.
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
   * practical way through a Statement's worth of internal moves. One mutation
   * and therefore one save, whether it converts two entries or two hundred.
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

  /**
   * Run one Vault command: the single place a domain verdict becomes a write.
   *
   * A refusal writes nothing. The same Vault back means nothing changed, so
   * nothing is saved — an empty save would still rewrite every file. A new
   * Vault is one mutation and therefore one save, whatever the command touched.
   * The command's report comes back to the caller with the `vault` removed:
   * what the UI gets to know travels through the report, never the model.
   */
  const run = <R extends object>(
    command: (vault: Vault) => CommandOutcome<R>,
  ): ({ ok: true } & R) | Refusal => {
    const vault = get().vault;
    const outcome = command(vault);
    if (!outcome.ok) return outcome;
    if (outcome.vault !== vault) mutate(outcome.vault);
    const { vault: _applied, ...report } = outcome;
    return report as { ok: true } & R;
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
      return run((v) => accountRules.addAccount(v, input, newId));
    },

    editAccount(accountId, input) {
      return run((v) => accountRules.editAccount(v, accountId, input));
    },

    deleteAccount(accountId) {
      return run((v) => accountRules.deleteAccount(v, accountId));
    },

    addGroup(input) {
      return run((v) => categoryRules.addGroup(v, input, newId));
    },

    addCategory(input) {
      return run((v) => categoryRules.addCategory(v, input, newId));
    },

    renameGroup(groupId, name) {
      return run((v) => categoryRules.renameGroup(v, groupId, name));
    },

    renameCategory(categoryId, name) {
      return run((v) => categoryRules.renameCategory(v, categoryId, name));
    },

    moveCategory(categoryId, groupId) {
      return run((v) => categoryRules.moveCategory(v, categoryId, groupId));
    },

    deleteCategory(categoryId) {
      return run((v) => categoryRules.deleteCategory(v, categoryId));
    },

    deleteGroup(groupId) {
      return run((v) => categoryRules.deleteGroup(v, groupId));
    },

    addRule(input) {
      return run((v) => classification.addRule(v, input, newId));
    },

    editRule(ruleId, input) {
      return run((v) => classification.editRule(v, ruleId, input));
    },

    deleteRule(ruleId) {
      return run((v) => classification.deleteRule(v, ruleId));
    },

    moveRule(ruleId, offset) {
      return run((v) => classification.moveRule(v, ruleId, offset));
    },

    applyRulesToUncategorized() {
      const result = run(classification.applyRulesToUncategorized);
      return { applied: result.ok ? result.applied : 0 };
    },

    applySuggestedCategories() {
      const result = run(suggestions.applySuggestions);
      return { applied: result.ok ? result.applied : 0 };
    },

    addIncome(input) {
      return run((v) => txCreate.addTransaction(v, { kind: "income", ...input }, newId()));
    },

    addExpense(input) {
      return run((v) => txCreate.addTransaction(v, { kind: "expense", ...input }, newId()));
    },

    addTransfer(input) {
      return run((v) => txCreate.addTransaction(v, { kind: "transfer", ...input }, newId()));
    },

    setBudget(input) {
      return run((v) => budgetRules.setBudget(v, input, newId));
    },

    commitImport(input) {
      const result = run((v) =>
        statementImport.commitImport(v, input, {
          newId,
          now: () => new Date().toISOString(),
        }),
      );
      return result.ok
        ? { added: result.added, classified: result.classified }
        : { added: 0, classified: 0 };
    },

    setTransactionCategory(transactionId, categoryId) {
      run((v) => classification.classifyAs(v, [transactionId], categoryId));
    },

    setTransactionCategoryMany(transactionIds, categoryId) {
      run((v) => classification.classifyAs(v, transactionIds, categoryId));
    },

    editTransaction(transactionId, changes) {
      return run((v) => txEdit.editTransaction(v, transactionId, changes));
    },

    deleteTransaction(transactionId) {
      run((v) => txEdit.deleteTransaction(v, transactionId));
    },

    markTransactionAsTransfer(transactionId, otherAccountId) {
      return run((v) => recovery.markAsTransfer(v, transactionId, otherAccountId));
    },

    markTransactionsAsTransfer(transactionIds, otherAccountId) {
      return run((v) => recovery.markAllAsTransfers(v, transactionIds, otherAccountId));
    },

    revertTransferToEntry(transferId) {
      return run((v) => recovery.undoMarking(v, transferId));
    },
  };
});
