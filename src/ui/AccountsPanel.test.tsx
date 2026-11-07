import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { centavos } from "../domain/money";
import type { Vault } from "../domain/types";
import { emptyVault } from "../domain/types";
import { useVault } from "../store/useVault";
import { AccountsPanel } from "./AccountsPanel";

/** Intl puts a non-breaking space after "R$"; compare text with ordinary spaces. */
const plain = (text: string | null | undefined) => (text ?? "").replace(/ /g, " ");

const base: Vault = {
  ...emptyVault(),
  accounts: [
    { id: "inter", name: "Banco Inter", type: "checking", openingBalance: centavos(10000) },
    { id: "cash", name: "Carteira", type: "cash", openingBalance: centavos(0) },
  ],
  transactions: [
    {
      id: "e1",
      kind: "expense",
      date: "2026-10-02",
      amount: centavos(2500),
      description: "MERCADO",
      accountId: "inter",
      categoryId: null,
    },
  ],
};

function show(vault: Vault = base) {
  useVault.setState({ vault, status: "ready" });
  return render(<AccountsPanel />);
}

const s = () => useVault.getState().vault;

beforeEach(() => {
  useVault.setState({ vault: emptyVault(), status: "ready" });
});

describe("AccountsPanel", () => {
  it("shows each Account with its derived balance", () => {
    show();
    expect(plain(document.body.textContent)).toContain("Banco Inter");
    expect(plain(document.body.textContent)).toContain("R$ 75,00");
  });

  it("adds an Account, reading a dot-decimal opening balance the way it was meant", async () => {
    const user = userEvent.setup();
    show();
    await user.type(screen.getByLabelText("Nova conta: nome"), "Nubank");
    await user.selectOptions(screen.getByLabelText("Nova conta: tipo"), "credit-card");
    const opening = screen.getByLabelText("Nova conta: saldo inicial");
    await user.clear(opening);
    await user.type(opening, "-1500.50");
    await user.click(screen.getByRole("button", { name: "Adicionar conta" }));

    expect(s().accounts.find((a) => a.name === "Nubank")).toMatchObject({
      type: "credit-card",
      openingBalance: -150050,
    });
  });

  it("refuses a duplicate name and an unreadable balance", async () => {
    const user = userEvent.setup();
    show();
    await user.type(screen.getByLabelText("Nova conta: nome"), "carteira");
    await user.click(screen.getByRole("button", { name: "Adicionar conta" }));
    expect(screen.getByText(/Já existe uma conta/)).toBeInTheDocument();

    const opening = screen.getByLabelText("Nova conta: saldo inicial");
    await user.clear(opening);
    await user.type(opening, "1,234.56");
    await user.click(screen.getByRole("button", { name: "Adicionar conta" }));
    expect(screen.getByText(/Saldo inicial inválido/)).toBeInTheDocument();
    expect(s().accounts).toHaveLength(2);
  });

  it("corrects an opening balance, and the balance shown follows", async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByLabelText("Editar conta Banco Inter"));
    const opening = screen.getByLabelText("Editar Banco Inter: saldo inicial");
    expect(opening).toHaveValue("100,00");
    await user.clear(opening);
    await user.type(opening, "1.000,00");
    await user.click(screen.getByRole("button", { name: "Salvar" }));

    expect(s().accounts[0].openingBalance).toBe(100000);
    expect(plain(document.body.textContent)).toContain("R$ 975,00");
  });

  it("offers deletion only for an Account with no Transactions, and asks first", async () => {
    const user = userEvent.setup();
    show();
    expect(screen.queryByLabelText("Excluir conta Banco Inter")).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("Excluir conta Carteira"));
    expect(screen.getByText("Excluir a conta “Carteira”?")).toBeInTheDocument();
    expect(s().accounts).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Confirmar exclusão" }));
    expect(s().accounts.map((a) => a.name)).toEqual(["Banco Inter"]);
  });
});
