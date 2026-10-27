import { beforeEach, describe, expect, it, vi } from "vitest";
import { centavos } from "../domain/money";
import { VAULT_SCHEMA_VERSION } from "../domain/types";
import type { Vault } from "../domain/types";

/** An in-memory stand-in for the shell's filesystem, keyed by absolute path. */
const fs = {
  files: new Map<string, string>(),
  dirs: new Set<string>(),
};

vi.mock("@tauri-apps/api/path", () => ({
  // The real `join` is platform-aware; "/" is enough to tell the paths apart.
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

const { createTauriRepository } = await import("./tauriRepository");

const DIR = "/d/Financas/Cofre";

function vaultWith(partial: Partial<Vault> = {}): Vault {
  return {
    schemaVersion: 3,
    accounts: [],
    groups: [],
    categories: [],
    transactions: [],
    budgets: [],
    imports: [],
    dismissedTransferPairs: [],
    ...partial,
  };
}

beforeEach(() => {
  fs.files = new Map();
  fs.dirs = new Set();
});

describe("createTauriRepository", () => {
  it("keeps every file inside the folder it was given", async () => {
    fs.dirs.add(DIR);
    await createTauriRepository(DIR).save(vaultWith());

    expect([...fs.files.keys()].sort()).toEqual([
      `${DIR}/accounts.json`,
      `${DIR}/budgets.json`,
      `${DIR}/categories.json`,
      `${DIR}/dismissed-transfers.json`,
      `${DIR}/groups.json`,
      `${DIR}/imports.json`,
      `${DIR}/meta.json`,
      `${DIR}/transactions.json`,
    ]);
  });

  it("writes JSON a person can read", async () => {
    fs.dirs.add(DIR);
    await createTauriRepository(DIR).save(
      vaultWith({
        accounts: [
          { id: "a1", name: "Conta Corrente", type: "checking", openingBalance: centavos(1234) },
        ],
      }),
    );

    const written = fs.files.get(`${DIR}/accounts.json`) ?? "";
    expect(written).toContain('"name": "Conta Corrente"');
    expect(written.endsWith("\n")).toBe(true);
  });

  it("round-trips a vault", async () => {
    fs.dirs.add(DIR);
    const repo = createTauriRepository(DIR);
    const vault = vaultWith({
      accounts: [
        { id: "a1", name: "Carteira", type: "cash", openingBalance: centavos(500) },
      ],
      groups: [{ id: "g1", name: "Moradia", kind: "expense" }],
      categories: [{ id: "c1", name: "Aluguel", groupId: "g1" }],
    });

    await repo.save(vault);
    expect(await repo.load()).toEqual(vault);
  });

  it("creates the folder on the first save", async () => {
    await createTauriRepository(DIR).save(vaultWith());
    expect(fs.dirs.has(DIR)).toBe(true);
  });

  it("reports no vault when the folder exists but holds no meta.json", async () => {
    fs.dirs.add(DIR);
    expect(await createTauriRepository(DIR).load()).toBeNull();
  });

  it("reports no vault when the default folder does not exist yet", async () => {
    expect(await createTauriRepository(DIR).load()).toBeNull();
  });

  it("refuses to treat a missing chosen folder as an empty vault", async () => {
    // An unplugged drive or a folder the user moved. Seeding a fresh vault over
    // it would look like the data had vanished, so this has to be an error.
    await expect(createTauriRepository(DIR, { mustExist: true }).load()).rejects.toThrow(
      /não foi encontrada/,
    );
  });

  it("migrates a vault written by an older schema version", async () => {
    fs.dirs.add(DIR);
    fs.files.set(`${DIR}/meta.json`, JSON.stringify({ schemaVersion: 1 }));
    fs.files.set(`${DIR}/accounts.json`, JSON.stringify([]));

    const loaded = await createTauriRepository(DIR).load();
    expect(loaded?.schemaVersion).toBe(VAULT_SCHEMA_VERSION);
    // v1 had no imports file at all.
    expect(loaded?.imports).toEqual([]);
  });

  it("migrates a v2 vault, leaving its Transfers with no recovered entries", async () => {
    // A v2 Transfer was always entered by hand, so having no recovered entries is not
    // missing data — it is the truth about where it came from (ADR-0006).
    fs.dirs.add(DIR);
    fs.files.set(`${DIR}/meta.json`, JSON.stringify({ schemaVersion: 2 }));
    fs.files.set(
      `${DIR}/transactions.json`,
      JSON.stringify([
        {
          id: "t1",
          kind: "transfer",
          date: "2026-10-07",
          amount: 20000,
          description: "para poupanca",
          fromAccountId: "a1",
          toAccountId: "a2",
        },
      ]),
    );

    const loaded = await createTauriRepository(DIR).load();
    expect(loaded?.schemaVersion).toBe(3);
    expect(loaded?.transactions[0]).not.toHaveProperty("recoveredFrom");
    // v2 had no dismissed-transfers file at all.
    expect(loaded?.dismissedTransferPairs).toEqual([]);
  });

  it("round-trips a Transfer's recovered entries and a dismissed pair", async () => {
    fs.dirs.add(DIR);
    const repo = createTauriRepository(DIR);
    const vault = vaultWith({
      transactions: [
        {
          id: "t1",
          kind: "transfer",
          date: "2026-10-07",
          amount: centavos(20000),
          description: "para poupanca",
          fromAccountId: "a1",
          toAccountId: "a2",
          recoveredFrom: [
            { fitid: "bank-out", accountId: "a1" },
            { fitid: "bank-in", accountId: "a2" },
          ],
        },
      ],
      dismissedTransferPairs: [{ transactionIds: ["e1", "i1"] }],
    });

    await repo.save(vault);
    expect(await repo.load()).toEqual(vault);
    expect(fs.files.get(`${DIR}/dismissed-transfers.json`) ?? "").toContain(
      '"transactionIds"',
    );
  });

  it("refuses a vault written by a newer schema version", async () => {
    fs.dirs.add(DIR);
    fs.files.set(`${DIR}/meta.json`, JSON.stringify({ schemaVersion: 99 }));

    await expect(createTauriRepository(DIR).load()).rejects.toThrow(/mais nova/);
  });
});
