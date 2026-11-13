import { join } from "@tauri-apps/api/path";
import { exists, mkdir, readTextFile, rename, writeTextFile } from "@tauri-apps/plugin-fs";
import type { Vault, VaultCollection } from "../domain/types";
import { VAULT_COLLECTIONS, VAULT_SCHEMA_VERSION } from "../domain/types";
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

/** Each collection's file in the vault folder. `Record` keeps it total: a new
 * collection in `VAULT_COLLECTIONS` refuses to compile until it has a file. */
const COLLECTION_FILES: Record<VaultCollection, string> = {
  accounts: "accounts.json",
  groups: "groups.json",
  categories: "categories.json",
  rules: "rules.json",
  transactions: "transactions.json",
  budgets: "budgets.json",
  imports: "imports.json",
  dismissedTransferPairs: "dismissed-transfers.json",
};

const NAMES = { meta: VAULT_MARKER, ...COLLECTION_FILES } as const;

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

      // Keep the version the files were written with so parseVault can migrate
      // it. A collection's missing file is an empty list — a file absent in an
      // older schema (rules before v4, dismissals before v3) reads the same as
      // one the user deleted.
      const meta = await readJson<{ schemaVersion: number }>(p.meta, {
        schemaVersion: VAULT_SCHEMA_VERSION,
      });
      const collections: Partial<Record<VaultCollection, unknown>> = {};
      for (const collection of VAULT_COLLECTIONS) {
        collections[collection] = await readJson<unknown>(p[collection], []);
      }
      return parseVault({ schemaVersion: meta.schemaVersion, ...collections });
    },

    async save(vault: Vault) {
      const p = await filePaths();
      await mkdir(dir, { recursive: true });
      for (const collection of VAULT_COLLECTIONS) {
        await writeJson(p[collection], vault[collection]);
      }
      // The marker goes last. It is what makes a folder count as a vault, so a
      // first save interrupted halfway leaves a folder that is not yet one,
      // rather than a "vault" missing half its files.
      await writeJson(p.meta, { schemaVersion: vault.schemaVersion });
    },
  };
}
