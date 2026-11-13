import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { centavos } from "../domain/money";
import type { Transaction, Vault } from "../domain/types";
import { emptyVault } from "../domain/types";
import { useVault } from "../store/useVault";
import { TransactionsPanel } from "./TransactionsPanel";

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
  date: string,
  amount: number,
  description: string,
  categoryId: string | null,
  accountId = INTER,
): Transaction => ({
  id,
  kind: "expense",
  date,
  amount: centavos(amount),
  description,
  accountId,
  categoryId,
});

/** Mount the panel against a Vault, without going near the repository. */
function show(vault: Vault) {
  useVault.setState({ vault, status: "ready" });
  return render(<TransactionsPanel />);
}

/** The Transaction list, as distinct from the add form above it. */
function listItems() {
  return screen.getAllByRole("listitem");
}

function listText() {
  return listItems()
    .map((li) => li.textContent ?? "")
    .join("\n");
}

beforeEach(() => {
  useVault.setState({ vault: emptyVault(), status: "ready" });
});

describe("TransactionsPanel list", () => {
  const vault: Vault = {
    ...base,
    transactions: [
      expense("e1", "2026-10-02", 30000, "SUPERMERCADO SAO JOSE", "cat-market"),
      expense("e2", "2026-10-15", 4500, "AÇAÍ DA PRAÇA", null),
      expense("e3", "2026-09-20", 9900, "UBER TRIP", null),
      expense("e4", "2026-10-11", 1200, "Padaria", null, SAVINGS),
      {
        id: "i1",
        kind: "income",
        date: "2026-10-05",
        amount: centavos(485000),
        description: "SALARIO EMPRESA",
        accountId: INTER,
        categoryId: "cat-salary",
      },
    ],
  };

  it("shows every Transaction, not just the newest few", () => {
    show(vault);
    const text = listText();
    for (const description of [
      "SUPERMERCADO SAO JOSE",
      "AÇAÍ DA PRAÇA",
      "UBER TRIP",
      "Padaria",
      "SALARIO EMPRESA",
    ]) {
      expect(text).toContain(description);
    }
  });

  it("reports how many Transactions match and what they total", () => {
    show(vault);
    const summary = screen.getByTestId("selection-summary");
    expect(summary).toHaveTextContent("5 transações");
    expect(summary).toHaveTextContent("4.850,00"); // income
    expect(summary).toHaveTextContent("456,00"); // 300 + 45 + 99 + 12
  });

  it("narrows the list by account", async () => {
    show(vault);
    await userEvent.selectOptions(screen.getByLabelText("Conta"), "Poupança");
    expect(listText()).toContain("Padaria");
    expect(listText()).not.toContain("SUPERMERCADO");
    expect(screen.getByTestId("selection-summary")).toHaveTextContent("1 transação");
  });

  it("narrows the list by month", async () => {
    show(vault);
    await userEvent.selectOptions(screen.getByLabelText("Mês"), "2026-09");
    expect(listText()).toContain("UBER TRIP");
    expect(listText()).not.toContain("Padaria");
  });

  it("narrows the list by kind", async () => {
    show(vault);
    await userEvent.selectOptions(screen.getByLabelText("Tipo"), "income");
    expect(listText()).toContain("SALARIO EMPRESA");
    expect(listText()).not.toContain("SUPERMERCADO");
  });

  it("narrows the list to the Uncategorized ones", async () => {
    show(vault);
    await userEvent.selectOptions(screen.getByLabelText("Categoria"), "none");
    const text = listText();
    expect(text).toContain("AÇAÍ DA PRAÇA");
    expect(text).toContain("UBER TRIP");
    expect(text).toContain("Padaria");
    expect(text).not.toContain("SUPERMERCADO SAO JOSE"); // has a Category
  });

  it("narrows the list to one Category", async () => {
    show(vault);
    await userEvent.selectOptions(screen.getByLabelText("Categoria"), "id:cat-market");
    expect(listText()).toContain("SUPERMERCADO SAO JOSE");
    expect(listText()).not.toContain("AÇAÍ");
  });

  it("finds an accented description typed without accents", async () => {
    show(vault);
    await userEvent.type(screen.getByLabelText("Buscar descrição"), "acai");
    expect(listText()).toContain("AÇAÍ DA PRAÇA");
    expect(screen.getByTestId("selection-summary")).toHaveTextContent("1 transação");
  });

  it("combines filters", async () => {
    show(vault);
    await userEvent.selectOptions(screen.getByLabelText("Conta"), "Banco Inter");
    await userEvent.selectOptions(screen.getByLabelText("Mês"), "2026-10");
    await userEvent.selectOptions(screen.getByLabelText("Categoria"), "none");
    expect(screen.getByTestId("selection-summary")).toHaveTextContent("1 transação");
    expect(listText()).toContain("AÇAÍ DA PRAÇA");
  });

  it("clears every filter at once", async () => {
    show(vault);
    await userEvent.type(screen.getByLabelText("Buscar descrição"), "acai");
    await userEvent.click(screen.getByRole("button", { name: "limpar filtros" }));
    expect(screen.getByTestId("selection-summary")).toHaveTextContent("5 transações");
  });

  it("says so plainly when nothing matches", async () => {
    show(vault);
    await userEvent.type(screen.getByLabelText("Buscar descrição"), "nao existe nada assim");
    expect(listText()).toContain("Nenhuma transação corresponde aos filtros");
  });

  it("distinguishes an empty Vault from an empty filter result", () => {
    show(base);
    expect(listText()).toContain("Nenhuma transação ainda");
  });

  it("still offers a Category on each Uncategorized row", () => {
    show(vault);
    expect(screen.getByLabelText("Categoria de UBER TRIP")).toBeInTheDocument();
  });

  it("still shows how many Transactions are Uncategorized", () => {
    show(vault);
    expect(screen.getByText("3 sem categoria")).toBeInTheDocument();
  });
});

describe("TransactionsPanel paging", () => {
  /** 60 Transactions on consecutive days, so "Compra 59" is the newest. */
  const many: Vault = {
    ...base,
    transactions: Array.from({ length: 60 }, (_, i) => {
      const day = new Date(Date.UTC(2026, 2, 1 + i)).toISOString().slice(0, 10);
      return expense(
        `e${String(i).padStart(2, "0")}`,
        day,
        1000 + i,
        `Compra ${String(i).padStart(2, "0")}`,
        null,
      );
    }),
  };

  it("pages the list instead of truncating it", () => {
    show(many);
    expect(listItems()).toHaveLength(50);
    expect(screen.getByText("Página 1 de 2")).toBeInTheDocument();
    expect(listText()).toContain("Compra 59");
    expect(listText()).not.toContain("Compra 00");
  });

  it("reaches a Transaction that isn't on the first page", async () => {
    show(many);
    await userEvent.click(screen.getByRole("button", { name: "Próxima" }));
    expect(screen.getByText("Página 2 de 2")).toBeInTheDocument();
    expect(listText()).toContain("Compra 00");
    expect(listText()).not.toContain("Compra 59");
  });

  it("counts every match, not just the visible page", () => {
    show(many);
    expect(screen.getByTestId("selection-summary")).toHaveTextContent("60 transações");
  });

  it("goes back to the first page when the filter changes", async () => {
    show(many);
    await userEvent.click(screen.getByRole("button", { name: "Próxima" }));
    await userEvent.type(screen.getByLabelText("Buscar descrição"), "Compra");
    expect(screen.getByText("Página 1 de 2")).toBeInTheDocument();
    expect(listText()).toContain("Compra 59");
  });

  it("hides the pager when everything fits on one page", async () => {
    show(many);
    await userEvent.type(screen.getByLabelText("Buscar descrição"), "Compra 1");
    expect(screen.queryByRole("button", { name: "Próxima" })).not.toBeInTheDocument();
  });

  it("keeps the newest-first order within a page", () => {
    show(many);
    const first = within(listItems()[0]).getByText(/Compra/);
    expect(first).toHaveTextContent("Compra 59");
  });
});

describe("TransactionsPanel bulk classification", () => {
  const vault: Vault = {
    ...base,
    transactions: [
      expense("e1", "2026-10-02", 30000, "UBER TRIP 1", null),
      expense("e2", "2026-10-03", 20000, "UBER TRIP 2", null),
      expense("e3", "2026-10-04", 10000, "PADARIA", null),
      {
        id: "i1",
        kind: "income",
        date: "2026-10-05",
        amount: centavos(485000),
        description: "SALARIO",
        accountId: INTER,
        categoryId: null,
      },
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

  const categoryOf = (id: string) => {
    const tx = useVault.getState().vault.transactions.find((t) => t.id === id);
    return tx === undefined || tx.kind === "transfer" ? undefined : tx.categoryId;
  };

  it("offers no selection bar until something is selected", () => {
    show(vault);
    expect(screen.queryByLabelText("Categoria para as selecionadas")).not.toBeInTheDocument();
  });

  it("assigns one Category to everything selected, in one step", async () => {
    show(vault);
    await userEvent.click(screen.getByLabelText("Selecionar UBER TRIP 1"));
    await userEvent.click(screen.getByLabelText("Selecionar UBER TRIP 2"));
    expect(screen.getByText("2 selecionadas")).toBeInTheDocument();

    await userEvent.selectOptions(
      screen.getByLabelText("Categoria para as selecionadas"),
      "cat-market",
    );

    expect(categoryOf("e1")).toBe("cat-market");
    expect(categoryOf("e2")).toBe("cat-market");
    expect(categoryOf("e3")).toBeNull();
  });

  it("clears the selection after assigning", async () => {
    show(vault);
    await userEvent.click(screen.getByLabelText("Selecionar PADARIA"));
    await userEvent.selectOptions(
      screen.getByLabelText("Categoria para as selecionadas"),
      "cat-market",
    );
    expect(screen.queryByLabelText("Categoria para as selecionadas")).not.toBeInTheDocument();
  });

  it("selects every match of the filter, across all pages", async () => {
    show(vault);
    await userEvent.click(
      screen.getByLabelText("Selecionar todas as transações do filtro"),
    );
    // The Transfer is not selectable: it has no Category to be classified into.
    expect(screen.getByText("4 selecionadas")).toBeInTheDocument();
  });

  it("reports the whole result set in the select-all control, not the visible page", async () => {
    show(vault);
    expect(screen.getByText("Selecionar todas (4)")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Buscar descrição"), "uber");
    expect(screen.getByText("Selecionar todas (2)")).toBeInTheDocument();
  });

  it("offers no checkbox for a Transfer", () => {
    show(vault);
    expect(screen.queryByLabelText("Selecionar PARA POUPANCA")).not.toBeInTheDocument();
  });

  it("offers only Categories of the selection's kind", async () => {
    show(vault);
    await userEvent.click(screen.getByLabelText("Selecionar UBER TRIP 1"));
    const select = screen.getByLabelText("Categoria para as selecionadas");
    expect(within(select).getByText("Mercado")).toBeInTheDocument();
    expect(within(select).queryByText("Salário")).not.toBeInTheDocument();

    await userEvent.click(screen.getByLabelText("Selecionar UBER TRIP 1"));
    await userEvent.click(screen.getByLabelText("Selecionar SALARIO"));
    const incomeSelect = screen.getByLabelText("Categoria para as selecionadas");
    expect(within(incomeSelect).getByText("Salário")).toBeInTheDocument();
    expect(within(incomeSelect).queryByText("Mercado")).not.toBeInTheDocument();
  });

  it("refuses to classify a selection spanning both kinds, and says why", async () => {
    show(vault);
    await userEvent.click(screen.getByLabelText("Selecionar UBER TRIP 1"));
    await userEvent.click(screen.getByLabelText("Selecionar SALARIO"));

    expect(screen.queryByLabelText("Categoria para as selecionadas")).not.toBeInTheDocument();
    expect(screen.getByText(/categorias separadas/i)).toBeInTheDocument();
    expect(screen.getByText("2 selecionadas")).toBeInTheDocument();
  });

  it("clears the selection without assigning anything", async () => {
    show(vault);
    await userEvent.click(screen.getByLabelText("Selecionar UBER TRIP 1"));
    await userEvent.click(screen.getByRole("button", { name: "limpar seleção" }));

    expect(screen.queryByText("1 selecionada")).not.toBeInTheDocument();
    expect(categoryOf("e1")).toBeNull();
  });

  it("drops the selection when the filter changes", async () => {
    show(vault);
    await userEvent.click(screen.getByLabelText("Selecionar UBER TRIP 1"));
    expect(screen.getByText("1 selecionada")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Buscar descrição"), "uber");
    expect(screen.queryByText("1 selecionada")).not.toBeInTheDocument();
  });

  it("deselects a row that was selected", async () => {
    show(vault);
    const box = screen.getByLabelText("Selecionar PADARIA");
    await userEvent.click(box);
    await userEvent.click(box);
    expect(screen.queryByText("1 selecionada")).not.toBeInTheDocument();
  });

  it("select-all toggles back off", async () => {
    show(vault);
    const all = screen.getByLabelText("Selecionar todas as transações do filtro");
    await userEvent.click(all);
    expect(screen.getByText("4 selecionadas")).toBeInTheDocument();
    await userEvent.click(all);
    expect(screen.queryByText("4 selecionadas")).not.toBeInTheDocument();
  });
});

describe("TransactionsPanel editing and deleting", () => {
  const vault: Vault = {
    ...base,
    transactions: [
      expense("e1", "2026-10-02", 30000, "MERCADO", "cat-market"),
      expense("e2", "2026-10-03", 4500, "SEM CATEGORIA", null),
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
    imports: [
      {
        id: "imp-1",
        accountId: INTER,
        importedAt: "2026-10-16T00:00:00.000Z",
        fileName: "extrato.ofx",
        added: 2,
        skipped: 5,
      },
    ],
  };

  const txOf = (id: string) =>
    useVault.getState().vault.transactions.find((t) => t.id === id);

  it("round-trips a Transaction's values into the form", async () => {
    show(vault);
    await userEvent.click(screen.getByLabelText("Editar MERCADO"));

    expect(screen.getByLabelText("Editar data")).toHaveValue("2026-10-02");
    expect(screen.getByLabelText("Editar valor")).toHaveValue("300,00");
    expect(screen.getByLabelText("Editar descrição")).toHaveValue("MERCADO");
    expect(screen.getByLabelText("Editar tipo")).toHaveValue("expense");
    expect(screen.getByLabelText("Editar conta")).toHaveValue(INTER);
    expect(screen.getByLabelText("Editar categoria")).toHaveValue("cat-market");
  });

  it("saves a corrected description, amount and date", async () => {
    show(vault);
    await userEvent.click(screen.getByLabelText("Editar MERCADO"));

    const description = screen.getByLabelText("Editar descrição");
    await userEvent.clear(description);
    await userEvent.type(description, "SUPERMERCADO SAO JOSE");
    const amount = screen.getByLabelText("Editar valor");
    await userEvent.clear(amount);
    await userEvent.type(amount, "321,99");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    expect(txOf("e1")).toMatchObject({
      description: "SUPERMERCADO SAO JOSE",
      amount: 32199,
    });
    // The form closes on success.
    expect(screen.queryByLabelText("Editar descrição")).not.toBeInTheDocument();
  });

  it("swaps an Expense to an Income and drops the Category that no longer fits", async () => {
    show(vault);
    await userEvent.click(screen.getByLabelText("Editar MERCADO"));
    await userEvent.selectOptions(screen.getByLabelText("Editar tipo"), "income");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    expect(txOf("e1")).toMatchObject({ kind: "income", categoryId: null });
  });

  it("offers only the chosen kind's Categories as the kind changes", async () => {
    show(vault);
    await userEvent.click(screen.getByLabelText("Editar MERCADO"));
    const category = screen.getByLabelText("Editar categoria");
    expect(within(category).getByText("Mercado")).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Editar tipo"), "income");
    expect(within(category).getByText("Salário")).toBeInTheDocument();
    expect(within(category).queryByText("Mercado")).not.toBeInTheDocument();
  });

  it("clears a Category back to Uncategorized", async () => {
    show(vault);
    await userEvent.click(screen.getByLabelText("Editar MERCADO"));
    await userEvent.selectOptions(screen.getByLabelText("Editar categoria"), "");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    expect(txOf("e1")).toHaveProperty("categoryId", null);
  });

  it("offers a Transfer two Accounts and no Category or kind", async () => {
    show(vault);
    await userEvent.click(screen.getByLabelText("Editar PARA POUPANCA"));

    expect(screen.getByLabelText("Editar conta de origem")).toHaveValue(INTER);
    expect(screen.getByLabelText("Editar conta de destino")).toHaveValue(SAVINGS);
    expect(screen.queryByLabelText("Editar categoria")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Editar tipo")).not.toBeInTheDocument();
  });

  it("reports an unparseable amount and writes nothing", async () => {
    show(vault);
    await userEvent.click(screen.getByLabelText("Editar MERCADO"));
    const amount = screen.getByLabelText("Editar valor");
    await userEvent.clear(amount);
    await userEvent.type(amount, "abc");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    expect(screen.getByText("Informe um valor válido.")).toBeInTheDocument();
    expect(txOf("e1")).toMatchObject({ amount: 30000 });
    // The form stays open so the mistake can be corrected.
    expect(screen.getByLabelText("Editar valor")).toBeInTheDocument();
  });

  it("reports a refusal from the store and keeps the form open", async () => {
    show(vault);
    await userEvent.click(screen.getByLabelText("Editar MERCADO"));
    const amount = screen.getByLabelText("Editar valor");
    await userEvent.clear(amount);
    await userEvent.type(amount, "0,00");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));

    expect(screen.getByText("Informe um valor maior que zero.")).toBeInTheDocument();
    expect(txOf("e1")).toMatchObject({ amount: 30000 });
  });

  it("cancels an edit without changing anything", async () => {
    show(vault);
    await userEvent.click(screen.getByLabelText("Editar MERCADO"));
    const description = screen.getByLabelText("Editar descrição");
    await userEvent.clear(description);
    await userEvent.type(description, "NAO DEVE SALVAR");
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(txOf("e1")).toMatchObject({ description: "MERCADO" });
    expect(screen.queryByLabelText("Editar descrição")).not.toBeInTheDocument();
  });

  describe("deleting", () => {
    it("asks first, naming the Transaction", async () => {
      show(vault);
      await userEvent.click(screen.getByLabelText("Excluir MERCADO"));

      // Dates read the Brazilian way on screen: day, month, year.
      const prompt = screen.getByText(/Excluir .MERCADO. de 02\/10\/2026/);
      expect(prompt).toBeInTheDocument();
      expect(prompt).toHaveTextContent("300,00");
      // Nothing is gone yet.
      expect(txOf("e1")).toBeDefined();
    });

    it("removes the Transaction once confirmed", async () => {
      show(vault);
      await userEvent.click(screen.getByLabelText("Excluir MERCADO"));
      await userEvent.click(screen.getByRole("button", { name: "Confirmar exclusão" }));

      expect(txOf("e1")).toBeUndefined();
      expect(useVault.getState().vault.transactions).toHaveLength(2);
    });

    it("leaves the Import record alone", async () => {
      show(vault);
      await userEvent.click(screen.getByLabelText("Excluir MERCADO"));
      await userEvent.click(screen.getByRole("button", { name: "Confirmar exclusão" }));

      expect(useVault.getState().vault.imports).toMatchObject([
        { id: "imp-1", added: 2, skipped: 5 },
      ]);
    });

    it("cancels without deleting", async () => {
      show(vault);
      await userEvent.click(screen.getByLabelText("Excluir MERCADO"));
      await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));

      expect(txOf("e1")).toBeDefined();
      expect(screen.queryByText(/Excluir .MERCADO./)).not.toBeInTheDocument();
    });

    it("deletes a Transfer too", async () => {
      show(vault);
      await userEvent.click(screen.getByLabelText("Excluir PARA POUPANCA"));
      await userEvent.click(screen.getByRole("button", { name: "Confirmar exclusão" }));

      expect(txOf("t1")).toBeUndefined();
    });
  });

  it("opening an edit closes an open delete confirmation", async () => {
    show(vault);
    await userEvent.click(screen.getByLabelText("Excluir MERCADO"));
    await userEvent.click(screen.getByLabelText("Editar SEM CATEGORIA"));

    expect(screen.queryByText(/Excluir .MERCADO./)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Editar descrição")).toHaveValue("SEM CATEGORIA");
  });

  it("closes an open form when the filter changes", async () => {
    show(vault);
    await userEvent.click(screen.getByLabelText("Editar MERCADO"));
    await userEvent.type(screen.getByLabelText("Buscar descrição"), "mercado");

    expect(screen.queryByLabelText("Editar descrição")).not.toBeInTheDocument();
  });
});

describe("marking an entry as a Transfer", () => {
  const imported = (
    id: string,
    kind: "income" | "expense",
    description: string,
    fitid?: string,
  ): Transaction => ({
    id,
    kind,
    date: "2026-10-02",
    amount: centavos(30000),
    description,
    accountId: INTER,
    categoryId: null,
    ...(fitid === undefined ? {} : { fitid }),
  });

  const withEntry = (tx: Transaction): Vault => ({ ...base, transactions: [tx] });

  /** Open the marking form on the only row. */
  async function openForm(description: string) {
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: `Marcar ${description} como transferência` }),
    );
    return user;
  }

  it("offers the action on an Income or an Expense", () => {
    show(withEntry(imported("e1", "expense", "APLICACAO CDB", "FIT-1")));

    expect(
      screen.getByRole("button", { name: "Marcar APLICACAO CDB como transferência" }),
    ).toBeInTheDocument();
  });

  it("does not offer it on a Transfer, which is already one", () => {
    show({
      ...base,
      transactions: [
        {
          id: "t1",
          kind: "transfer",
          date: "2026-10-02",
          amount: centavos(30000),
          description: "JA MOVIDO",
          fromAccountId: INTER,
          toAccountId: SAVINGS,
        },
      ],
    });

    expect(
      screen.queryByRole("button", { name: /como transferência/ }),
    ).not.toBeInTheDocument();
  });

  it("asks only for the other Account, never the direction", async () => {
    show(withEntry(imported("e1", "expense", "APLICACAO CDB", "FIT-1")));
    await openForm("APLICACAO CDB");

    expect(screen.getByLabelText("Conta de destino")).toBeInTheDocument();
    expect(screen.queryByLabelText("Conta de origem")).not.toBeInTheDocument();
  });

  it("asks for the origin when the entry was an Income", async () => {
    show(withEntry(imported("i1", "income", "RESGATE CDB", "FIT-2")));
    await openForm("RESGATE CDB");

    expect(screen.getByLabelText("Conta de origem")).toBeInTheDocument();
  });

  it("leaves out the entry's own Account, so it cannot be chosen", async () => {
    show(withEntry(imported("e1", "expense", "APLICACAO CDB", "FIT-1")));
    await openForm("APLICACAO CDB");

    const options = within(screen.getByLabelText("Conta de destino")).getAllByRole(
      "option",
    );
    const names = options.map((o) => o.textContent);
    expect(names).toContain("Poupança");
    expect(names).not.toContain("Banco Inter");
  });

  it("says which balance will move before the click", async () => {
    show(withEntry(imported("e1", "expense", "APLICACAO CDB", "FIT-1")));
    const user = await openForm("APLICACAO CDB");

    await user.selectOptions(screen.getByLabelText("Conta de destino"), SAVINGS);

    expect(screen.getByText(/O saldo de Poupança aumenta em/)).toBeInTheDocument();
    expect(screen.getByText(/o saldo de Banco Inter não muda/)).toBeInTheDocument();
  });

  it("converts the entry, which then shows both Account names", async () => {
    show(withEntry(imported("e1", "expense", "APLICACAO CDB", "FIT-1")));
    const user = await openForm("APLICACAO CDB");

    await user.selectOptions(screen.getByLabelText("Conta de destino"), SAVINGS);
    await user.click(screen.getByRole("button", { name: "Marcar como transferência" }));

    expect(listText()).toContain("Banco Inter → Poupança");
    expect(useVault.getState().vault.transactions[0]).toMatchObject({
      kind: "transfer",
      recoveredFrom: [{ fitid: "FIT-1", accountId: INTER }],
    });
  });

  it("requires an Account, reporting it rather than converting", async () => {
    show(withEntry(imported("e1", "expense", "APLICACAO CDB", "FIT-1")));
    const user = await openForm("APLICACAO CDB");

    await user.click(screen.getByRole("button", { name: "Marcar como transferência" }));

    expect(screen.getByText("Escolha a conta de destino.")).toBeInTheDocument();
    expect(useVault.getState().vault.transactions[0]).toMatchObject({ kind: "expense" });
  });

  it("takes the money out of the Expense total", async () => {
    // formatBRL goes through Intl, which separates "R$" from the number with a
    // non-breaking space; the assertion is about the total, not that byte.
    const summary = () =>
      (screen.getByTestId("selection-summary").textContent ?? "").replace(
        / /g,
        " ",
      );

    show(withEntry(imported("e1", "expense", "APLICACAO CDB", "FIT-1")));
    expect(summary()).toContain("Despesas R$ 300,00");

    const user = await openForm("APLICACAO CDB");
    await user.selectOptions(screen.getByLabelText("Conta de destino"), SAVINGS);
    await user.click(screen.getByRole("button", { name: "Marcar como transferência" }));

    expect(summary()).toContain("Despesas R$ 0,00");
  });

  it("closes the form on cancel without converting", async () => {
    show(withEntry(imported("e1", "expense", "APLICACAO CDB", "FIT-1")));
    const user = await openForm("APLICACAO CDB");

    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByLabelText("Conta de destino")).not.toBeInTheDocument();
    expect(useVault.getState().vault.transactions[0]).toMatchObject({ kind: "expense" });
  });

  it("warns when the Vault has no other Account to point at", async () => {
    useVault.setState({
      vault: {
        ...base,
        accounts: [base.accounts[0]],
        transactions: [imported("e1", "expense", "APLICACAO CDB", "FIT-1")],
      },
      status: "ready",
    });
    render(<TransactionsPanel />);
    await openForm("APLICACAO CDB");

    expect(screen.getByText(/Só existe uma conta no cofre/)).toBeInTheDocument();
  });

  it("offers to undo a Transfer recovered from one entry, and restores it", async () => {
    show(withEntry(imported("e1", "expense", "APLICACAO CDB", "FIT-1")));
    const user = await openForm("APLICACAO CDB");
    await user.selectOptions(screen.getByLabelText("Conta de destino"), SAVINGS);
    await user.click(screen.getByRole("button", { name: "Marcar como transferência" }));

    await user.click(
      screen.getByRole("button", { name: "Desfazer transferência APLICACAO CDB" }),
    );

    expect(useVault.getState().vault.transactions[0]).toEqual({
      id: "e1",
      kind: "expense",
      date: "2026-10-02",
      amount: 30000,
      description: "APLICACAO CDB",
      accountId: INTER,
      categoryId: null,
      fitid: "FIT-1",
    });
  });

  it("does not offer the undo on a hand-entered Transfer", () => {
    show({
      ...base,
      transactions: [
        {
          id: "t1",
          kind: "transfer",
          date: "2026-10-02",
          amount: centavos(30000),
          description: "DIGITADA",
          fromAccountId: INTER,
          toAccountId: SAVINGS,
        },
      ],
    });

    expect(
      screen.queryByRole("button", { name: /Desfazer transferência/ }),
    ).not.toBeInTheDocument();
  });

  it("converts a hand-entered entry but then offers no undo", async () => {
    show(withEntry(imported("e1", "expense", "PAGAMENTO MANUAL")));
    const user = await openForm("PAGAMENTO MANUAL");

    await user.selectOptions(screen.getByLabelText("Conta de destino"), SAVINGS);
    await user.click(screen.getByRole("button", { name: "Marcar como transferência" }));

    expect(useVault.getState().vault.transactions[0]).toMatchObject({ kind: "transfer" });
    expect(
      screen.queryByRole("button", { name: /Desfazer transferência/ }),
    ).not.toBeInTheDocument();
  });

  it("stops offering the checkbox once the entry is a Transfer", async () => {
    show(withEntry(imported("e1", "expense", "APLICACAO CDB", "FIT-1")));
    expect(
      screen.getByRole("checkbox", { name: "Selecionar APLICACAO CDB" }),
    ).toBeInTheDocument();

    const user = await openForm("APLICACAO CDB");
    await user.selectOptions(screen.getByLabelText("Conta de destino"), SAVINGS);
    await user.click(screen.getByRole("button", { name: "Marcar como transferência" }));

    expect(
      screen.queryByRole("checkbox", { name: "Selecionar APLICACAO CDB" }),
    ).not.toBeInTheDocument();
  });
});

describe("TransactionsPanel add form", () => {
  it("clears a Category of the other kind when the kind changes, so it can't be saved under the wrong one", async () => {
    const user = userEvent.setup();
    show(base);
    await user.selectOptions(screen.getByLabelText("Nova transação: categoria"), "cat-market");
    await user.selectOptions(screen.getByLabelText("Nova transação: tipo"), "income");

    expect(screen.getByLabelText("Nova transação: categoria")).toHaveValue("");

    await user.type(screen.getByLabelText("Nova transação: valor"), "10,00");
    await user.selectOptions(screen.getByLabelText("Nova transação: conta"), INTER);
    await user.click(screen.getByRole("button", { name: "Adicionar transação" }));

    expect(screen.getByText("Escolha uma categoria.")).toBeInTheDocument();
    expect(useVault.getState().vault.transactions).toEqual([]);
  });

  it("records an Expense, reading a dot-decimal amount as reais and centavos", async () => {
    const user = userEvent.setup();
    show(base);
    await user.type(screen.getByLabelText("Nova transação: valor"), "49.90");
    await user.type(screen.getByLabelText("Nova transação: descrição"), "Feira");
    await user.selectOptions(screen.getByLabelText("Nova transação: conta"), INTER);
    await user.selectOptions(screen.getByLabelText("Nova transação: categoria"), "cat-market");
    await user.click(screen.getByRole("button", { name: "Adicionar transação" }));

    expect(useVault.getState().vault.transactions).toMatchObject([
      { kind: "expense", amount: 4990, description: "Feira", categoryId: "cat-market" },
    ]);
    expect(screen.getByLabelText("Nova transação: valor")).toHaveValue("");
  });

  it("shows the domain's refusal and keeps what was typed", async () => {
    const user = userEvent.setup();
    show(base);
    await user.selectOptions(screen.getByLabelText("Nova transação: tipo"), "transfer");
    await user.type(screen.getByLabelText("Nova transação: valor"), "100");
    await user.selectOptions(screen.getByLabelText("Nova transação: conta de origem"), INTER);
    await user.selectOptions(screen.getByLabelText("Nova transação: conta de destino"), INTER);
    await user.click(screen.getByRole("button", { name: "Adicionar transação" }));

    expect(screen.getByText("Origem e destino devem ser diferentes.")).toBeInTheDocument();
    expect(screen.getByLabelText("Nova transação: valor")).toHaveValue("100");
    expect(useVault.getState().vault.transactions).toEqual([]);
  });

  it("lists Categories under their Group", () => {
    show(base);
    const select = screen.getByLabelText("Nova transação: categoria");
    const group = select.querySelector('optgroup[label="Alimentação"]');
    expect(group).not.toBeNull();
    expect(within(group as HTMLElement).getByRole("option", { name: "Mercado" })).toBeInTheDocument();
  });

  it("shows each row's date the Brazilian way", () => {
    show({
      ...base,
      transactions: [expense("e1", "2026-10-02", 1000, "MERCADO", "cat-market")],
    });
    expect(listText()).toContain("02/10/2026");
  });
});

describe("marking a whole selection as Transfers", () => {
  const vault: Vault = {
    ...base,
    transactions: [
      expense("e1", "2026-10-02", 25001, "APLICACAO CDB 1", null),
      expense("e2", "2026-10-03", 25001, "APLICACAO CDB 2", null),
      {
        id: "i1",
        kind: "income",
        date: "2026-10-04",
        amount: centavos(10000),
        description: "RESGATE CDB",
        accountId: INTER,
        categoryId: null,
      },
    ],
  };

  const kindOf = (id: string) =>
    useVault.getState().vault.transactions.find((t) => t.id === id)?.kind;

  /** Ordinary spaces, since formatBRL puts a non-breaking one after "R$". */
  const plain = (text: string) => text.replace(/ /g, " ");

  async function selectBoth() {
    const user = userEvent.setup();
    await user.click(screen.getByLabelText("Selecionar APLICACAO CDB 1"));
    await user.click(screen.getByLabelText("Selecionar RESGATE CDB"));
    return user;
  }

  it("offers the action even when the selection mixes Incomes and Expenses", async () => {
    show(vault);
    await selectBoth();

    // No Category can apply to both kinds, but each entry's own kind gives its
    // Transfer a direction, so marking is still available.
    expect(screen.queryByLabelText("Categoria para as selecionadas")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Outra conta das transferências")).toBeInTheDocument();
  });

  it("says which balance moves, and by how much, before anything is converted", async () => {
    show(vault);
    const user = await selectBoth();

    await user.selectOptions(
      screen.getByLabelText("Outra conta das transferências"),
      "acc-savings",
    );

    const warning = screen.getByText(/Esses valores deixam de contar/);
    expect(plain(warning.textContent ?? "")).toContain("Poupança");
    expect(plain(warning.textContent ?? "")).toContain("aumenta R$ 250,01");
    expect(plain(warning.textContent ?? "")).toContain("diminui R$ 100,00");
    // Still nothing converted: the warning is read before the click, not after.
    expect(kindOf("e1")).toBe("expense");
    expect(kindOf("i1")).toBe("income");
  });

  it("converts the whole selection on one confirmation and says how many", async () => {
    show(vault);
    const user = await selectBoth();
    await user.selectOptions(
      screen.getByLabelText("Outra conta das transferências"),
      "acc-savings",
    );

    await user.click(screen.getByRole("button", { name: /Confirmar 2 transferências/ }));

    expect(kindOf("e1")).toBe("transfer");
    expect(kindOf("i1")).toBe("transfer");
    // The untouched row is still what it was.
    expect(kindOf("e2")).toBe("expense");
    expect(screen.getByRole("status").textContent).toContain(
      "2 lançamentos viraram transferências.",
    );
  });

  it("clears the selection once the batch has run", async () => {
    show(vault);
    const user = await selectBoth();
    await user.selectOptions(
      screen.getByLabelText("Outra conta das transferências"),
      "acc-savings",
    );

    await user.click(screen.getByRole("button", { name: /Confirmar/ }));

    expect(screen.queryByLabelText("Outra conta das transferências")).not.toBeInTheDocument();
  });

  it("previews only what will convert, leaving out entries already on the Account", async () => {
    show({
      ...vault,
      transactions: [
        ...vault.transactions,
        // Already on the chosen Account: the conversion will skip it, so the
        // promised balance change must not include its R$ 250,01.
        expense("e3", "2026-10-05", 25001, "JA NA POUPANCA", null, SAVINGS),
      ],
    });
    const user = userEvent.setup();
    await user.click(screen.getByLabelText("Selecionar APLICACAO CDB 1"));
    await user.click(screen.getByLabelText("Selecionar JA NA POUPANCA"));

    await user.selectOptions(
      screen.getByLabelText("Outra conta das transferências"),
      "acc-savings",
    );

    const warning = plain(screen.getByText(/Esses valores deixam de contar/).textContent ?? "");
    expect(warning).toContain("aumenta R$ 250,01");
    expect(warning).not.toContain("R$ 500,02");
    expect(warning).toContain("1 lançamento da seleção será ignorado");
    expect(
      screen.getByRole("button", { name: /Confirmar 1 transferência/ }),
    ).toBeInTheDocument();
  });

  it("names what it skipped instead of counting it as converted", async () => {
    show({
      ...vault,
      // This one is already on the Account the batch points at.
      transactions: [
        ...vault.transactions,
        expense("e3", "2026-10-05", 25001, "JA NA POUPANCA", null, SAVINGS),
      ],
    });
    const user = userEvent.setup();
    await user.click(screen.getByLabelText("Selecionar APLICACAO CDB 1"));
    await user.click(screen.getByLabelText("Selecionar JA NA POUPANCA"));

    await user.selectOptions(
      screen.getByLabelText("Outra conta das transferências"),
      "acc-savings",
    );
    await user.click(screen.getByRole("button", { name: /Confirmar/ }));

    const notice = screen.getByRole("status").textContent ?? "";
    expect(notice).toContain("1 lançamento virou transferência.");
    expect(notice).toContain("1 ignorado");
    expect(notice).toContain("Escolha uma conta diferente da do lançamento.");
    expect(kindOf("e3")).toBe("expense");
  });

  it("says a second Account is needed when the Vault has only one", async () => {
    show({
      ...vault,
      accounts: [base.accounts[0]],
      transactions: [vault.transactions[0]],
    });
    const user = userEvent.setup();
    await user.click(screen.getByLabelText("Selecionar APLICACAO CDB 1"));

    expect(screen.getByText(/Só existe uma conta no cofre/)).toBeInTheDocument();
  });
});

describe("being offered a Rule after classifying by hand", () => {
  const vault: Vault = {
    ...base,
    transactions: [
      expense("e1", "2026-10-02", 3000, "UBER TRIP 8213", null),
      expense("e2", "2026-10-03", 4000, "UBER TRIP 9120", null),
      expense("e3", "2026-10-04", 1000, "PADARIA DO ZE", null),
    ],
  };

  const rulesOf = () => useVault.getState().vault.rules;

  /** Select two rows and classify them, which is what prompts the offer. */
  async function classifyBothUbers(from: Vault = vault) {
    show(from);
    const user = userEvent.setup();
    await user.click(screen.getByLabelText("Selecionar UBER TRIP 8213"));
    await user.click(screen.getByLabelText("Selecionar UBER TRIP 9120"));
    await user.selectOptions(
      screen.getByLabelText("Categoria para as selecionadas"),
      "cat-market",
    );
    return user;
  }

  it("prefills the words the classified descriptions share", async () => {
    await classifyBothUbers();

    expect(screen.getByLabelText("Padrão da regra sugerida")).toHaveValue("uber trip");
  });

  it("creates the Rule, with whatever the user edited the pattern down to", async () => {
    const user = await classifyBothUbers();

    const input = screen.getByLabelText("Padrão da regra sugerida");
    await user.clear(input);
    await user.type(input, "uber");
    await user.click(screen.getByRole("button", { name: "Criar regra" }));

    expect(rulesOf()).toMatchObject([
      { pattern: "uber", categoryId: "cat-market", kind: "expense" },
    ]);
    expect(screen.getByRole("status").textContent).toContain("Regra criada");
  });

  it("creates nothing when the offer is declined", async () => {
    const user = await classifyBothUbers();

    await user.click(screen.getByRole("button", { name: "não, obrigado" }));

    expect(rulesOf()).toEqual([]);
    expect(screen.queryByLabelText("Padrão da regra sugerida")).not.toBeInTheDocument();
  });

  it("offers nothing when the descriptions have no words in common", async () => {
    show(vault);
    const user = userEvent.setup();
    await user.click(screen.getByLabelText("Selecionar UBER TRIP 8213"));
    await user.click(screen.getByLabelText("Selecionar PADARIA DO ZE"));

    await user.selectOptions(
      screen.getByLabelText("Categoria para as selecionadas"),
      "cat-market",
    );

    expect(screen.queryByLabelText("Padrão da regra sugerida")).not.toBeInTheDocument();
  });

  it("offers nothing when a Rule already says this", async () => {
    await classifyBothUbers({
      ...vault,
      rules: [
        { id: "r-1", pattern: "UBER TRIP", categoryId: "cat-market", kind: "expense" },
      ],
    });

    expect(screen.queryByLabelText("Padrão da regra sugerida")).not.toBeInTheDocument();
  });
});

describe("seeing which Rule classified a Transaction", () => {
  it("names the Rule on the row", () => {
    show({
      ...base,
      rules: [{ id: "r-1", pattern: "ifood", categoryId: "cat-market", kind: "expense" }],
      transactions: [
        {
          ...expense("e1", "2026-10-02", 5000, "IFOOD PEDIDO", "cat-market"),
          ruleId: "r-1",
        } as Transaction,
      ],
    });

    expect(listText()).toContain("regra “ifood”");
  });

  it("says so plainly when the Rule has since been deleted", () => {
    show({
      ...base,
      transactions: [
        {
          ...expense("e1", "2026-10-02", 5000, "IFOOD PEDIDO", "cat-market"),
          ruleId: "r-gone",
        } as Transaction,
      ],
    });

    expect(listText()).toContain("por uma regra já excluída");
  });

  it("says nothing about Rules for a Category the user chose", () => {
    show({
      ...base,
      transactions: [expense("e1", "2026-10-02", 5000, "IFOOD PEDIDO", "cat-market")],
    });

    expect(listText()).not.toContain("regra");
  });
});
