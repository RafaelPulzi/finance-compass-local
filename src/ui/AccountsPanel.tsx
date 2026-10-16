import { type FormEvent, useState } from "react";
import { deriveAccountBalance } from "../domain/balances";
import { formatBRL, parseBRL } from "../domain/money";
import type { AccountType } from "../domain/types";
import { useVault } from "../store/useVault";
import { ACCOUNT_TYPES, ACCOUNT_TYPE_LABELS } from "./labels";

export function AccountsPanel() {
  const accounts = useVault((s) => s.vault.accounts);
  const transactions = useVault((s) => s.vault.transactions);
  const addAccount = useVault((s) => s.addAccount);

  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType>("checking");
  const [opening, setOpening] = useState("0,00");
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (name.trim() === "") return setError("Dê um nome à conta.");
    try {
      addAccount({
        name: name.trim(),
        type,
        openingBalance: parseBRL(opening),
      });
      setName("");
      setOpening("0,00");
      setError(null);
    } catch {
      setError("Saldo inicial inválido.");
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
      <h2 className="mb-3 text-lg font-semibold text-slate-800 dark:text-slate-100">
        Contas
      </h2>

      <ul className="mb-4 divide-y divide-slate-100 dark:divide-slate-700">
        {accounts.length === 0 && (
          <li className="py-2 text-sm text-slate-500">Nenhuma conta ainda.</li>
        )}
        {accounts.map((account) => {
          const balance = deriveAccountBalance(account, transactions);
          return (
            <li key={account.id} className="flex items-center justify-between py-2">
              <div>
                <div className="font-medium text-slate-800 dark:text-slate-100">
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
            </li>
          );
        })}
      </ul>

      <form onSubmit={submit} className="space-y-2 border-t border-slate-100 pt-3 dark:border-slate-700">
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900"
            placeholder="Nome da conta"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <select
            className="rounded-md border border-slate-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900"
            value={type}
            onChange={(e) => setType(e.target.value as AccountType)}
          >
            {ACCOUNT_TYPES.map((t) => (
              <option key={t} value={t}>
                {ACCOUNT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-2">
          <input
            className="w-32 rounded-md border border-slate-300 px-2 py-1 text-right text-sm dark:border-slate-600 dark:bg-slate-900"
            placeholder="Saldo inicial"
            value={opening}
            onChange={(e) => setOpening(e.target.value)}
          />
          <button
            type="submit"
            className="rounded-md bg-emerald-600 px-3 py-1 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Adicionar conta
          </button>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </form>
    </section>
  );
}
