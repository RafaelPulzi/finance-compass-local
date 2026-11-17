import { describe, expect, it } from "vitest";
import type { SessionContext } from "./command";
import { centavos } from "./money";
import type { OfxEntry } from "./ofx";
import { commitImport, planImport, toTransactions } from "./statementImport";
import type { Rule, Transaction, Vault } from "./types";
import { emptyVault } from "./types";

const entry = (fitid: string, amount: number, date = "2026-01-05"): OfxEntry => ({
  fitid,
  date,
  amount,
  description: `entry ${fitid}`,
  trntype: amount < 0 ? "DEBIT" : "CREDIT",
});

const ACCOUNT = "acc-1";
const OTHER_ACCOUNT = "acc-2";

describe("planImport", () => {
  it("treats everything as new when the account has no imported history", () => {
    const plan = planImport([entry("a", -1000), entry("b", 2000)], ACCOUNT, []);
    expect(plan.additions).toHaveLength(2);
    expect(plan.duplicates).toHaveLength(0);
  });

  it("skips entries already imported into this account", () => {
    const existing: Transaction[] = [
      {
        id: "t1",
        kind: "expense",
        date: "2026-01-05",
        amount: centavos(1000),
        description: "",
        accountId: ACCOUNT,
        categoryId: null,
        fitid: "a",
      },
    ];
    const plan = planImport([entry("a", -1000), entry("b", -2000)], ACCOUNT, existing);
    expect(plan.additions.map((e) => e.fitid)).toEqual(["b"]);
    expect(plan.duplicates.map((e) => e.fitid)).toEqual(["a"]);
  });

  it("scopes dedup to the target account", () => {
    // The same FITID in a *different* account must not block the import.
    const existing: Transaction[] = [
      {
        id: "t1",
        kind: "expense",
        date: "2026-01-05",
        amount: centavos(1000),
        description: "",
        accountId: OTHER_ACCOUNT,
        categoryId: null,
        fitid: "a",
      },
    ];
    const plan = planImport([entry("a", -1000)], ACCOUNT, existing);
    expect(plan.additions.map((e) => e.fitid)).toEqual(["a"]);
  });

  it("ignores manually entered transactions, which have no fitid", () => {
    const existing: Transaction[] = [
      {
        id: "t1",
        kind: "expense",
        date: "2026-01-05",
        amount: centavos(1000),
        description: "typed by hand",
        accountId: ACCOUNT,
        categoryId: "cat-1",
      },
    ];
    const plan = planImport([entry("a", -1000)], ACCOUNT, existing);
    expect(plan.additions).toHaveLength(1);
  });

  it("keeps two identical-looking purchases that have different fitids", () => {
    // Two R$20 coffees on the same day are two real transactions.
    const plan = planImport([entry("x1", -2000), entry("x2", -2000)], ACCOUNT, []);
    expect(plan.additions).toHaveLength(2);
  });

  it("dedups a fitid repeated within the same file", () => {
    const plan = planImport([entry("a", -1000), entry("a", -1000)], ACCOUNT, []);
    expect(plan.additions).toHaveLength(1);
    expect(plan.duplicates).toHaveLength(1);
  });

  it("is idempotent: importing the same statement twice adds nothing the second time", () => {
    const entries = [entry("a", -1000), entry("b", 2000)];
    const first = planImport(entries, ACCOUNT, []);
    let id = 0;
    const added = toTransactions(first.additions, ACCOUNT, () => `t${++id}`);
    const second = planImport(entries, ACCOUNT, added);
    expect(second.additions).toHaveLength(0);
    expect(second.duplicates).toHaveLength(2);
  });
});

describe("toTransactions", () => {
  let counter = 0;
  const makeId = () => `t${++counter}`;

  it("maps sign to kind and stores a positive magnitude", () => {
    counter = 0;
    const [expense, income] = toTransactions(
      [entry("a", -4990), entry("b", 500000)],
      ACCOUNT,
      makeId,
    );
    expect(expense).toMatchObject({ kind: "expense", amount: 4990, accountId: ACCOUNT });
    expect(income).toMatchObject({ kind: "income", amount: 500000 });
  });

  it("starts imported transactions uncategorized and keeps the fitid", () => {
    counter = 0;
    const [tx] = toTransactions([entry("a", -4990)], ACCOUNT, makeId);
    expect(tx).toMatchObject({ categoryId: null, fitid: "a" });
  });

  it("never produces a transfer", () => {
    counter = 0;
    const txs = toTransactions([entry("a", -1), entry("b", 1)], ACCOUNT, makeId);
    expect(txs.every((t) => t.kind !== "transfer")).toBe(true);
  });
});

describe("dedup against Transfers recovered from imported entries", () => {
  /**
   * The regression the v3 `recoveredFrom` field exists for. Converting a pair into a
   * Transfer removes the two entries, so without this the bank's own ids look
   * new on the next import and the conversion silently undoes itself.
   */
  const ACC = "acc-1";
  const OTHER = "acc-2";

  const transferFrom = (
    recoveredFrom: { fitid: string; accountId: string }[],
  ): Transaction => ({
    id: "t1",
    kind: "transfer",
    date: "2026-10-07",
    amount: centavos(20000),
    description: "para poupança",
    fromAccountId: ACC,
    toAccountId: OTHER,
    recoveredFrom,
  });

  /** One side of the move, as the bank re-sends it on the next import. */
  const movedEntry = (fitid: string) => entry(fitid, -20000, "2026-10-07");

  it("skips an entry whose id a Transfer recorded for this Account", () => {
    const plan = planImport([movedEntry("bank-1")], ACC, [
      transferFrom([{ fitid: "bank-1", accountId: ACC }]),
    ]);

    expect(plan.additions).toHaveLength(0);
    expect(plan.duplicates.map((e) => e.fitid)).toEqual(["bank-1"]);
  });

  it("skips both sides when both were recorded, each on its own Account", () => {
    const existing = [
      transferFrom([
        { fitid: "bank-out", accountId: ACC },
        { fitid: "bank-in", accountId: OTHER },
      ]),
    ];

    expect(planImport([movedEntry("bank-out")], ACC, existing).additions).toHaveLength(0);
    expect(planImport([movedEntry("bank-in")], OTHER, existing).additions).toHaveLength(0);
  });

  it("keeps the per-Account scoping: the same id on another Account is not a duplicate", () => {
    const plan = planImport([movedEntry("bank-1")], OTHER, [
      transferFrom([{ fitid: "bank-1", accountId: ACC }]),
    ]);

    expect(plan.additions.map((e) => e.fitid)).toEqual(["bank-1"]);
    expect(plan.duplicates).toHaveLength(0);
  });

  it("ignores a hand-entered Transfer, which was recovered from nothing", () => {
    const handEntered: Transaction = {
      id: "t2",
      kind: "transfer",
      date: "2026-10-07",
      amount: centavos(20000),
      description: "digitada à mão",
      fromAccountId: ACC,
      toAccountId: OTHER,
    };

    expect(planImport([movedEntry("bank-1")], ACC, [handEntered]).additions).toHaveLength(1);
  });
});

describe("commitImport, as a Command", () => {
  const ACC_ID = "acc-inter";
  const vault: Vault = {
    ...emptyVault(),
    accounts: [
      { id: ACC_ID, name: "Banco Inter", type: "checking", openingBalance: centavos(0) },
    ],
    groups: [{ id: "g-food", name: "Alimentação", kind: "expense" }],
    categories: [{ id: "cat-market", name: "Mercado", groupId: "g-food" }],
  };

  let n = 0;
  const ctx: SessionContext = {
    newId: () => `id-${++n}`,
    now: () => "2026-11-16T09:30:00.000Z",
  };

  const marketRule: Rule = {
    id: "r-1",
    pattern: "entry a",
    categoryId: "cat-market",
    kind: "expense",
  };

  it("adds the planned entries and records what the Import did", () => {
    const plan = planImport([entry("a", -1000), entry("b", 2000)], ACC_ID, []);

    const outcome = commitImport({ plan, fileName: "extrato.ofx" })(vault, ctx);
    if (!outcome.ok) throw new Error(outcome.message);

    expect(outcome.added).toBe(2);
    expect(outcome.vault.transactions).toHaveLength(2);
    expect(outcome.vault.imports).toEqual([
      {
        id: expect.any(String),
        accountId: ACC_ID,
        importedAt: "2026-11-16T09:30:00.000Z",
        fileName: "extrato.ofx",
        added: 2,
        skipped: 0,
      },
    ]);
  });

  it("records the entries it skipped, so the history is honest about them", () => {
    const entries = [entry("a", -1000), entry("a", -1000)];
    const plan = planImport(entries, ACC_ID, []);

    const outcome = commitImport({ plan, fileName: "extrato.ofx" })(vault, ctx);
    if (!outcome.ok) throw new Error(outcome.message);
    expect(outcome.vault.imports[0]).toMatchObject({ added: 1, skipped: 1 });
  });

  it("runs the Rules over its own additions, so a routine month arrives classified", () => {
    const plan = planImport([entry("a", -1000), entry("b", 2000)], ACC_ID, []);
    const withRule: Vault = { ...vault, rules: [marketRule] };

    const outcome = commitImport({ plan, fileName: "extrato.ofx" })(withRule, ctx);
    if (!outcome.ok) throw new Error(outcome.message);

    expect(outcome.classified).toBe(1);
    const classified = outcome.vault.transactions.find((t) => t.description === "entry a");
    expect(classified?.kind !== "transfer" && classified?.categoryId).toBe("cat-market");
    expect(classified?.kind !== "transfer" && classified?.ruleId).toBe("r-1");
  });

  it("offers the Rules only its own additions, never the backlog", () => {
    const backlog: Transaction = {
      id: "old",
      kind: "expense",
      date: "2026-09-01",
      amount: centavos(500),
      description: "entry a from months ago",
      accountId: ACC_ID,
      categoryId: null,
    };
    const withBacklog: Vault = { ...vault, rules: [marketRule], transactions: [backlog] };
    const plan = planImport([entry("b", 2000)], ACC_ID, withBacklog.transactions);

    const outcome = commitImport({ plan, fileName: "extrato.ofx" })(withBacklog, ctx);
    if (!outcome.ok) throw new Error(outcome.message);

    expect(outcome.classified).toBe(0);
    const old = outcome.vault.transactions.find((t) => t.id === "old");
    expect(old?.kind !== "transfer" && old?.categoryId).toBeNull();
  });

  it("imports exactly as before when the vault has no Rules", () => {
    const plan = planImport([entry("a", -1000)], ACC_ID, []);

    const outcome = commitImport({ plan, fileName: "extrato.ofx" })(vault, ctx);
    if (!outcome.ok) throw new Error(outcome.message);

    expect(outcome.classified).toBe(0);
    const added = outcome.vault.transactions[0];
    expect(added.kind !== "transfer" && added.categoryId).toBeNull();
    expect(added.kind !== "transfer" && added.ruleId).toBeUndefined();
  });
});
