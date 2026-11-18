import { describe, expect, it } from "vitest";
import type { CommandOutcome, CommandResult, SessionContext } from "../domain/command";
import { centavos } from "../domain/money";
import { NO_FILTER } from "../domain/transactionQuery";
import type { Transaction, Vault } from "../domain/types";
import { emptyVault } from "../domain/types";
import type { RunCommand } from "../store/useVault";
import {
  acceptRuleOffer,
  acceptSuggestion,
  applyAllSuggestions,
  changeFilter,
  classifyRow,
  classifySelected,
  clearSelection,
  closeRow,
  declineRuleOffer,
  deleteRow,
  emptyWorklist,
  goToPage,
  markRow,
  markSelected,
  openRow,
  saveRowEdit,
  toggleAll,
  toggleSelected,
  undoRowMarking,
} from "./worklist";
import type { WorklistDeps, WorklistState } from "./worklist";

/**
 * The Worklist on its own: plain functions over plain values, so what one
 * gesture does is asserted without a DOM, a hook or an `act`.
 *
 * `run` is the real thing minus zustand — a Command against the vault in hand,
 * a refusal writing nothing, and the report coming back without the vault —
 * which is the whole of what a gesture is allowed to see of the store.
 */

const INTER = "acc-inter";
const SAVINGS = "acc-savings";

const base: Vault = {
  ...emptyVault(),
  accounts: [
    { id: INTER, name: "Banco Inter", type: "checking", openingBalance: centavos(10000) },
    { id: SAVINGS, name: "Poupança", type: "savings", openingBalance: centavos(0) },
  ],
  groups: [
    { id: "g-food", name: "Alimentação", kind: "expense" },
    { id: "g-in", name: "Renda", kind: "income" },
  ],
  categories: [
    { id: "cat-market", name: "Mercado", groupId: "g-food" },
    { id: "cat-salary", name: "Salário", groupId: "g-in" },
  ],
};

const expense = (
  id: string,
  description: string,
  categoryId: string | null = null,
  accountId = INTER,
  amount = 25001,
): Transaction => ({
  id,
  kind: "expense",
  date: "2026-10-02",
  amount: centavos(amount),
  description,
  accountId,
  categoryId,
});

const income = (id: string, description: string, categoryId: string | null = null): Transaction => ({
  id,
  kind: "income",
  date: "2026-10-05",
  amount: centavos(485000),
  description,
  accountId: INTER,
  categoryId,
});

const transfer = (id: string, description: string): Transaction => ({
  id,
  kind: "transfer",
  date: "2026-10-06",
  amount: centavos(50000),
  description,
  fromAccountId: INTER,
  toAccountId: SAVINGS,
});

/** A store for one test: the same write rules as `run`, without the store. */
function attach(vault: Vault) {
  let current = vault;
  let ids = 0;
  const ctx: SessionContext = {
    newId: () => `id-${(ids += 1)}`,
    now: () => "2026-11-18T12:00:00.000Z",
  };

  const run = (<O extends CommandOutcome<object>>(
    command: (v: Vault, c: SessionContext) => O,
  ): CommandResult<O> => {
    const outcome = command(current, ctx);
    if (!outcome.ok) return outcome as CommandResult<O>;
    current = outcome.vault;
    const { vault: _applied, ...report } = outcome;
    return report as CommandResult<O>;
  }) as RunCommand;

  return {
    run,
    /** Fresh deps per gesture, as each render hands the gesture the current Vault. */
    deps: (): WorklistDeps => ({ vault: current, run }),
    vault: () => current,
    tx: (id: string) => current.transactions.find((t) => t.id === id),
  };
}

const selecting = (...ids: string[]): WorklistState => ({
  ...emptyWorklist,
  selected: new Set(ids),
});

describe("the selection", () => {
  it("takes a row in and lets it back out", () => {
    const h = attach({ ...base, transactions: [expense("e1", "UBER")] });
    const on = toggleSelected(emptyWorklist, h.deps(), "e1");
    expect([...on.selected]).toEqual(["e1"]);
    expect([...toggleSelected(on, h.deps(), "e1").selected]).toEqual([]);
  });

  it("takes in every match of the filter, not just a page of them", () => {
    const transactions = Array.from({ length: 120 }, (_, i) => expense(`e${i}`, `UBER ${i}`));
    const h = attach({ ...base, transactions });

    expect(toggleAll(emptyWorklist, h.deps()).selected.size).toBe(120);
  });

  it("leaves out a Transfer, which has no Category to be classified into", () => {
    const h = attach({
      ...base,
      transactions: [expense("e1", "UBER"), transfer("t1", "PARA POUPANCA")],
    });

    expect([...toggleAll(emptyWorklist, h.deps()).selected]).toEqual(["e1"]);
  });

  it("empties when everything matching was already in it", () => {
    const h = attach({ ...base, transactions: [expense("e1", "UBER"), expense("e2", "IFOOD")] });
    const all = toggleAll(emptyWorklist, h.deps());

    expect(toggleAll(all, h.deps()).selected.size).toBe(0);
  });

  it("empties on request, changing no Transaction", () => {
    const h = attach({ ...base, transactions: [expense("e1", "UBER")] });
    expect(clearSelection(selecting("e1")).selected.size).toBe(0);
    expect(h.tx("e1")?.description).toBe("UBER");
  });
});

describe("a gesture that removes the row it acts on", () => {
  /**
   * The bug this module was extracted to kill: the selection used to keep an
   * id the gesture had just removed, so the bar overcounted and the next bulk
   * gesture passed a dead id along to be reported back as skipped.
   */
  it("drops the deleted row from the selection", () => {
    const h = attach({ ...base, transactions: [expense("e1", "UBER"), expense("e2", "IFOOD")] });

    const next = deleteRow(selecting("e1", "e2"), h.deps(), "e1");

    expect([...next.selected]).toEqual(["e2"]);
    expect(h.tx("e1")).toBeUndefined();
  });

  it("closes the confirmation whether or not the delete was refused", () => {
    const h = attach({ ...base, transactions: [expense("e1", "UBER")] });
    const open: WorklistState = { ...emptyWorklist, openRow: { id: "e1", mode: "deleting" } };

    expect(deleteRow(open, h.deps(), "e1").openRow).toBeNull();
  });

  it("keeps a row the gesture was refused, since it is still there to act on", () => {
    const refusing = attach({ ...base, transactions: [expense("e1", "UBER")] });
    // `deleteTransaction` accepts an unknown id as nothing to do, so a refusal
    // has to come from a Command that can refuse: marking against no Account.
    const next = markRow(selecting("e1"), refusing.deps(), "e1", "");

    expect(next.result.ok).toBe(false);
    expect([...next.state.selected]).toEqual(["e1"]);
    expect(next.state.openRow).toBeNull();
  });

  it("drops a row that became a Transfer, which can no longer be selected", () => {
    const h = attach({ ...base, transactions: [expense("e1", "APLICACAO"), expense("e2", "IFOOD")] });

    const next = markRow(selecting("e1", "e2"), h.deps(), "e1", SAVINGS);

    expect(next.result).toEqual({ ok: true });
    expect([...next.state.selected]).toEqual(["e2"]);
    expect(h.tx("e1")?.kind).toBe("transfer");
    expect(next.state.openRow).toBeNull();
  });
});

describe("the row with a form open", () => {
  it("is one row, so opening another closes the first", () => {
    const h = attach({ ...base, transactions: [expense("e1", "UBER"), expense("e2", "IFOOD")] });

    const editing = openRow(emptyWorklist, h.deps(), "e1", "editing");
    const deleting = openRow(editing, h.deps(), "e2", "deleting");

    expect(deleting.openRow).toEqual({ id: "e2", mode: "deleting" });
  });

  it("drops a refusal that belonged to the row before the form opened", () => {
    const h = attach({ ...base, transactions: [expense("e1", "UBER")] });
    const refused = classifyRow(emptyWorklist, h.deps(), "e1", "cat-nope");
    expect(refused.notice).not.toBeNull();

    expect(openRow(refused, h.deps(), "e1", "editing").notice).toBeNull();
  });

  it("closes on its own, leaving the selection where it was", () => {
    const open: WorklistState = {
      ...selecting("e1"),
      openRow: { id: "e1", mode: "editing" },
    };
    const closed = closeRow(open);

    expect(closed.openRow).toBeNull();
    expect([...closed.selected]).toEqual(["e1"]);
  });

  it("stays open with its refusal when the edit is refused", () => {
    const h = attach({ ...base, transactions: [expense("e1", "UBER")] });
    const open: WorklistState = { ...emptyWorklist, openRow: { id: "e1", mode: "editing" } };

    const answered = saveRowEdit(open, h.deps(), "e1", { amount: centavos(0) });

    expect(answered.result.ok).toBe(false);
    // The form shows the message, so the state has to leave it standing.
    expect(answered.state.openRow).toEqual({ id: "e1", mode: "editing" });
  });

  it("closes once the edit is saved", () => {
    const h = attach({ ...base, transactions: [expense("e1", "UBER")] });
    const open: WorklistState = { ...emptyWorklist, openRow: { id: "e1", mode: "editing" } };

    const answered = saveRowEdit(open, h.deps(), "e1", { description: "UBER TRIP" });

    expect(answered.result).toEqual({ ok: true });
    expect(answered.state.openRow).toBeNull();
    expect(h.tx("e1")?.description).toBe("UBER TRIP");
  });
});

describe("changing the filter", () => {
  it("resets everything the old result set gave meaning to", () => {
    const h = attach({ ...base, transactions: [expense("e1", "UBER")] });
    const busy: WorklistState = {
      filter: NO_FILTER,
      page: 3,
      selected: new Set(["e1"]),
      openRow: { id: "e1", mode: "editing" },
      notice: { at: "bulk", said: "suggestionsApplied", applied: 2 },
      ruleOffer: { pattern: "uber", categoryId: "cat-market" },
    };

    const next = changeFilter(busy, h.deps(), { ...NO_FILTER, search: "uber" });

    expect(next).toEqual({ ...emptyWorklist, filter: { ...NO_FILTER, search: "uber" } });
  });

  it("is the only thing that moves the page, otherwise", () => {
    const h = attach(base);
    expect(goToPage(emptyWorklist, h.deps(), 2).page).toBe(2);
  });
});

describe("classifying the whole selection", () => {
  it("writes the Category and empties the selection", () => {
    const h = attach({ ...base, transactions: [expense("e1", "IFOOD 1"), expense("e2", "IFOOD 2")] });

    const next = classifySelected(selecting("e1", "e2"), h.deps(), "cat-market");

    expect(h.tx("e1")).toMatchObject({ categoryId: "cat-market" });
    expect(h.tx("e2")).toMatchObject({ categoryId: "cat-market" });
    expect(next.selected.size).toBe(0);
  });

  it("offers the Rule the classified descriptions share", () => {
    const h = attach({ ...base, transactions: [expense("e1", "IFOOD CLUB"), expense("e2", "IFOOD BAR")] });

    const next = classifySelected(selecting("e1", "e2"), h.deps(), "cat-market");

    expect(next.ruleOffer).toEqual({ pattern: "ifood", categoryId: "cat-market" });
  });

  it("offers nothing when the classification changed nothing", () => {
    const h = attach({ ...base, transactions: [expense("e1", "IFOOD", "cat-market")] });

    expect(classifySelected(selecting("e1"), h.deps(), "cat-market").ruleOffer).toBeNull();
  });

  it("keeps the selection when the domain refuses, and says why", () => {
    const h = attach({ ...base, transactions: [expense("e1", "IFOOD")] });

    const next = classifySelected(selecting("e1"), h.deps(), "cat-nope");

    expect(next.notice).toEqual({
      at: "bulk",
      said: "refused",
      message: "Escolha uma categoria existente.",
    });
    expect([...next.selected]).toEqual(["e1"]);
  });

  it("remembers the offered Rule, under the pattern the user settled on", () => {
    const h = attach({ ...base, transactions: [expense("e1", "IFOOD CLUB")] });
    const offered = classifySelected(selecting("e1"), h.deps(), "cat-market");

    const next = acceptRuleOffer(offered, h.deps(), "ifood club");

    expect(h.vault().rules).toEqual([
      { id: "id-1", pattern: "ifood club", categoryId: "cat-market", kind: "expense" },
    ]);
    expect(next.ruleOffer).toBeNull();
    expect(next.notice).toEqual({
      at: "bulk",
      said: "ruleCreated",
      pattern: "ifood club",
      categoryId: "cat-market",
    });
  });

  it("creates nothing when the offer was declined", () => {
    const h = attach({ ...base, transactions: [expense("e1", "IFOOD CLUB")] });
    const offered = classifySelected(selecting("e1"), h.deps(), "cat-market");

    const next = declineRuleOffer(offered);

    expect(next.ruleOffer).toBeNull();
    expect(h.vault().rules).toEqual([]);
    // Accepting an offer that is no longer there cannot write either.
    expect(acceptRuleOffer(next, h.deps(), "ifood")).toBe(next);
    expect(h.vault().rules).toEqual([]);
  });
});

describe("marking the whole selection as Transfers", () => {
  it("reports what converted and what was skipped, as numbers and reasons", () => {
    const h = attach({
      ...base,
      transactions: [
        expense("e1", "APLICACAO 1"),
        income("i1", "RESGATE"),
        // Already on the Account the batch points at: it cannot convert.
        expense("e3", "JA NA POUPANCA", null, SAVINGS),
      ],
    });

    const next = markSelected(selecting("e1", "i1", "e3"), h.deps(), SAVINGS);

    expect(next.notice).toEqual({
      at: "bulk",
      said: "marked",
      converted: 2,
      skipped: [
        {
          transactionId: "e3",
          message: "Escolha uma conta diferente da do lançamento.",
        },
      ],
    });
    expect(next.selected.size).toBe(0);
    expect(h.tx("e1")?.kind).toBe("transfer");
    expect(h.tx("e3")?.kind).toBe("expense");
  });

  it("keeps the selection when the whole batch is refused", () => {
    const h = attach({ ...base, transactions: [expense("e1", "APLICACAO")] });

    const next = markSelected(selecting("e1"), h.deps(), "");

    expect(next.notice).toMatchObject({ at: "bulk", said: "refused" });
    expect([...next.selected]).toEqual(["e1"]);
  });
});

describe("the Suggestions read off the user's own decisions", () => {
  /** Two hand decisions on the same description are what makes a habit. */
  const habit: Vault = {
    ...base,
    transactions: [
      expense("h1", "PADARIA BOM PAO", "cat-market"),
      expense("h2", "PADARIA BOM PAO", "cat-market"),
      expense("e1", "PADARIA BOM PAO"),
    ],
  };

  it("applies them all at once and counts them", () => {
    const h = attach(habit);

    const next = applyAllSuggestions(emptyWorklist, h.deps());

    expect(next.notice).toEqual({ at: "bulk", said: "suggestionsApplied", applied: 1 });
    expect(h.tx("e1")).toMatchObject({ categoryId: "cat-market" });
  });

  it("applies the one offered on a row, through the same write", () => {
    const h = attach(habit);

    acceptSuggestion(emptyWorklist, h.deps(), "e1");

    expect(h.tx("e1")).toMatchObject({ categoryId: "cat-market" });
  });

  it("does nothing on a row that has no Suggestion", () => {
    const h = attach(habit);

    expect(acceptSuggestion(emptyWorklist, h.deps(), "h1")).toBe(emptyWorklist);
  });

  /**
   * A Suggestion is already the habit machinery (ADR-0008), so accepting one
   * must not offer a Rule as well: that would offer the same thing twice. The
   * Rule offer is the bulk path's alone (ADR-0011).
   */
  it("offers no Rule, neither accepted on a row nor applied in bulk", () => {
    const h = attach(habit);

    expect(acceptSuggestion(emptyWorklist, h.deps(), "e1").ruleOffer).toBeNull();
    expect(applyAllSuggestions(emptyWorklist, h.deps()).ruleOffer).toBeNull();
  });
});

describe("a refusal with no form of its own", () => {
  it("is shown on the row the gesture was aimed at", () => {
    const h = attach({ ...base, transactions: [expense("e1", "UBER")] });

    const next = classifyRow(emptyWorklist, h.deps(), "e1", "cat-nope");

    expect(next.notice).toEqual({
      at: "row",
      id: "e1",
      message: "Escolha uma categoria existente.",
    });
  });

  it("goes away once the same gesture works", () => {
    const h = attach({ ...base, transactions: [expense("e1", "UBER")] });
    const refused = classifyRow(emptyWorklist, h.deps(), "e1", "cat-nope");

    expect(classifyRow(refused, h.deps(), "e1", "cat-market").notice).toBeNull();
  });

  it("reports an undo the domain would not do", () => {
    // A Transfer the user typed in was recovered from nothing, so there is
    // nothing to go back to.
    const h = attach({ ...base, transactions: [transfer("t1", "PARA POUPANCA")] });

    expect(undoRowMarking(emptyWorklist, h.deps(), "t1").notice).toMatchObject({
      at: "row",
      id: "t1",
    });
  });

  it("classifying one row offers no Rule, however well it went", () => {
    const h = attach({ ...base, transactions: [expense("e1", "IFOOD CLUB")] });

    expect(classifyRow(emptyWorklist, h.deps(), "e1", "cat-market").ruleOffer).toBeNull();
  });
});
