import {
  BaseDirectory,
  exists,
  mkdir,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import type {
  Account,
  Budget,
  Category,
  Group,
  ImportRecord,
  Transaction,
  Vault,
} from "../domain/types";
import { VAULT_SCHEMA_VERSION } from "../domain/types";
import { type VaultRepository, parseVault } from "./repository";

/**
 * Real desktop repository (ADR-0001/0002): the vault is a folder of plain,
 * human-readable JSON files. For now it lives in the app data directory;
 * letting the user pick any folder (the Obsidian "open vault" flow) is a later feature.
 */
const DIR = "vault";
const base = { baseDir: BaseDirectory.AppData } as const;

const FILES = {
  meta: `${DIR}/meta.json`,
  accounts: `${DIR}/accounts.json`,
  groups: `${DIR}/groups.json`,
  categories: `${DIR}/categories.json`,
  transactions: `${DIR}/transactions.json`,
  budgets: `${DIR}/budgets.json`,
  imports: `${DIR}/imports.json`,
} as const;

async function readJson<T>(path: string, fallback: T): Promise<T> {
  if (!(await exists(path, base))) return fallback;
  return JSON.parse(await readTextFile(path, base)) as T;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeTextFile(path, `${JSON.stringify(value, null, 2)}\n`, base);
}

export function createTauriRepository(): VaultRepository {
  return {
    label: "Local vault (JSON files on disk)",
    async load() {
      if (!(await exists(FILES.meta, base))) return null;
      // Keep the version the files were written with so parseVault can migrate it.
      const meta = await readJson<{ schemaVersion: number }>(FILES.meta, {
        schemaVersion: VAULT_SCHEMA_VERSION,
      });
      return parseVault({
        schemaVersion: meta.schemaVersion,
        accounts: await readJson<Account[]>(FILES.accounts, []),
        groups: await readJson<Group[]>(FILES.groups, []),
        categories: await readJson<Category[]>(FILES.categories, []),
        transactions: await readJson<Transaction[]>(FILES.transactions, []),
        budgets: await readJson<Budget[]>(FILES.budgets, []),
        imports: await readJson<ImportRecord[]>(FILES.imports, []),
      });
    },
    async save(vault: Vault) {
      await mkdir(DIR, { ...base, recursive: true });
      await writeJson(FILES.meta, { schemaVersion: vault.schemaVersion });
      await writeJson(FILES.accounts, vault.accounts);
      await writeJson(FILES.groups, vault.groups);
      await writeJson(FILES.categories, vault.categories);
      await writeJson(FILES.transactions, vault.transactions);
      await writeJson(FILES.budgets, vault.budgets);
      await writeJson(FILES.imports, vault.imports);
    },
  };
}
