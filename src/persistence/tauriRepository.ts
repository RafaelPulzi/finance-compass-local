import { join } from "@tauri-apps/api/path";
import { exists, mkdir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
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
import { VAULT_MARKER } from "./vaultLocation";

/**
 * Real desktop repository (ADR-0001/0002): the vault is a folder of plain,
 * human-readable JSON files, one per entity. The folder is passed in rather than
 * fixed, because the user may keep the vault anywhere (see `vaultLocation`).
 *
 * Note that a save writes several files in sequence. Two overlapping saves would
 * interleave and tear the vault, so callers must serialize them — `useVault`
 * does, through its save chain.
 */

const NAMES = {
  meta: VAULT_MARKER,
  accounts: "accounts.json",
  groups: "groups.json",
  categories: "categories.json",
  transactions: "transactions.json",
  budgets: "budgets.json",
  imports: "imports.json",
} as const;

type FilePaths = Record<keyof typeof NAMES, string>;

export interface TauriRepositoryOptions {
  /**
   * Treat a missing folder as an error instead of an empty vault. Set for a
   * folder the user chose: if it has vanished, saying so beats silently seeding
   * a new vault somewhere they aren't looking.
   */
  mustExist?: boolean;
}

export function createTauriRepository(
  dir: string,
  { mustExist = false }: TauriRepositoryOptions = {},
): VaultRepository {
  let paths: FilePaths | null = null;

  /** Resolve the file paths once; `join` is an async call into the shell. */
  async function filePaths(): Promise<FilePaths> {
    if (paths === null) {
      const entries = await Promise.all(
        Object.entries(NAMES).map(
          async ([key, name]) => [key, await join(dir, name)] as const,
        ),
      );
      paths = Object.fromEntries(entries) as FilePaths;
    }
    return paths;
  }

  async function readJson<T>(path: string, fallback: T): Promise<T> {
    if (!(await exists(path))) return fallback;
    return JSON.parse(await readTextFile(path)) as T;
  }

  async function writeJson(path: string, value: unknown): Promise<void> {
    await writeTextFile(path, `${JSON.stringify(value, null, 2)}\n`);
  }

  return {
    label: dir,
    dir,

    async load() {
      if (!(await exists(dir))) {
        if (mustExist) {
          throw new Error(
            `A pasta do cofre não foi encontrada: ${dir}. ` +
              "Se ela está em um disco externo ou pasta sincronizada, verifique se está disponível.",
          );
        }
        return null;
      }

      const p = await filePaths();
      if (!(await exists(p.meta))) return null;

      // Keep the version the files were written with so parseVault can migrate it.
      const meta = await readJson<{ schemaVersion: number }>(p.meta, {
        schemaVersion: VAULT_SCHEMA_VERSION,
      });
      return parseVault({
        schemaVersion: meta.schemaVersion,
        accounts: await readJson<Account[]>(p.accounts, []),
        groups: await readJson<Group[]>(p.groups, []),
        categories: await readJson<Category[]>(p.categories, []),
        transactions: await readJson<Transaction[]>(p.transactions, []),
        budgets: await readJson<Budget[]>(p.budgets, []),
        imports: await readJson<ImportRecord[]>(p.imports, []),
      });
    },

    async save(vault: Vault) {
      const p = await filePaths();
      await mkdir(dir, { recursive: true });
      await writeJson(p.meta, { schemaVersion: vault.schemaVersion });
      await writeJson(p.accounts, vault.accounts);
      await writeJson(p.groups, vault.groups);
      await writeJson(p.categories, vault.categories);
      await writeJson(p.transactions, vault.transactions);
      await writeJson(p.budgets, vault.budgets);
      await writeJson(p.imports, vault.imports);
    },
  };
}
