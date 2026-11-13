import { beforeEach, describe, expect, it, vi } from "vitest";
import { centavos } from "../domain/money";
import { VAULT_SCHEMA_VERSION } from "../domain/types";
import type { Vault } from "../domain/types";

/**
 * An in-memory stand-in for the shell's filesystem, keyed by absolute path.
 *
 * It can also "lose power": once `crashAfter` writing operations have run, the
 * next one fails — and a write that fails does what a real interrupted write
 * does to a file opened for writing, leaving it truncated halfway. That is the
 * hazard atomic replacement exists for, so the fake has to be able to produce it.
 */
const fs = {
  files: new Map<string, string>(),
  dirs: new Set<string>(),
  /** Every mutating call, in order: "write <path>" or "rename <from> -> <to>". */
  log: [] as string[],
  crashAfter: null as number | null,
};

function crashing(): boolean {
  return fs.crashAfter !== null && fs.log.length >= fs.crashAfter;
}

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
    if (crashing()) {
      fs.files.set(path, contents.slice(0, Math.floor(contents.length / 2)));
      throw new Error("power cut");
    }
    fs.log.push(`write ${path}`);
    fs.files.set(path, contents);
  },
  rename: async (from: string, to: string) => {
    if (crashing()) throw new Error("power cut");
    const contents = fs.files.get(from);
    if (contents === undefined) throw new Error(`no such file: ${from}`);
    fs.log.push(`rename ${from} -> ${to}`);
    fs.files.delete(from);
    fs.files.set(to, contents);
  },
}));

const { createTauriRepository } = await import("./tauriRepository");

const DIR = "/d/Financas/Cofre";

function vaultWith(partial: Partial<Vault> = {}): Vault {
  return {
    schemaVersion: 4,
    accounts: [],
    groups: [],
    categories: [],
    rules: [],
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
  fs.log = [];
  fs.crashAfter = null;
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
      `${DIR}/rules.json`,
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
    expect(loaded?.schemaVersion).toBe(4);
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

describe("surviving an interrupted save", () => {
  const before = vaultWith({
    accounts: [{ id: "a1", name: "Inter", type: "checking", openingBalance: centavos(10000) }],
    transactions: [
      {
        id: "t1",
        kind: "expense",
        date: "2026-10-01",
        amount: centavos(4990),
        description: "MERCADO",
        accountId: "a1",
        categoryId: null,
        fitid: "F1",
      },
    ],
  });
  const after = vaultWith({
    ...before,
    accounts: [
      ...before.accounts,
      { id: "a2", name: "Poupança", type: "savings", openingBalance: centavos(0) },
    ],
    transactions: [
      ...before.transactions,
      {
        id: "t2",
        kind: "income",
        date: "2026-10-05",
        amount: centavos(500000),
        description: "SALARIO",
        accountId: "a1",
        categoryId: null,
        fitid: "F2",
      },
    ],
  });

  it("never writes a vault file in place: each goes to a .tmp sibling and is renamed over", async () => {
    fs.dirs.add(DIR);
    await createTauriRepository(DIR).save(before);

    const writes = fs.log.filter((op) => op.startsWith("write "));
    expect(writes.length).toBe(9);
    expect(writes.every((op) => op.endsWith(".tmp"))).toBe(true);
    for (const write of writes) {
      const temp = write.slice("write ".length);
      expect(fs.log).toContain(`rename ${temp} -> ${temp.slice(0, -".tmp".length)}`);
    }
    // Nothing temporary is left behind by a save that finished.
    expect([...fs.files.keys()].filter((p) => p.endsWith(".tmp"))).toEqual([]);
  });

  it("leaves every file readable whichever step the power is cut at", async () => {
    // How many operations a full save takes, measured rather than assumed.
    fs.dirs.add(DIR);
    await createTauriRepository(DIR).save(after);
    const steps = fs.log.length;

    for (let cut = 0; cut < steps; cut++) {
      fs.files = new Map();
      fs.log = [];
      fs.crashAfter = null;
      await createTauriRepository(DIR).save(before);

      fs.log = [];
      fs.crashAfter = cut;
      await expect(createTauriRepository(DIR).save(after)).rejects.toThrow("power cut");
      fs.crashAfter = null;

      // The vault still opens, and each file holds one whole version or the other.
      const loaded = await createTauriRepository(DIR).load();
      expect(loaded, `cut at step ${cut}`).not.toBeNull();
      for (const key of ["accounts", "transactions"] as const) {
        expect([before[key], after[key]], `${key} at step ${cut}`).toContainEqual(loaded?.[key]);
      }
    }
  });

  it("writes meta.json last, so an interrupted first save leaves no half-made vault", async () => {
    fs.dirs.add(DIR);
    await createTauriRepository(DIR).save(before);
    const lastRename = fs.log.filter((op) => op.startsWith("rename ")).pop();
    expect(lastRename).toMatch(/meta\.json$/);

    // A first save into an empty folder that dies one step before the end.
    const steps = fs.log.length;
    fs.files = new Map();
    fs.log = [];
    fs.crashAfter = steps - 1;
    await expect(createTauriRepository(DIR).save(before)).rejects.toThrow();
    fs.crashAfter = null;
    expect(await createTauriRepository(DIR).load()).toBeNull();
  });

  it("ignores a temporary file a crashed save left behind", async () => {
    fs.dirs.add(DIR);
    await createTauriRepository(DIR).save(before);
    fs.files.set(`${DIR}/transactions.json.tmp`, '[{"id": "half');

    expect(await createTauriRepository(DIR).load()).toEqual(before);
  });

  it("names the corrupt file instead of failing with a bare SyntaxError", async () => {
    fs.dirs.add(DIR);
    await createTauriRepository(DIR).save(before);
    fs.files.set(`${DIR}/transactions.json`, '[{"id": "t1", "amount": ');

    await expect(createTauriRepository(DIR).load()).rejects.toThrow(
      /transactions\.json.*corrompido/,
    );
  });

  it("refuses a hand-edited file holding an object where a list belongs", async () => {
    fs.dirs.add(DIR);
    await createTauriRepository(DIR).save(before);
    fs.files.set(`${DIR}/accounts.json`, "{}");

    await expect(createTauriRepository(DIR).load()).rejects.toThrow(/accounts.*lista/);
  });
});

describe("a vault written before Rules existed", () => {
  it("reads a v3 vault as v4 with no Rules", async () => {
    fs.dirs.add(DIR);
    fs.files.set(`${DIR}/meta.json`, JSON.stringify({ schemaVersion: 3 }));
    fs.files.set(
      `${DIR}/transactions.json`,
      JSON.stringify([
        {
          id: "t1",
          kind: "expense",
          date: "2026-10-02",
          amount: 5000,
          description: "PADARIA",
          accountId: "acc-1",
          categoryId: "cat-1",
        },
      ]),
    );

    const loaded = await createTauriRepository(DIR).load();

    expect(loaded?.schemaVersion).toBe(4);
    expect(loaded?.rules).toEqual([]);
    // Every Category in a v3 vault was assigned by hand, which is what a
    // missing ruleId already says.
    expect(loaded?.transactions[0]).not.toHaveProperty("ruleId");
  });

  it("round-trips Rules as readable JSON in their own file", async () => {
    const vault = vaultWith({
      rules: [
        { id: "r-1", pattern: "IFOOD", categoryId: "cat-rest", kind: "expense" },
        { id: "r-2", pattern: "SALARIO", categoryId: "cat-sal", kind: "income" },
      ],
    });

    await createTauriRepository(DIR).save(vault);

    const written = fs.files.get(`${DIR}/rules.json`) ?? "";
    expect(written).toContain('"pattern": "IFOOD"');
    expect((await createTauriRepository(DIR).load())?.rules).toEqual(vault.rules);
  });

  it("keeps the order Rules were saved in, since the order is the priority", async () => {
    const vault = vaultWith({
      rules: [
        { id: "r-specific", pattern: "ifood", categoryId: "cat-rest", kind: "expense" },
        { id: "r-general", pattern: "food", categoryId: "cat-market", kind: "expense" },
      ],
    });

    await createTauriRepository(DIR).save(vault);

    expect((await createTauriRepository(DIR).load())?.rules.map((r) => r.id)).toEqual([
      "r-specific",
      "r-general",
    ]);
  });
});
