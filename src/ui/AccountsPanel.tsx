import { type FormEvent, useState } from "react";
import { type AccountInput, accountTransactionCount } from "../domain/accounts";
import { deriveAccountBalance } from "../domain/balances";
import { formatBRL, formatBRLInput, parseBRL } from "../domain/money";
import type { Account, AccountType } from "../domain/types";
import { type ActionResult, useVault } from "../store/useVault";
import { ACCOUNT_TYPES, ACCOUNT_TYPE_LABELS } from "./labels";

const inputClass =
  "rounded-md border border-slate-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900";
const linkClass = "text-xs text-slate-500 underline hover:text-slate-700 dark:hover:text-slate-300";

interface Draft {
  name: string;
  type: AccountType;
  opening: string;
}

/**
 * The name, type and opening balance fields, shared by "add" and "edit" so the
 * two can never disagree about what an Account is.
 */
function AccountFields({
  draft,
  onChange,
  labelPrefix,
}: {
  draft: Draft;
  onChange: (next: Draft) => void;
  labelPrefix: string;
}) {
  return (
    <>
      <div className="flex gap-2">
        <input
          aria-label={`${labelPrefix}: nome`}
          className={`${inputClass} min-w-0 flex-1`}
          placeholder="Nome da conta"
          value={draft.name}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
        />
        <select
          aria-label={`${labelPrefix}: tipo`}
          className={inputClass}
          value={draft.type}
          onChange={(e) => onChange({ ...draft, type: e.target.value as AccountType })}
        >
          {ACCOUNT_TYPES.map((t) => (
            <option key={t} value={t}>
              {ACCOUNT_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </div>
      <input
        aria-label={`${labelPrefix}: saldo inicial`}
        className={`${inputClass} w-32 text-right`}
        placeholder="Saldo inicial"
        inputMode="decimal"
        value={draft.opening}
        onChange={(e) => onChange({ ...draft, opening: e.target.value })}
      />
    </>
  );
}

/** Turn a draft into the domain's input, or the reason the amount can't be read. */
function readDraft(
  draft: Draft,
): { ok: true; input: AccountInput } | { ok: false; message: string } {
  try {
    return {
      ok: true,
      input: { name: draft.name, type: draft.type, openingBalance: parseBRL(draft.opening) },
    };
  } catch {
    return { ok: false, message: "Saldo inicial inválido. Use o formato 1.234,56." };
  }
}

export function AccountsPanel() {
  const vault = useVault((s) => s.vault);
  const addAccount = useVault((s) => s.addAccount);
  const editAccount = useVault((s) => s.editAccount);
  const deleteAccount = useVault((s) => s.deleteAccount);

  const [draft, setDraft] = useState<Draft>({ name: "", type: "checking", opening: "0,00" });
  const [error, setError] = useState<string | null>(null);

  /** At most one Account is being edited, and at most one awaits a delete confirmation. */
  const [editing, setEditing] = useState<{ id: string; draft: Draft } | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    const read = readDraft(draft);
    if (!read.ok) return setError(read.message);
    const result = addAccount(read.input);
    if (!result.ok) return setError(result.message);
    setDraft({ name: "", type: "checking", opening: "0,00" });
    setError(null);
  }

  function startEditing(account: Account) {
    setDeletingId(null);
    setRowError(null);
    setEditError(null);
    setEditing({
      id: account.id,
      draft: {
        name: account.name,
        type: account.type,
        opening: formatBRLInput(account.openingBalance),
      },
    });
  }

  function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (editing === null) return;
    const read = readDraft(editing.draft);
    if (!read.ok) return setEditError(read.message);
    const result: ActionResult = editAccount(editing.id, read.input);
    if (!result.ok) return setEditError(result.message);
    setEditing(null);
    setEditError(null);
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
      <h2 className="mb-3 text-lg font-semibold text-slate-800 dark:text-slate-100">Contas</h2>

      <ul className="mb-4 divide-y divide-slate-100 dark:divide-slate-700">
        {vault.accounts.length === 0 && (
          <li className="py-2 text-sm text-slate-500">Nenhuma conta ainda.</li>
        )}
        {vault.accounts.map((account) => {
          const balance = deriveAccountBalance(account, vault.transactions);

          if (editing?.id === account.id) {
            return (
              <li key={account.id} className="py-2">
                <form onSubmit={saveEdit} className="space-y-2">
                  <AccountFields
                    draft={editing.draft}
                    onChange={(next) => setEditing({ ...editing, draft: next })}
                    labelPrefix={`Editar ${account.name}`}
                  />
                  <p className="text-xs text-slate-500">
                    O saldo atual é sempre recalculado a partir do saldo inicial e das
                    transações; corrigir o saldo inicial não altera nenhuma transação.
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="submit"
                      className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                    >
                      Salvar
                    </button>
                    <button type="button" className={linkClass} onClick={() => setEditing(null)}>
                      Cancelar
                    </button>
                    {editError && <p className="text-xs text-red-600">{editError}</p>}
                  </div>
                </form>
              </li>
            );
          }

          return (
            <li key={account.id} className="py-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-medium text-slate-800 dark:text-slate-100">
                    {account.name}
                  </div>
                  <div className="text-xs text-slate-500">
                    {ACCOUNT_TYPE_LABELS[account.type]}
                  </div>
                </div>
                <span
                  className={
                    balance < 0
                      ? "font-mono font-semibold text-red-600 dark:text-red-400"
                      : "font-mono font-semibold text-slate-800 dark:text-slate-100"
                  }
                >
                  {formatBRL(balance)}
                </span>
              </div>

              {deletingId === account.id ? (
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-slate-700 dark:text-slate-200">
                    Excluir a conta “{account.name}”?
                  </span>
                  <button
                    type="button"
                    className="rounded-md bg-red-600 px-2 py-0.5 font-medium text-white hover:bg-red-700"
                    onClick={() => {
                      const result = deleteAccount(account.id);
                      setDeletingId(null);
                      setRowError(result.ok ? null : { id: account.id, message: result.message });
                    }}
                  >
                    Confirmar exclusão
                  </button>
                  <button type="button" className={linkClass} onClick={() => setDeletingId(null)}>
                    Cancelar
                  </button>
                </div>
              ) : (
                <div className="mt-1 flex gap-3">
                  <button
                    type="button"
                    className={linkClass}
                    aria-label={`Editar conta ${account.name}`}
                    onClick={() => startEditing(account)}
                  >
                    editar
                  </button>
                  {/* Offered only when it can succeed; the domain refuses it anyway. */}
                  {accountTransactionCount(vault, account.id) === 0 && (
                    <button
                      type="button"
                      className={linkClass}
                      aria-label={`Excluir conta ${account.name}`}
                      onClick={() => {
                        setEditing(null);
                        setRowError(null);
                        setDeletingId(account.id);
                      }}
                    >
                      excluir
                    </button>
                  )}
                </div>
              )}
              {rowError?.id === account.id && (
                <p className="mt-1 text-xs text-red-600">{rowError.message}</p>
              )}
            </li>
          );
        })}
      </ul>

      <form
        onSubmit={submit}
        className="space-y-2 border-t border-slate-100 pt-3 dark:border-slate-700"
      >
        <AccountFields draft={draft} onChange={setDraft} labelPrefix="Nova conta" />
        <div className="flex items-center gap-2">
          <button
            type="submit"
            className="rounded-md bg-emerald-600 px-3 py-1 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Adicionar conta
          </button>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      </form>
    </section>
  );
}
