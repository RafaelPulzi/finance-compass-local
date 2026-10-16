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
  /** Load the vault, or null if none exists yet. */
  load(): Promise<Vault | null>;
  /** Persist the whole vault. */
  save(vault: Vault): Promise<void>;
}

/**
 * Read a vault from stored JSON, upgrading older schema versions on the way in.
 *
 * v1 -> v2 needs no data rewriting: Import records simply didn't exist, and the
 * fields v2 added to Transactions (`fitid`, a nullable `categoryId`) are both
 * satisfied by v1 rows, which always carried a real category and no fitid.
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
  };
}

/** True when running inside the Tauri desktop shell (vs. a plain browser dev server). */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Choose the right repository for the current runtime. */
export async function pickRepository(): Promise<VaultRepository> {
  if (isTauri()) {
    const { createTauriRepository } = await import("./tauriRepository");
    return createTauriRepository();
  }
  const { createLocalStorageRepository } = await import(
    "./localStorageRepository"
  );
  return createLocalStorageRepository();
}
