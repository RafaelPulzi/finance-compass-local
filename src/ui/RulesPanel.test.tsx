import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { centavos } from "../domain/money";
import type { Rule, Transaction, Vault } from "../domain/types";
import { emptyVault } from "../domain/types";
import { useVault } from "../store/useVault";
import { RulesPanel } from "./RulesPanel";

const INTER = "acc-inter";

const base: Vault = {
  ...emptyVault(),
  accounts: [
    { id: INTER, name: "Banco Inter", type: "checking", openingBalance: centavos(0) },
  ],
  groups: [
    { id: "g-food", name: "Alimentação", kind: "expense" },
    { id: "g-in", name: "Renda", kind: "income" },
  ],
  categories: [
    { id: "cat-rest", name: "Restaurantes", groupId: "g-food" },
    { id: "cat-market", name: "Mercado", groupId: "g-food" },
    { id: "cat-salary", name: "Salário", groupId: "g-in" },
  ],
};

const rule = (overrides: Partial<Rule> = {}): Rule => ({
  id: "r-1",
  pattern: "ifood",
  categoryId: "cat-rest",
  kind: "expense",
  ...overrides,
});

const entry = (
  id: string,
  description: string,
  categoryId: string | null = null,
  ruleId?: string,
): Transaction => ({
  id,
  kind: "expense",
  date: "2026-10-02",
  amount: centavos(5000),
  description,
  accountId: INTER,
  categoryId,
  ...(ruleId === undefined ? {} : { ruleId }),
});

function show(vault: Vault) {
  useVault.setState({ vault, status: "ready" });
  return render(<RulesPanel />);
}

const rulesOf = () => useVault.getState().vault.rules;
const txById = (id: string) =>
  useVault.getState().vault.transactions.find((t) => t.id === id);

beforeEach(() => {
  useVault.setState({ vault: emptyVault(), status: "ready" });
});

describe("writing a Rule", () => {
  it("creates one from a pattern and a Category", async () => {
    show(base);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Padrão da nova regra"), "IFOOD");
    await user.selectOptions(screen.getByLabelText("Categoria da nova regra"), "cat-rest");
    await user.click(screen.getByRole("button", { name: "Criar regra" }));

    expect(rulesOf()).toMatchObject([
      { pattern: "IFOOD", categoryId: "cat-rest", kind: "expense" },
    ]);
  });

  it("takes the kind from the Category, so a Rule can target Income too", async () => {
    show(base);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Padrão da nova regra"), "SALARIO");
    await user.selectOptions(screen.getByLabelText("Categoria da nova regra"), "cat-salary");
    await user.click(screen.getByRole("button", { name: "Criar regra" }));

    expect(rulesOf()[0]).toMatchObject({ kind: "income" });
  });

  it("offers Categories of both kinds, under their own headings", () => {
    show(base);
    const select = screen.getByLabelText("Categoria da nova regra");

    expect(within(select).getByRole("option", { name: "Restaurantes" })).toBeInTheDocument();
    expect(within(select).getByRole("option", { name: "Salário" })).toBeInTheDocument();
  });

  it("reports a refusal and creates nothing", async () => {
    show(base);
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText("Categoria da nova regra"), "cat-rest");
    await user.click(screen.getByRole("button", { name: "Criar regra" }));

    expect(
      screen.getByText("Informe o texto que a descrição deve conter."),
    ).toBeInTheDocument();
    expect(rulesOf()).toEqual([]);
  });

  it("says there are none, and where one will come from", () => {
    show(base);

    expect(screen.getByText(/Nenhuma regra ainda/)).toBeInTheDocument();
  });
});

describe("the list of Rules", () => {
  const vault: Vault = {
    ...base,
    rules: [rule({ id: "r-a", pattern: "ifood" }), rule({ id: "r-b", pattern: "padaria" })],
    transactions: [
      entry("e1", "IFOOD 1", "cat-rest", "r-a"),
      entry("e2", "IFOOD 2", "cat-rest", "r-a"),
      entry("e3", "PADARIA", "cat-rest", "r-b"),
      // Classified by hand: it counts towards no Rule.
      entry("e4", "OUTRA", "cat-rest"),
    ],
  };

  it("numbers the Rules, because the order is the priority", () => {
    show(vault);
    const items = screen.getAllByRole("listitem");

    expect(items[0].textContent).toContain("1.");
    expect(items[0].textContent).toContain("ifood");
    expect(items[1].textContent).toContain("2.");
  });

  it("says how many Transactions each Rule accounts for", () => {
    show(vault);
    const items = screen.getAllByRole("listitem");

    expect(items[0].textContent).toContain("2 transações classificadas");
    expect(items[1].textContent).toContain("1 transação classificada");
  });

  it("moves a Rule up so a specific pattern can win over a general one", async () => {
    show(vault);
    const user = userEvent.setup();

    await user.click(screen.getByLabelText("Mover a regra padaria para cima"));

    expect(rulesOf().map((r) => r.id)).toEqual(["r-b", "r-a"]);
  });

  it("cannot move the first Rule up or the last one down", () => {
    show(vault);

    expect(screen.getByLabelText("Mover a regra ifood para cima")).toBeDisabled();
    expect(screen.getByLabelText("Mover a regra padaria para baixo")).toBeDisabled();
  });

  it("edits a pattern in place, keeping the Rule's position", async () => {
    show(vault);
    const user = userEvent.setup();

    await user.click(screen.getByLabelText("Editar a regra ifood"));
    const input = screen.getByLabelText("Padrão da regra");
    await user.clear(input);
    await user.type(input, "ifood com");
    await user.click(screen.getByRole("button", { name: "Salvar" }));

    expect(rulesOf()[0]).toMatchObject({ id: "r-a", pattern: "ifood com" });
  });

  it("asks before deleting, and says what happens to the classifications", async () => {
    show(vault);
    const user = userEvent.setup();

    await user.click(screen.getByLabelText("Excluir a regra ifood"));

    expect(screen.getByText(/2 transações que ela já classificou ficam como estão/))
      .toBeInTheDocument();
    expect(rulesOf()).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Confirmar exclusão" }));

    expect(rulesOf().map((r) => r.id)).toEqual(["r-b"]);
    // The classification it did survives the Rule.
    expect(txById("e1")).toMatchObject({ categoryId: "cat-rest", ruleId: "r-a" });
  });
});

describe("applying the Rules to the backlog", () => {
  const vault: Vault = {
    ...base,
    rules: [rule()],
    transactions: [
      entry("e1", "IFOOD PEDIDO 1"),
      entry("e2", "IFOOD PEDIDO 2"),
      entry("e3", "PADARIA DO ZE"),
    ],
  };

  it("says how many are uncategorized and how many the Rules would reach", () => {
    show(vault);

    expect(
      screen.getByText(
        /3 transações sem categoria no cofre, das quais as regras classificariam 2/,
      ),
    ).toBeInTheDocument();
  });

  it("asks for a confirmation with the count, and can be cancelled", async () => {
    show(vault);
    const user = userEvent.setup();

    await user.click(
      screen.getByRole("button", { name: "Aplicar as regras ao que está sem categoria" }),
    );
    expect(screen.getByText("Classificar 2 transações agora?")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(txById("e1")).toMatchObject({ categoryId: null });
  });

  it("classifies on confirmation and reports what it did", async () => {
    show(vault);
    const user = userEvent.setup();

    await user.click(
      screen.getByRole("button", { name: "Aplicar as regras ao que está sem categoria" }),
    );
    await user.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(txById("e1")).toMatchObject({ categoryId: "cat-rest", ruleId: "r-1" });
    expect(txById("e3")).toMatchObject({ categoryId: null });
    expect(screen.getByText("2 transações classificadas pelas regras.")).toBeInTheDocument();
  });

  it("offers nothing to apply when no Rule reaches anything", () => {
    show({ ...base, rules: [rule()], transactions: [entry("e3", "PADARIA DO ZE")] });

    expect(
      screen.getByRole("button", { name: "Aplicar as regras ao que está sem categoria" }),
    ).toBeDisabled();
  });
});
