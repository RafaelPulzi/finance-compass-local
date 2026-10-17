import { beforeEach, describe, expect, it, vi } from "vitest";

const APP_DATA = "/app-data";

const fs = {
  files: new Map<string, string>(),
  dirs: new Set<string>(),
};

const invoked: { cmd: string; args: unknown }[] = [];

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: unknown) => {
    invoked.push({ cmd, args });
  },
}));

vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: async () => APP_DATA,
  join: async (...parts: string[]) => parts.join("/"),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: async (path: string) => fs.files.has(path) || fs.dirs.has(path),
  mkdir: async (path: string) => {
    fs.dirs.add(path);
  },
  readTextFile: async (path: string) => {
    const found = fs.files.get(path);
    if (found === undefined) throw new Error(`no such file: ${path}`);
    return found;
  },
  writeTextFile: async (path: string, contents: string) => {
    fs.files.set(path, contents);
  },
}));

const {
  allowVaultDir,
  defaultVaultDir,
  folderHasVault,
  readVaultLocation,
  rememberVaultDir,
} = await import("./vaultLocation");

const SETTINGS = `${APP_DATA}/settings.json`;

beforeEach(() => {
  fs.files = new Map();
  fs.dirs = new Set();
  invoked.length = 0;
});

describe("readVaultLocation", () => {
  it("falls back to the folder in app data when nothing was chosen", async () => {
    expect(await readVaultLocation()).toEqual({
      dir: `${APP_DATA}/vault`,
      chosen: false,
    });
  });

  it("returns the chosen folder, marked as chosen", async () => {
    fs.files.set(SETTINGS, JSON.stringify({ vaultDir: "/d/Financas" }));

    expect(await readVaultLocation()).toEqual({ dir: "/d/Financas", chosen: true });
  });

  it("treats a null pointer as the default", async () => {
    fs.files.set(SETTINGS, JSON.stringify({ vaultDir: null }));

    expect(await readVaultLocation()).toEqual({
      dir: await defaultVaultDir(),
      chosen: false,
    });
  });

  it("starts from the default rather than failing on a corrupt pointer", async () => {
    // Hand-edited or half-written settings must not stop the app from opening.
    fs.files.set(SETTINGS, "{ not json");

    expect(await readVaultLocation()).toEqual({
      dir: await defaultVaultDir(),
      chosen: false,
    });
  });
});

describe("rememberVaultDir", () => {
  it("stores the folder outside the vault, so it survives moving it", async () => {
    await rememberVaultDir("/d/Financas");

    expect(fs.files.has(SETTINGS)).toBe(true);
    expect(JSON.parse(fs.files.get(SETTINGS) ?? "")).toEqual({
      vaultDir: "/d/Financas",
    });
  });

  it("creates the app data folder before writing", async () => {
    await rememberVaultDir("/d/Financas");
    expect(fs.dirs.has(APP_DATA)).toBe(true);
  });

  it("round-trips through readVaultLocation", async () => {
    await rememberVaultDir("/d/Financas");
    expect(await readVaultLocation()).toEqual({ dir: "/d/Financas", chosen: true });
  });

  it("restores the default when given null", async () => {
    await rememberVaultDir("/d/Financas");
    await rememberVaultDir(null);

    expect(await readVaultLocation()).toEqual({
      dir: await defaultVaultDir(),
      chosen: false,
    });
  });
});

describe("allowVaultDir", () => {
  it("asks the shell to widen the filesystem scope to the folder", async () => {
    await allowVaultDir("/d/Financas");

    expect(invoked).toEqual([
      { cmd: "allow_vault_dir", args: { path: "/d/Financas" } },
    ]);
  });
});

describe("folderHasVault", () => {
  it("is true only when the folder holds the vault's meta file", async () => {
    fs.dirs.add("/d/Financas");
    expect(await folderHasVault("/d/Financas")).toBe(false);

    fs.files.set("/d/Financas/meta.json", "{}");
    expect(await folderHasVault("/d/Financas")).toBe(true);
  });
});
