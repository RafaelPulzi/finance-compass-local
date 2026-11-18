import { describe, expect, it } from "vitest";
import { centavos } from "../domain/money";
import { NO_FILTER } from "../domain/transactionQuery";
import type { Transaction, Vault } from "../domain/types";
import { emptyVault } from "../domain/types";
import { PAGE_SIZE, selectableIdsOf, worklistView } from "./view";
import { emptyWorklist } from "./worklist";
import type { WorklistState } from "./worklist";

/** What the page shows, asked of the derivation rather than of the DOM. */

const INTER = "acc-inter";
const SAVINGS = "acc-savings";

const base: Vault = {
  ...emptyVault(),
  accounts: [
    { id: INTER, name: "Banco Inter", type: "checking", openingBalance: centavos(10000) },
    { id: SAVINGS, name: "Poupança", type: "savings", openingBalance: centavos(0) },
  ],
  groups: [{ id: "g-food", name: "Alimentação", kind: "expense" }],
  categories: [{ id: "cat-market", name: "Mercado", groupId: "g-food" }],
};

const expense = (
  id: string,
  date: string,
  description: string,
  categoryId: string | null = null,
): Transaction => ({
  id,
  kind: "expense",
  date,
  amount: centavos(1000),
  description,
  accountId: INTER,
  categoryId,
});

/** `count` Expenses, each on its own day, so the order is unambiguous. */
function manyExpenses(count: number): Transaction[] {
  return Array.from({ length: count }, (_, i) =>
    expense(`e${i}`, `2026-10-${String((i % 28) + 1).padStart(2, "0")}`, `UBER ${i}`),
  );
}

const showing = (vault: Vault, state: Partial<WorklistState> = {}) =>
  worklistView({ ...emptyWorklist, ...state }, vault);

describe("the page being shown", () => {
  it("is a page of the result, not the whole of it", () => {
    const view = showing({ ...base, transactions: manyExpenses(PAGE_SIZE + 10) });

    expect(view.rows).toHaveLength(PAGE_SIZE);
    expect(view.pageCount).toBe(2);
    // The count is the filter's whole result set, which is what makes
    // classifying a Statement one decision instead of twelve.
    expect(view.selection.count).toBe(PAGE_SIZE + 10);
  });

  it("is one page when everything fits, never zero", () => {
    expect(showing(base).pageCount).toBe(1);
    expect(showing({ ...base, transactions: manyExpenses(3) }).pageCount).toBe(1);
  });

  it("falls back to the last page when the result shrinks under the one asked for", () => {
    // The user was on page 3; a classification narrowed the result to one page.
    const view = showing({ ...base, transactions: manyExpenses(10) }, { page: 2 });

    expect(view.page).toBe(0);
    expect(view.rows).toHaveLength(10);
  });

  it("keeps the newest-first order across the page boundary", () => {
    const transactions = [
      expense("old", "2026-09-01", "ANTIGA"),
      expense("new", "2026-10-31", "NOVA"),
    ];
    const view = showing({ ...base, transactions });

    expect(view.rows.map((tx) => tx.id)).toEqual(["new", "old"]);
  });
});

describe("what can be selected", () => {
  const vault: Vault = {
    ...base,
    transactions: [
      expense("e1", "2026-10-02", "UBER"),
      expense("e2", "2026-10-03", "IFOOD"),
      {
        id: "t1",
        kind: "transfer",
        date: "2026-10-06",
        amount: centavos(50000),
        description: "PARA POUPANCA",
        fromAccountId: INTER,
        toAccountId: SAVINGS,
      },
    ],
  };

  it("is every match of the filter except the Transfers", () => {
    expect(showing(vault).selectableIds).toEqual(["e2", "e1"]);
    expect(selectableIdsOf(vault, NO_FILTER)).toEqual(["e2", "e1"]);
  });

  it("counts the result set, so the control agrees with what selecting all does", () => {
    const narrowed = { ...NO_FILTER, search: "uber" };

    expect(showing(vault, { filter: narrowed }).selectableIds).toEqual(
      selectableIdsOf(vault, narrowed),
    );
  });

  it("is all selected only once every selectable row is in", () => {
    expect(showing(vault, { selected: new Set(["e1"]) }).allSelected).toBe(false);
    expect(showing(vault, { selected: new Set(["e1", "e2"]) }).allSelected).toBe(true);
    // An empty list is not "all selected": there would be nothing to act on.
    expect(showing(base).allSelected).toBe(false);
  });

  it("names the selection's kind, or that it spans both", () => {
    const withIncome: Vault = {
      ...base,
      transactions: [
        ...vault.transactions,
        {
          id: "i1",
          kind: "income",
          date: "2026-10-05",
          amount: centavos(485000),
          description: "SALARIO",
          accountId: INTER,
          categoryId: null,
        },
      ],
    };

    expect(showing(withIncome).kindOfSelection).toBeNull();
    expect(showing(withIncome, { selected: new Set(["e1"]) }).kindOfSelection).toBe("expense");
    expect(showing(withIncome, { selected: new Set(["i1"]) }).kindOfSelection).toBe("income");
    expect(showing(withIncome, { selected: new Set(["e1", "i1"]) }).kindOfSelection).toBe("mixed");
  });
});

describe("what still needs a Category", () => {
  it("counts the whole Vault, not the filter's result", () => {
    const vault = {
      ...base,
      transactions: [
        expense("e1", "2026-10-02", "UBER"),
        expense("e2", "2026-10-03", "IFOOD", "cat-market"),
      ],
    };

    expect(showing(vault, { filter: { ...NO_FILTER, search: "ifood" } }).pendingCategories).toBe(1);
  });

  it("offers a Suggestion per row, from the user's own repeated decisions", () => {
    const vault = {
      ...base,
      transactions: [
        expense("h1", "2026-09-01", "PADARIA BOM PAO", "cat-market"),
        expense("h2", "2026-09-02", "PADARIA BOM PAO", "cat-market"),
        expense("e1", "2026-10-02", "PADARIA BOM PAO"),
      ],
    };

    const view = showing(vault);

    expect([...view.suggestionFor.keys()]).toEqual(["e1"]);
    expect(view.suggestionFor.get("e1")).toMatchObject({ categoryId: "cat-market" });
  });
});
