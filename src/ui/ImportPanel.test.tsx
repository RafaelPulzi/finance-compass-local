import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { centavos } from "../domain/money";
import type { Vault } from "../domain/types";
import { emptyVault } from "../domain/types";
import { useVault } from "../store/useVault";
import { ImportPanel } from "./ImportPanel";

const OFX = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
CHARSET:1252

<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BRL
<BANKACCTFROM><ACCTID>12345<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20261001<DTEND>20261031
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261005<TRNAMT>-49.90<FITID>A1<MEMO>PADARIA SÃO JOÃO</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261010<TRNAMT>5000.00<FITID>A2<MEMO>SALARIO</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261099<TRNAMT>-1.00<FITID>A3<MEMO>DATA INVALIDA</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

/** The Statement as a bank would hand it over: UTF-8 bytes under a 1252 header. */
const file = () => new File([new TextEncoder().encode(OFX)], "extrato.ofx", { type: "application/x-ofx" });

const oneAccount: Vault = {
  ...emptyVault(),
  accounts: [{ id: "inter", name: "Banco Inter", type: "checking", openingBalance: centavos(0) }],
};

function show(vault: Vault = oneAccount) {
  useVault.setState({ vault, status: "ready" });
  return render(<ImportPanel />);
}

function fileInput(): HTMLInputElement {
  const input = document.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error("no file input");
  return input;
}

beforeEach(() => {
  useVault.setState({ vault: emptyVault(), status: "ready" });
});

describe("ImportPanel", () => {
  it("asks for an Account first when there is none", () => {
    show(emptyVault());
    expect(screen.getByText("Crie uma conta antes de importar um extrato.")).toBeInTheDocument();
    expect(fileInput()).toBeDisabled();
  });

  it("does not ask which Account when there is only one", async () => {
    const user = userEvent.setup();
    show();
    await user.upload(fileInput(), file());

    expect(await screen.findByRole("button", { name: "Importar 2 lançamento(s)" })).toBeEnabled();
    expect(screen.queryByText("Escolha a conta de destino para continuar.")).not.toBeInTheDocument();
    // The unreadable entry is reported, not silently dropped.
    expect(screen.getByText(/1 lançamento\(s\) não puderam ser lidos/)).toBeInTheDocument();
    // Accents survive the lying charset header, and dates read the Brazilian way.
    expect(screen.getByText(/05\/10\/2026 · PADARIA SÃO JOÃO/)).toBeInTheDocument();
    expect(screen.getByText(/Período: 01\/10\/2026 a/)).toBeInTheDocument();
  });

  it("imports, records it in the history, and skips everything on a second import", async () => {
    const user = userEvent.setup();
    show();
    await user.upload(fileInput(), file());
    await user.click(await screen.findByRole("button", { name: "Importar 2 lançamento(s)" }));

    const vault = useVault.getState().vault;
    expect(vault.transactions).toHaveLength(2);
    expect(vault.transactions.every((t) => t.kind !== "transfer" && t.categoryId === null)).toBe(true);
    expect(vault.imports).toMatchObject([{ fileName: "extrato.ofx", added: 2, skipped: 0 }]);
    const history = screen.getByRole("list", { name: "Importações recentes" });
    expect(within(history).getByText(/extrato\.ofx → Banco Inter/)).toBeInTheDocument();

    await user.upload(fileInput(), file());
    expect(await screen.findByRole("button", { name: "Importar 0 lançamento(s)" })).toBeDisabled();
  });

  it("makes the user choose when there are several Accounts", async () => {
    const user = userEvent.setup();
    show({
      ...oneAccount,
      accounts: [
        ...oneAccount.accounts,
        { id: "cdb", name: "Inter CDB", type: "savings", openingBalance: centavos(0) },
      ],
    });
    await user.upload(fileInput(), file());
    expect(await screen.findByText("Escolha a conta de destino para continuar.")).toBeInTheDocument();
  });

  it("explains a file that is not OFX", async () => {
    const user = userEvent.setup();
    show();
    await user.upload(fileInput(), new File(["data,valor\n2026-10-01,10"], "planilha.ofx"));
    expect(await screen.findByText("Este arquivo não parece ser um OFX.")).toBeInTheDocument();
  });
});
