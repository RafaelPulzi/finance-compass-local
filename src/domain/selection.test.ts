import { describe, expect, it } from "vitest";
import { centavos } from "./money";
import { markingPreview, selectedDescriptions, selectedKind } from "./selection";
import { markAllAsTransfers } from "./transferRecovery";
import type { Transaction, Vault } from "./types";
import { emptyVault } from "./types";

const INTER = "acc-inter";
const SAVINGS = "acc-savings";

const base: Vault = {
  ...emptyVault(),
  accounts: [
    { id: INTER, name: "Banco Inter", type: "checking", openingBalance: centavos(0) },
    { id: SAVINGS, name: "Poupança", type: "savings", openingBalance: centavos(0) },
  ],
};

let nextId = 0;
const tx = (overrides: Partial<Transaction> = {}): Transaction =>
  ({
    id: `tx-${++nextId}`,
    kind: "expense",
    date: "2026-10-02",
    amount: centavos(25001),
    description: "APLICACAO CDB",
    accountId: INTER,
    categoryId: null,
    ...overrides,
  }) as Transaction;

describe("selectedKind", () => {
  it("names the one kind, mixed when both, null when nothing selectable", () => {
    const e = tx();
    const i = tx({ kind: "income" });
    const vault = { ...base, transactions: [e, i] };
    expect(selectedKind(vault, new Set([e.id]))).toBe("expense");
    expect(selectedKind(vault, new Set([e.id, i.id]))).toBe("mixed");
    expect(selectedKind(vault, new Set())).toBeNull();
  });
});

describe("selectedDescriptions", () => {
  it("reads the selected descriptions, never a Transfer's", () => {
    const e = tx({ description: "IFOOD 1" });
    const t = tx({
      kind: "transfer",
      description: "mov",
      fromAccountId: INTER,
      toAccountId: SAVINGS,
    });
    const vault = { ...base, transactions: [e, t] };
    expect(selectedDescriptions(vault, new Set([e.id, t.id]))).toEqual(["IFOOD 1"]);
  });
});

describe("markingPreview", () => {
  it("splits the balance change by direction, from the real conversions", () => {
    const e = tx({ amount: centavos(25001) });
    const i = tx({ kind: "income", amount: centavos(10000) });
    const vault = { ...base, transactions: [e, i] };

    expect(markingPreview(vault, [e.id, i.id], SAVINGS)).toEqual({
      converts: 2,
      skipped: 0,
      arrives: centavos(25001),
      leaves: centavos(10000),
    });
  });

  it("leaves out an entry already on the chosen Account (the old bug)", () => {
    // The page used to sum the whole selection, so this entry inflated the
    // promised "aumenta" even though the conversion then skipped it.
    const converts = tx({ amount: centavos(25001) });
    const alreadyThere = tx({ amount: centavos(25001), accountId: SAVINGS });
    const vault = { ...base, transactions: [converts, alreadyThere] };

    expect(markingPreview(vault, [converts.id, alreadyThere.id], SAVINGS)).toEqual({
      converts: 1,
      skipped: 1,
      arrives: centavos(25001),
      leaves: centavos(0),
    });
  });

  it("promises exactly what the conversion then does", () => {
    const e = tx();
    const already = tx({ accountId: SAVINGS });
    const i = tx({ kind: "income", amount: centavos(10000) });
    const vault = { ...base, transactions: [e, already, i] };
    const ids = [e.id, already.id, i.id];

    const preview = markingPreview(vault, ids, SAVINGS);
    const outcome = markAllAsTransfers(vault, ids, SAVINGS);
    if (!outcome.ok) throw new Error(outcome.message);
    expect(outcome.converted).toBe(preview.converts);
    expect(outcome.skipped).toHaveLength(preview.skipped);
  });
});
