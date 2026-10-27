import type { Vault } from "../domain/types";
import { VAULT_SCHEMA_VERSION } from "../domain/types";

/**
 * A place a Vault can be loaded from and saved to. The domain and UI never know
 * whether that's the Tauri filesystem (real desktop vault, ADR-0002) or
 * localStorage (browser dev). Swapping one for the other changes nothing above here.
 */
export interface VaultRepository {
  /** Human-readable description of where data lives, for the UI. */
  readonly label: string;
  /**
   * Absolute folder the vault's files live in, or null when the vault isn't
   * folder-backed (the browser dev repository).
   */
  readonly dir: string | null;
  /** Load the vault, or null if none exists yet. */
  load(): Promise<Vault | null>;
  /** Persist the whole vault. */
  save(vault: Vault): Promise<void>;
}

/** A folder the user picked, and whether it already holds a vault. */
export interface VaultFolderPick {
  dir: string;
  hasVault: boolean;
}

/**
 * Read a vault from stored JSON, upgrading older schema versions on the way in.
 *
 * No version so far has needed data rewriting, only missing fields filled in.
 * v1 -> v2: Import records simply didn't exist, and the fields v2 added to
 * Transactions (`fitid`, a nullable `categoryId`) are both satisfied by v1 rows,
 * which always carried a real category and no fitid.
 * v2 -> v3: a Transfer's `recoveredFrom` is absent, which is exactly right — a v2
 * Transfer was entered by hand and came from no Statement — and there are no
 * dismissed candidate pairs yet.
 * A vault written by a *newer* app version is refused rather than silently
 * half-read, so an unknown field can't be dropped on the next save.
 */
export function parseVault(raw: unknown): Vault {
  const stored = raw as Partial<Vault> & { schemaVersion?: unknown };
  const version = stored?.schemaVersion;
  if (typeof version !== "number") {
    throw new Error(`Vault sem versão de schema: ${String(version)}`);
  }
  if (version > VAULT_SCHEMA_VERSION) {
    throw new Error(
      `Este cofre foi criado por uma versão mais nova do Finance Compass (schema ${version}).`,
    );
  }
  return {
    schemaVersion: VAULT_SCHEMA_VERSION,
    accounts: stored.accounts ?? [],
    groups: stored.groups ?? [],
    categories: stored.categories ?? [],
    transactions: stored.transactions ?? [],
    budgets: stored.budgets ?? [],
    imports: stored.imports ?? [],
    dismissedTransferPairs: stored.dismissedTransferPairs ?? [],
  };
}

/** True when running inside the Tauri desktop shell (vs. a plain browser dev server). */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Build a repository for a vault folder, granting the shell access to it first.
 * Every filesystem call on that folder depends on the grant, so it has to happen
 * before the repository is handed out.
 */
export async function createVaultRepositoryAt(
  dir: string,
  options?: { mustExist?: boolean },
): Promise<VaultRepository> {
  const [{ createTauriRepository }, { allowVaultDir }] = await Promise.all([
    import("./tauriRepository"),
    import("./vaultLocation"),
  ]);
  await allowVaultDir(dir);
  return createTauriRepository(dir, options);
}

/** Grant access to a folder the user picked and report whether it holds a vault. */
export async function inspectVaultFolder(dir: string): Promise<VaultFolderPick> {
  const { allowVaultDir, folderHasVault } = await import("./vaultLocation");
  await allowVaultDir(dir);
  return { dir, hasVault: await folderHasVault(dir) };
}

/** Choose the right repository for the current runtime. */
export async function pickRepository(): Promise<VaultRepository> {
  if (isTauri()) {
    const { readVaultLocation } = await import("./vaultLocation");
    const { dir, chosen } = await readVaultLocation();
    return createVaultRepositoryAt(dir, { mustExist: chosen });
  }
  const { createLocalStorageRepository } = await import(
    "./localStorageRepository"
  );
  return createLocalStorageRepository();
}
