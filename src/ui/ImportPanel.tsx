import { type ChangeEvent, useMemo, useState } from "react";
import { formatDateBR } from "../domain/dates";
import { formatBRL } from "../domain/money";
import { centavos } from "../domain/money";
import { type ParsedStatement, decodeOfxBytes, parseOfx } from "../domain/ofx";
import { planImport } from "../domain/statementImport";
import { useVault } from "../store/useVault";

/** How many past Imports the history shows; the full record stays in imports.json. */
const HISTORY_SIZE = 5;

const importedAtFormat = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
});

export function ImportPanel() {
  const accounts = useVault((s) => s.vault.accounts);
  const transactions = useVault((s) => s.vault.transactions);
  const imports = useVault((s) => s.vault.imports);
  const commitImport = useVault((s) => s.commitImport);

  const [chosenAccountId, setAccountId] = useState("");
  // With a single Account there is only one possible answer, so it is not asked.
  const accountId =
    chosenAccountId !== "" ? chosenAccountId : accounts.length === 1 ? accounts[0].id : "";
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  const history = [...imports]
    .sort((a, b) => (a.importedAt < b.importedAt ? 1 : -1))
    .slice(0, HISTORY_SIZE);
  const [statement, setStatement] = useState<ParsedStatement | null>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ added: number; skipped: number } | null>(null);

  const plan = useMemo(() => {
    if (statement === null || accountId === "") return null;
    return planImport(statement.entries, accountId, transactions);
  }, [statement, accountId, transactions]);

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Let the same file be picked again after a cancel.
    event.target.value = "";
    if (!file) return;
    try {
      const parsed = parseOfx(decodeOfxBytes(await file.arrayBuffer()));
      setStatement(parsed);
      setFileName(file.name);
      setError(null);
      setResult(null);
    } catch (e) {
      setStatement(null);
      setError(e instanceof Error ? e.message : "Não foi possível ler o arquivo.");
    }
  }

  function confirm() {
    if (plan === null) return;
    commitImport({ plan, fileName });
    setResult({ added: plan.additions.length, skipped: plan.duplicates.length });
    setStatement(null);
    setFileName("");
  }

  function cancel() {
    setStatement(null);
    setFileName("");
    setError(null);
  }

  const inputClass =
    "rounded-md border border-slate-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900";

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
      <h2 className="mb-1 text-lg font-semibold text-slate-800 dark:text-slate-100">
        Importar extrato (OFX)
      </h2>
      <p className="mb-3 text-xs text-slate-500">
        Exporte o extrato OFX do seu banco e importe para uma conta. Lançamentos já
        importados são ignorados automaticamente.
      </p>

      <div className="flex flex-wrap gap-2">
        <select
          className={inputClass}
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
        >
          <option value="">Conta de destino</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>

        <label
          className={`cursor-pointer rounded-md px-3 py-1 text-sm font-medium ${
            accounts.length === 0
              ? "cursor-not-allowed bg-slate-200 text-slate-400 dark:bg-slate-700"
              : "bg-slate-700 text-white hover:bg-slate-800 dark:bg-slate-600 dark:hover:bg-slate-500"
          }`}
        >
          Escolher arquivo .ofx
          <input
            type="file"
            accept=".ofx,.OFX"
            className="hidden"
            disabled={accounts.length === 0}
            onChange={onFile}
          />
        </label>
      </div>

      {accounts.length === 0 && (
        <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
          Crie uma conta antes de importar um extrato.
        </p>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      {result && (
        <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
          Importado: {result.added} {result.added === 1 ? "lançamento" : "lançamentos"}
          {result.skipped > 0 && `, ${result.skipped} já existia(m)`}. As transações
          importadas ficam <strong>sem categoria</strong> até você classificá-las.
        </p>
      )}

      {statement && (
        <div className="mt-3 rounded-md border border-slate-200 p-3 text-sm dark:border-slate-700">
          <div className="mb-2 font-medium text-slate-800 dark:text-slate-100">
            {fileName}
          </div>
          <dl className="space-y-1 text-xs text-slate-600 dark:text-slate-300">
            {statement.acctId && (
              <div>
                Conta no arquivo: <span className="font-mono">{statement.acctId}</span>
              </div>
            )}
            {statement.periodStart && statement.periodEnd && (
              <div>
                Período: {formatDateBR(statement.periodStart)} a{" "}
                {formatDateBR(statement.periodEnd)}
              </div>
            )}
            <div>Lançamentos no arquivo: {statement.entries.length}</div>
          </dl>

          {statement.currency && statement.currency !== "BRL" && (
            <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
              Atenção: o extrato está em {statement.currency}. O Finance Compass
              trabalha apenas em BRL, os valores serão importados sem conversão.
            </p>
          )}
          {statement.malformed > 0 && (
            <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
              {statement.malformed} lançamento(s) não puderam ser lidos e serão ignorados.
            </p>
          )}

          {accountId === "" ? (
            <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
              Escolha a conta de destino para continuar.
            </p>
          ) : (
            plan && (
              <>
                <p className="mt-3 text-sm text-slate-800 dark:text-slate-100">
                  <strong>{plan.additions.length}</strong> novo(s) ·{" "}
                  <strong>{plan.duplicates.length}</strong> já importado(s)
                </p>

                {plan.additions.length > 0 && (
                  <ul className="mt-2 max-h-40 divide-y divide-slate-100 overflow-y-auto text-xs dark:divide-slate-700">
                    {plan.additions.slice(0, 20).map((entry) => (
                      <li key={entry.fitid} className="flex justify-between gap-2 py-1">
                        <span className="truncate text-slate-600 dark:text-slate-300">
                          {formatDateBR(entry.date)} · {entry.description || "(sem descrição)"}
                        </span>
                        <span
                          className={
                            entry.amount < 0
                              ? "shrink-0 font-mono text-red-600 dark:text-red-400"
                              : "shrink-0 font-mono text-emerald-600 dark:text-emerald-400"
                          }
                        >
                          {formatBRL(centavos(entry.amount))}
                        </span>
                      </li>
                    ))}
                    {plan.additions.length > 20 && (
                      <li className="py-1 text-slate-500">
                        …e mais {plan.additions.length - 20}.
                      </li>
                    )}
                  </ul>
                )}

                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={confirm}
                    disabled={plan.additions.length === 0}
                    className="rounded-md bg-emerald-600 px-3 py-1 text-sm font-medium text-white hover:bg-emerald-700 disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-slate-700"
                  >
                    Importar {plan.additions.length} lançamento(s)
                  </button>
                  <button
                    type="button"
                    onClick={cancel}
                    className="rounded-md border border-slate-300 px-3 py-1 text-sm dark:border-slate-600"
                  >
                    Cancelar
                  </button>
                </div>
              </>
            )
          )}
        </div>
      )}

      {history.length > 0 && (
        <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-700">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Importações recentes
          </h3>
          <ul aria-label="Importações recentes" className="space-y-1 text-xs">
            {history.map((record) => (
              <li key={record.id} className="flex flex-wrap justify-between gap-x-2 text-slate-600 dark:text-slate-300">
                <span className="min-w-0 truncate">
                  {importedAtFormat.format(new Date(record.importedAt))} · {record.fileName} →{" "}
                  {accountName.get(record.accountId) ?? "conta removida"}
                </span>
                <span className="shrink-0 tabular-nums text-slate-500">
                  +{record.added}
                  {record.skipped > 0 && ` · ${record.skipped} já existiam`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
