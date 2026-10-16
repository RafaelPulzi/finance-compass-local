import type { Vault } from "../domain/types";
import { type VaultRepository, parseVault } from "./repository";

const KEY = "finance-compass:vault";

/**
 * Browser-only repository used during `vite dev`. Keeps the whole vault under a
 * single localStorage key. Not the real storage model (see ADR-0002 / Tauri);
 * it only exists so the UI runs without the desktop shell.
 */
export function createLocalStorageRepository(): VaultRepository {
  return {
    label: "Browser (localStorage, dev only)",
    async load() {
      const raw = localStorage.getItem(KEY);
      if (raw === null) return null;
      return parseVault(JSON.parse(raw));
    },
    async save(vault: Vault) {
      localStorage.setItem(KEY, JSON.stringify(vault));
    },
  };
}
