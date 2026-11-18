import { create } from "zustand";
import type { CommandOutcome, CommandResult, SessionContext } from "../domain/command";
import { newId } from "../domain/id";
import { seedVault } from "../domain/seed";
import type { Vault } from "../domain/types";
import { emptyVault } from "../domain/types";
import {
  type VaultFolderPick,
  type VaultRepository,
  isTauri,
  pickRepository,
} from "../persistence/repository";
import * as session from "../persistence/session";

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

  /**
   * Run one Vault Command: the single place a domain verdict becomes a write.
   *
   * A refusal writes nothing. The same Vault back means nothing changed, so
   * nothing is saved — an empty save would still rewrite every file. A new
   * Vault is one mutation and therefore one save, whatever the Command touched.
   * The Command's report comes back to the caller with the `vault` removed:
   * what the UI gets to know travels through the report, never the model.
   *
   * The commands themselves live in the domain as builders —
   * `classifyAs(ids, categoryId)`, `addTransaction(input)` — so a new feature
   * adds a Command there and this interface does not grow.
   */
  run: <O extends CommandOutcome<object>>(
    command: (vault: Vault, ctx: SessionContext) => O,
  ) => CommandResult<O>;
}

/**
 * Guards `init` so concurrent or repeated calls share a single run. Without it,
 * two inits on an empty vault each generate their own seed (fresh ids) and save
 * both, leaving groups and categories describing different vaults. React's
 * StrictMode invokes effects twice in development, so this is the normal case.
 *
 * Which repository saves go to, and the chain that keeps them from
 * overlapping, live in the persistence session — that is the adapter's own
 * invariant, not the store's.
 */
let initPromise: Promise<void> | null = null;

/** Test seam: drop module state so a fresh store starts from nothing. */
export function resetVaultPersistence(): void {
  initPromise = null;
  session.resetSession();
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** The session's clock and ids, bound once: Commands themselves stay pure. */
const sessionContext: SessionContext = {
  newId,
  now: () => new Date().toISOString(),
};

export const useVault = create<VaultState>((set, get) => {
  const reportSave = (error: unknown) => {
    set({ saveError: error === null ? null : messageOf(error) });
  };

  /** Apply a change to the vault, then persist it. */
  const mutate = (next: Vault) => {
    set({ vault: next });
    void session.queueSave(next, reportSave);
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
      // The session drains queued saves against the old folder, fails before
      // swapping anything, and remembers the path before the swap.
      const { repo, vault } = await session.attachTo(dir, take);

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
          session.bindRepository(repo);
          const loaded = await repo.load();
          const vault = loaded ?? seedVault();
          if (loaded === null) await session.queueSave(vault);
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
      await session.queueSave(get().vault, reportSave).catch(() => undefined);
    },

    chooseVaultFolder() {
      return session.promptForFolder();
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

    run<O extends CommandOutcome<object>>(
      command: (vault: Vault, ctx: SessionContext) => O,
    ): CommandResult<O> {
      const vault = get().vault;
      const outcome = command(vault, sessionContext);
      if (!outcome.ok) return outcome as CommandResult<O>;
      if (outcome.vault !== vault) mutate(outcome.vault);
      const { vault: _applied, ...report } = outcome;
      return report as CommandResult<O>;
    },
  };
});
