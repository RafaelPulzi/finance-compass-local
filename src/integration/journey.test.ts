import { beforeEach, describe, expect, it, vi } from "vitest";
import { deriveAccountBalance, deriveNetWorth } from "../domain/balances";
import { centavos } from "../domain/money";
import { decodeOfxBytes, parseOfx } from "../domain/ofx";
import { budgetStatusForMonth, monthlyTotals, spendingByCategoryForMonth } from "../domain/reporting";
import { planImport } from "../domain/statementImport";
import { selectTransactions, NO_FILTER } from "../domain/transactionQuery";
import type { Vault } from "../domain/types";

/**
 * One user's whole first month, end to end, through the real store and the
 * real domain — only the disk is faked, and it is faked as the real vault is:
 * one JSON *text* per entity, so anything that would not survive
 * JSON.stringify/parse fails here exactly as it would on the desktop.
 */

const disk = new Map<string, string>();
const ENTITIES = [
  "accounts",
  "groups",
  "categories",
  "rules",
  "transactions",
  "budgets",
  "imports",
  "dismissedTransferPairs",
] as const;

function repo() {
  return {
    label: "/cofre",
    dir: "/cofre",
    async load(): Promise<Vault | null> {
      if (!disk.has("meta")) return null;
      const meta = JSON.parse(disk.get("meta") as string) as { schemaVersion: 4 };
      const vault = { schemaVersion: meta.schemaVersion } as Vault;
      for (const key of ENTITIES) {
        (vault as unknown as Record<string, unknown>)[key] = JSON.parse(disk.get(key) ?? "[]");
      }
      return vault;
    },
    async save(vault: Vault) {
      for (const key of ENTITIES) {
        disk.set(key, JSON.stringify(vault[key]));
        await new Promise((r) => setTimeout(r, 0));
      }
      disk.set("meta", JSON.stringify({ schemaVersion: vault.schemaVersion }));
    },
  };
}

vi.mock("../persistence/repository", () => ({
  isTauri: () => true,
  pickRepository: async () => repo(),
  createVaultRepositoryAt: async () => repo(),
  inspectVaultFolder: async (dir: string) => ({ dir, hasVault: disk.has("meta") }),
}));

async function freshStore() {
  vi.resetModules();
  const mod = await import("../store/useVault");
  mod.resetVaultPersistence();
  return mod.useVault;
}

/**
 * A Banco Inter-style export: the header says 1252, the body is UTF-8, money
 * moves in and out of an investment pocket ("APLICACAO"/"RESGATE"), one entry is
 * repeated with the same FITID, and one is unreadable.
 */
const STATEMENT = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252

<OFX><SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><LANGUAGE>POR</SONRS></SIGNONMSGSRSV1>
<BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BRL
<BANKACCTFROM><BANKID>077<ACCTID>1234567<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20261001<DTEND>20261031
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261005[-3:BRT]<TRNAMT>5000.00<FITID>INT-001<MEMO>PIX RECEBIDO SALÁRIO EMPRESA</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261006[-3:BRT]<TRNAMT>-250.01<FITID>INT-002<MEMO>APLICACAO CDB</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261007[-3:BRT]<TRNAMT>-312.45<FITID>INT-003<MEMO>SUPERMERCADO SÃO JOSÉ</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261008[-3:BRT]<TRNAMT>-87.30<FITID>INT-004<MEMO>SUPERMERCADO SAO JOSE</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261009[-3:BRT]<TRNAMT>-39.90<FITID>INT-005<MEMO>STREAMING MENSAL</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261015[-3:BRT]<TRNAMT>100.00<FITID>INT-006<MEMO>RESGATE CDB</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261009[-3:BRT]<TRNAMT>-39.90<FITID>INT-005<MEMO>STREAMING MENSAL</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261032[-3:BRT]<TRNAMT>-1.00<FITID>INT-999<MEMO>DATA IMPOSSIVEL</STMTTRN>
</BANKTRANLIST><LEDGERBAL><BALAMT>4510.44<DTASOF>20261031</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

const bytes = () => new TextEncoder().encode(STATEMENT).buffer as ArrayBuffer;

beforeEach(() => {
  disk.clear();
});

describe("a first month with Finance Compass, end to end", () => {
  it("imports, classifies, recovers Transfers, budgets, and survives a restart", async () => {
    const useVault = await freshStore();
    const s = () => useVault.getState();
    await s().init();
    expect(s().status).toBe("ready");
    const idle = () => vi.waitFor(() => expect(disk.has("meta")).toBe(true));

    // --- Accounts --------------------------------------------------------
    const inter = s().addAccount({ name: "Banco Inter", type: "checking", openingBalance: centavos(10000) });
    const cdb = s().addAccount({ name: "Inter CDB", type: "savings", openingBalance: centavos(0) });
    if (!inter.ok || !cdb.ok) throw new Error("accounts refused");
    const INTER = inter.account.id;
    const CDB = cdb.account.id;

    // --- Import ------------------------------------------------------------
    const statement = parseOfx(decodeOfxBytes(bytes()));
    expect(statement.malformed).toBe(1);
    expect(statement.acctId).toBe("1234567");
    const plan = planImport(statement.entries, INTER, s().vault.transactions);
    expect(plan.additions).toHaveLength(6);
    expect(plan.duplicates).toHaveLength(1); // the FITID repeated inside the file
    s().commitImport({ plan, fileName: "extrato-out.ofx" });

    const descriptions = s().vault.transactions.map((t) => t.description);
    expect(descriptions).toContain("SUPERMERCADO SÃO JOSÉ"); // accents survived the lying header
    expect(s().vault.transactions.every((t) => t.kind !== "transfer" && t.categoryId === null)).toBe(true);

    // 100,00 + 5.000,00 + 100,00 − 250,01 − 312,45 − 87,30 − 39,90 = 4.510,34
    const balanceOf = (id: string) => {
      const account = s().vault.accounts.find((a) => a.id === id);
      if (!account) throw new Error("no account");
      return deriveAccountBalance(account, s().vault.transactions);
    };
    expect(balanceOf(INTER)).toBe(451034);

    // Re-importing the very same Statement adds nothing.
    expect(planImport(statement.entries, INTER, s().vault.transactions).additions).toEqual([]);

    // --- Classify in bulk ------------------------------------------------
    const market = s().vault.categories.find((c) => c.name === "Mercado");
    const streaming = s().vault.categories.find((c) => c.name === "Streaming");
    const salary = s().vault.categories.find((c) => c.name === "Salário");
    if (!market || !streaming || !salary) throw new Error("seed is missing a Category");

    // Accent- and case-insensitive search finds both spellings of the merchant.
    const found = selectTransactions(s().vault, { ...NO_FILTER, search: "supermercado sao jose" });
    expect(found.count).toBe(2);
    s().setTransactionCategoryMany(found.transactions.map((t) => t.id), market.id);
    const byDescription = (text: string) => {
      const tx = s().vault.transactions.find((t) => t.description.includes(text));
      if (!tx) throw new Error(`no ${text}`);
      return tx;
    };
    s().setTransactionCategory(byDescription("STREAMING").id, streaming.id);
    s().setTransactionCategory(byDescription("SALÁRIO").id, salary.id);
    // An Income can't be filed under an expense Category, whatever is asked.
    s().setTransactionCategory(byDescription("SALÁRIO").id, market.id);
    expect(byDescription("SALÁRIO")).toMatchObject({ categoryId: salary.id });

    // --- Before recovering Transfers: the investment move counts as spending.
    const [october] = monthlyTotals(s().vault, ["2026-10"]);
    expect(october.expense).toBe(25001 + 31245 + 8730 + 3990);
    expect(october.income).toBe(500000 + 10000);

    // --- Mark the investment moves as Transfers ---------------------------
    const aplicacao = byDescription("APLICACAO");
    const resgate = byDescription("RESGATE");
    expect(s().markTransactionAsTransfer(aplicacao.id, CDB).ok).toBe(true);
    expect(s().markTransactionAsTransfer(resgate.id, CDB).ok).toBe(true);

    const [recovered] = monthlyTotals(s().vault, ["2026-10"]);
    expect(recovered.expense).toBe(31245 + 8730 + 3990); // the 250,01 is no longer "spent"
    expect(recovered.income).toBe(500000); // nor the 100,00 "earned"
    // Inter's balance is untouched; the CDB now holds what moved there.
    expect(balanceOf(INTER)).toBe(451034);
    expect(balanceOf(CDB)).toBe(25001 - 10000);
    // Net worth grew by exactly what the CDB now holds.
    expect(deriveNetWorth(s().vault)).toBe(451034 + 15001);

    // The bank will send those entries again; they must stay converted.
    expect(planImport(statement.entries, INTER, s().vault.transactions).additions).toEqual([]);

    // --- A wrong marking is undone, fitid and all ---------------------------
    expect(s().revertTransferToEntry(resgate.id).ok).toBe(true);
    expect(byDescription("RESGATE")).toMatchObject({ kind: "income", fitid: "INT-006", categoryId: null });
    expect(planImport(statement.entries, INTER, s().vault.transactions).additions).toEqual([]);

    // --- Budgets -------------------------------------------------------------
    expect(s().setBudget({ categoryId: market.id, monthlyLimit: centavos(35000) }).ok).toBe(true);
    const [budget] = budgetStatusForMonth(s().vault, "2026-10");
    expect(budget).toMatchObject({ categoryName: "Mercado", spent: 39975, limit: 35000 });
    expect(budget.remaining).toBe(-4975);
    expect(spendingByCategoryForMonth(s().vault, "2026-10")[0]).toMatchObject({
      categoryName: "Mercado",
      spent: 39975,
    });

    // --- Corrections ---------------------------------------------------------
    // A typo in an opening balance is fixed, and only that Account moves.
    expect(
      s().editAccount(INTER, { name: "Banco Inter", type: "checking", openingBalance: centavos(20000) }).ok,
    ).toBe(true);
    expect(balanceOf(INTER)).toBe(461034);

    // Deleting an imported entry lets the next import bring it back — and only it.
    s().deleteTransaction(byDescription("STREAMING").id);
    const again = planImport(statement.entries, INTER, s().vault.transactions);
    expect(again.additions.map((e) => e.fitid)).toEqual(["INT-005"]);

    // --- Restart: everything above is what the files say -------------------
    await idle();
    // Every change above queued a whole-vault save, and they run one after
    // another (the save chain), so the fake disk needs a moment to catch up.
    await vi.waitFor(
      async () => {
        const onDisk = await repo().load();
        expect(onDisk).toEqual(s().vault);
      },
      { timeout: 10_000 },
    );
    expect(s().saveError).toBeNull();

    const reopened = await freshStore();
    await reopened.getState().init();
    expect(reopened.getState().vault).toEqual(s().vault);
    expect(reopened.getState().saveError).toBeNull();
  });
});
