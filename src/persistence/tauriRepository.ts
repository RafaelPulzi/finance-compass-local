import { join } from "@tauri-apps/api/path";
import { exists, mkdir, readTextFile, rename, writeTextFile } from "@tauri-apps/plugin-fs";
import type {
  Account,
  Budget,
  Category,
  DismissedTransferPair,
  Group,
  ImportRecord,
  Rule,
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
 *
 * Each file is replaced atomically: the new contents go to a `.tmp` sibling,
 * which is then renamed over the real file. Writing in place truncates the file
 * first, so a crash or power cut mid-write would leave `transactions.json` cut
 * in half — unparseable, and with it the whole vault. With the rename, a file is
 * always either its old version or its new one.
 */

const NAMES = {
  meta: VAULT_MARKER,
  accounts: "accounts.json",
  groups: "groups.json",
  categories: "categories.json",
  rules: "rules.json",
  transactions: "transactions.json",
  budgets: "budgets.json",
  imports: "imports.json",
  dismissedTransferPairs: "dismissed-transfers.json",
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
    const text = await readTextFile(path);
    try {
      return JSON.parse(text) as T;
    } catch {
      // A bare SyntaxError ("Unexpected token } in JSON at position 48113")
      // tells the user nothing about which of eight files to look at.
      const name = path.split(/[\\/]/).pop() ?? path;
      throw new Error(
        `O arquivo ${name} do cofre está corrompido e não pôde ser lido. ` +
          "Restaure-o de um backup ou corrija o JSON; nenhum arquivo foi alterado.",
      );
    }
  }

  async function writeJson(path: string, value: unknown): Promise<void> {
    const temp = `${path}.tmp`;
    await writeTextFile(temp, `${JSON.stringify(value, null, 2)}\n`);
    await rename(temp, path);
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
        // Absent in a v3 vault, which had no Rules at all.
        rules: await readJson<Rule[]>(p.rules, []),
        transactions: await readJson<Transaction[]>(p.transactions, []),
        budgets: await readJson<Budget[]>(p.budgets, []),
        imports: await readJson<ImportRecord[]>(p.imports, []),
        // Absent in a v2 vault, which simply had no dismissals to remember.
        dismissedTransferPairs: await readJson<DismissedTransferPair[]>(
          p.dismissedTransferPairs,
          [],
        ),
      });
    },

    async save(vault: Vault) {
      const p = await filePaths();
      await mkdir(dir, { recursive: true });
      await writeJson(p.accounts, vault.accounts);
      await writeJson(p.groups, vault.groups);
      await writeJson(p.categories, vault.categories);
      await writeJson(p.rules, vault.rules);
      await writeJson(p.transactions, vault.transactions);
      await writeJson(p.budgets, vault.budgets);
      await writeJson(p.imports, vault.imports);
      await writeJson(p.dismissedTransferPairs, vault.dismissedTransferPairs);
      // The marker goes last. It is what makes a folder count as a vault, so a
      // first save interrupted halfway leaves a folder that is not yet one,
      // rather than a "vault" missing half its files.
      await writeJson(p.meta, { schemaVersion: vault.schemaVersion });
    },
  };
}
