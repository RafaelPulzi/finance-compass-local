import { describe, expect, it } from "vitest";
import { centavos } from "./money";
import type { OfxEntry } from "./ofx";
import { planImport, toTransactions } from "./statementImport";
import type { Transaction } from "./types";

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
