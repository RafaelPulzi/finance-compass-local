import { invoke } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";
import { exists, mkdir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

/**
 * Which folder the vault lives in, and how to change it.
 *
 * The vault itself is a folder of JSON files (ADR-0002), and the user may keep it
 * anywhere — a synced folder, an external drive — the way Obsidian does. That
 * makes the folder's path a setting, and the one piece of state that cannot live
 * inside the vault: it's the pointer to it. So it sits beside the vault in app
 * data instead.
 *
 * Desktop only; every function here reaches into the Tauri shell, so this module
 * must only ever be imported dynamically, behind `isTauri()`.
 */

/** The file whose presence marks a folder as a Finance Compass vault. */
export const VAULT_MARKER = "meta.json";

/** Folder created inside app data when the user has never chosen one. */
const DEFAULT_DIR_NAME = "vault";

const SETTINGS_NAME = "settings.json";

interface StoredSettings {
  /** Absolute path of the chosen vault folder, or null for the default. */
  vaultDir: string | null;
}

export interface VaultLocation {
  /** Absolute path of the folder holding the vault's JSON files. */
  dir: string;
  /**
   * True when the user picked this folder. A chosen folder that has gone missing
   * is an error worth reporting (an unplugged drive, a deleted folder) rather
   * than an empty vault to seed over, so the caller needs to tell them apart.
   */
  chosen: boolean;
}

async function settingsPath(): Promise<string> {
  return join(await appDataDir(), SETTINGS_NAME);
}

/** The built-in location, used until the user chooses another. */
export async function defaultVaultDir(): Promise<string> {
  return join(await appDataDir(), DEFAULT_DIR_NAME);
}

/** Where the vault should be opened from on this launch. */
export async function readVaultLocation(): Promise<VaultLocation> {
  const path = await settingsPath();
  if (await exists(path)) {
    // A corrupt or hand-edited pointer must not stop the app from starting:
    // fall back to the default folder, which is always openable.
    try {
      const stored = JSON.parse(await readTextFile(path)) as Partial<StoredSettings>;
      if (typeof stored.vaultDir === "string" && stored.vaultDir !== "") {
        return { dir: stored.vaultDir, chosen: true };
      }
    } catch {
      // fall through to the default
    }
  }
  return { dir: await defaultVaultDir(), chosen: false };
}

/** Remember `dir` as the vault folder for the next launch; `null` restores the default. */
export async function rememberVaultDir(dir: string | null): Promise<void> {
  const appData = await appDataDir();
  await mkdir(appData, { recursive: true });
  const settings: StoredSettings = { vaultDir: dir };
  await writeTextFile(await settingsPath(), `${JSON.stringify(settings, null, 2)}\n`);
}

/**
 * Let the shell read and write inside `dir`.
 *
 * Required before any other filesystem call on a folder the capability doesn't
 * already cover, and required again on every launch.
 */
export async function allowVaultDir(dir: string): Promise<void> {
  await invoke("allow_vault_dir", { path: dir });
}

/** Whether `dir` already holds a vault. Call `allowVaultDir(dir)` first. */
export async function folderHasVault(dir: string): Promise<boolean> {
  return exists(await join(dir, VAULT_MARKER));
}

/** Ask the user for a folder. Returns null if they cancelled. */
export async function promptForVaultFolder(): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({
    directory: true,
    multiple: false,
    title: "Escolher a pasta do cofre",
  });
  return typeof picked === "string" ? picked : null;
}
