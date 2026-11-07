import type { VaultChange } from "./categories";
import type { Centavos } from "./money";
import { normalizeForSearch } from "./text";
import type { Account, AccountType, Id, Transaction, Vault } from "./types";

/**
 * Creating, correcting and removing Accounts.
 *
 * Pure, like the Category functions: each returns the Vault it would leave
 * behind or the reason it refuses, and the store writes only on `ok`.
 *
 * An Account's balance is never stored (CONTEXT.md), so correcting its opening
 * balance needs no bookkeeping — every derived balance simply follows.
 */

const ACCOUNT_TYPES: readonly AccountType[] = ["checking", "savings", "cash", "credit-card"];

export interface AccountInput {
  name: string;
  type: AccountType;
  openingBalance: Centavos;
}

function cleanName(name: string): string | null {
  const cleaned = name.trim().replace(/\s+/g, " ");
  return cleaned === "" ? null : cleaned;
}

/** Two Accounts both called "Inter" make every select and every Transfer ambiguous. */
function nameTaken(vault: Vault, name: string, except?: Id): boolean {
  const wanted = normalizeForSearch(name);
  return vault.accounts.some((a) => a.id !== except && normalizeForSearch(a.name) === wanted);
}

function check(
  vault: Vault,
  input: AccountInput,
  except?: Id,
): { ok: true; name: string } | { ok: false; message: string } {
  const name = cleanName(input.name);
  if (name === null) return { ok: false, message: "Dê um nome à conta." };
  if (nameTaken(vault, name, except)) {
    return { ok: false, message: `Já existe uma conta chamada “${name}”.` };
  }
  if (!ACCOUNT_TYPES.includes(input.type)) {
    return { ok: false, message: "Tipo de conta inválido." };
  }
  if (!Number.isInteger(input.openingBalance)) {
    return { ok: false, message: "Saldo inicial inválido." };
  }
  return { ok: true, name };
}

export function addAccount(
  vault: Vault,
  input: AccountInput,
  makeId: () => Id,
): { ok: true; vault: Vault; account: Account } | { ok: false; message: string } {
  const checked = check(vault, input);
  if (!checked.ok) return checked;
  const account: Account = {
    id: makeId(),
    name: checked.name,
    type: input.type,
    openingBalance: input.openingBalance,
  };
  return { ok: true, account, vault: { ...vault, accounts: [...vault.accounts, account] } };
}

/** Rename, retype or correct the opening balance of an Account. The id never changes. */
export function editAccount(vault: Vault, accountId: Id, input: AccountInput): VaultChange {
  if (!vault.accounts.some((a) => a.id === accountId)) {
    return { ok: false, message: "Conta inexistente." };
  }
  const checked = check(vault, input, accountId);
  if (!checked.ok) return checked;
  return {
    ok: true,
    vault: {
      ...vault,
      accounts: vault.accounts.map((a) =>
        a.id === accountId
          ? { ...a, name: checked.name, type: input.type, openingBalance: input.openingBalance }
          : a,
      ),
    },
  };
}

function touches(tx: Transaction, accountId: Id): boolean {
  return tx.kind === "transfer"
    ? tx.fromAccountId === accountId || tx.toAccountId === accountId
    : tx.accountId === accountId;
}

/** How many Transactions involve an Account, either as its only Account or as one side of a Transfer. */
export function accountTransactionCount(vault: Vault, accountId: Id): number {
  return vault.transactions.filter((tx) => touches(tx, accountId)).length;
}

/**
 * Remove an Account nothing uses.
 *
 * Refused while any Transaction touches it: deleting those too would erase
 * history, and keeping them would leave money in an Account that no longer
 * exists. The Import records made into it go with it — they only describe
 * what happened to an Account that is gone, and hold no money of their own.
 */
export function deleteAccount(vault: Vault, accountId: Id): VaultChange {
  if (!vault.accounts.some((a) => a.id === accountId)) {
    return { ok: false, message: "Conta inexistente." };
  }
  const count = accountTransactionCount(vault, accountId);
  if (count > 0) {
    return {
      ok: false,
      message: `Não é possível excluir: a conta tem ${count} ${count === 1 ? "transação" : "transações"}.`,
    };
  }
  return {
    ok: true,
    vault: {
      ...vault,
      accounts: vault.accounts.filter((a) => a.id !== accountId),
      imports: vault.imports.filter((i) => i.accountId !== accountId),
    },
  };
}
