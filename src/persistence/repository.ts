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

export function parseVault(raw: unknown): Vault {
  const vault = raw as Vault;
  if (!vault || vault.schemaVersion !== VAULT_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported vault schema version: ${(vault as { schemaVersion?: unknown })?.schemaVersion}`,
    );
  }
  return vault;
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
