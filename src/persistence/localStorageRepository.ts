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
    label: "Navegador (localStorage, só para desenvolvimento)",
    // Not folder-backed: there is nothing to point a folder picker at.
    dir: null,
    async load() {
      const raw = localStorage.getItem(KEY);
      if (raw === null) return null;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error(
          "Os dados salvos no navegador estão corrompidos e não puderam ser lidos.",
        );
      }
      return parseVault(parsed);
    },
    async save(vault: Vault) {
      // Throws when the browser's quota is full; the store reports it to the user.
      localStorage.setItem(KEY, JSON.stringify(vault));
    },
  };
}
