import { useEffect, useMemo, useState } from "react";
import {
  HashRouter,
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { deriveNetWorth } from "./domain/balances";
import { formatBRL } from "./domain/money";
import { type MonthKey, monthChoices } from "./domain/reporting";
import { useVault } from "./store/useVault";
import { AccountsPanel } from "./ui/AccountsPanel";
import { BudgetsPanel } from "./ui/BudgetsPanel";
import { CategoriesPanel } from "./ui/CategoriesPanel";
import { DashboardPage } from "./ui/DashboardPage";
import { ImportPanel } from "./ui/ImportPanel";
import { RulesPanel } from "./ui/RulesPanel";
import { TransactionsPanel } from "./ui/TransactionsPanel";
import { VaultPanel } from "./ui/VaultPanel";
import { monthLongLabel } from "./ui/charts/format";
import { todayISO } from "./ui/labels";

const NAV = [
  { to: "/", label: "Painel" },
  { to: "/transacoes", label: "Transações" },
  { to: "/contas", label: "Contas" },
  { to: "/categorias", label: "Categorias" },
  { to: "/regras", label: "Regras" },
  { to: "/orcamentos", label: "Orçamentos" },
  { to: "/cofre", label: "Cofre" },
];

/** Routes whose contents are scoped by the selected month. */
const MONTH_SCOPED = new Set(["/", "/orcamentos"]);

export default function App() {
  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  );
}

function Shell() {
  const status = useVault((s) => s.status);
  const error = useVault((s) => s.error);
  const repoLabel = useVault((s) => s.repoLabel);
  const vault = useVault((s) => s.vault);
  const init = useVault((s) => s.init);
  const saveError = useVault((s) => s.saveError);
  const retrySave = useVault((s) => s.retrySave);
  const location = useLocation();

  const [month, setMonth] = useState<MonthKey>(() => todayISO().slice(0, 7));
  const monthOptions = useMemo(
    () => monthChoices(vault, todayISO().slice(0, 7)),
    [vault],
  );

  useEffect(() => {
    void init();
  }, [init]);

  if (status === "loading") return <Centered>Carregando…</Centered>;
  // A vault folder can be unreachable (external drive, moved folder), so the
  // error screen has to carry the folder picker — it's the only way out.
  if (status === "error") {
    return (
      <Centered>
        <div className="w-full max-w-xl space-y-4 p-6">
          <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            <strong>Não foi possível abrir o cofre.</strong>
            <p className="mt-1">{error}</p>
          </div>
          <VaultPanel />
        </div>
      </Centered>
    );
  }

  const netWorth = deriveNetWorth(vault);
  const showMonthFilter = MONTH_SCOPED.has(location.pathname);

  return (
    <div className="min-h-full bg-slate-50 text-slate-900 dark:bg-slate-900 dark:text-slate-100">
      <header className="border-b border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <div>
            <h1 className="text-xl font-bold">Finance Compass</h1>
            <p className="text-xs text-slate-500">{repoLabel}</p>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wide text-slate-500">
              Patrimônio
            </div>
            <div
              className={
                netWorth < 0
                  ? "font-mono text-2xl font-bold text-red-600 dark:text-red-400"
                  : "font-mono text-2xl font-bold text-emerald-600 dark:text-emerald-400"
              }
            >
              {formatBRL(netWorth)}
            </div>
          </div>
        </div>

        <nav className="mx-auto flex max-w-5xl gap-1 px-6">
          {NAV.map((item) => {
            const active = location.pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                aria-current={active ? "page" : undefined}
                className={`-mb-px border-b-2 px-3 py-2 text-sm ${
                  active
                    ? "border-emerald-600 font-medium text-slate-900 dark:text-slate-100"
                    : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-6">
        {/* Shown until a later save succeeds: what is on screen is not on disk. */}
        {saveError !== null && (
          <div
            role="alert"
            className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
          >
            <div className="min-w-0 flex-1">
              <strong>As últimas alterações não foram salvas no disco.</strong>
              <p className="mt-0.5 break-words text-xs">{saveError}</p>
            </div>
            <button
              type="button"
              onClick={() => void retrySave()}
              className="rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700"
            >
              Tentar salvar de novo
            </button>
          </div>
        )}

        {/* One filter row above everything it scopes — never a filter per chart. */}
        {showMonthFilter && (
          <div className="mb-5 flex items-center gap-2">
            <label htmlFor="month" className="text-xs text-slate-500">
              Mês
            </label>
            <select
              id="month"
              className="rounded-md border border-slate-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            >
              {monthOptions.map((m) => (
                <option key={m} value={m}>
                  {monthLongLabel(m)}
                </option>
              ))}
            </select>
          </div>
        )}

        <Routes>
          <Route path="/" element={<DashboardPage month={month} />} />
          <Route path="/transacoes" element={<TransactionsPanel />} />
          <Route
            path="/contas"
            element={
              <div className="grid items-start gap-5 md:grid-cols-2">
                <AccountsPanel />
                <ImportPanel />
              </div>
            }
          />
          <Route path="/categorias" element={<CategoriesPanel />} />
          <Route path="/regras" element={<RulesPanel />} />
          <Route path="/orcamentos" element={<BudgetsPanel month={month} />} />
          <Route
            path="/cofre"
            element={
              <div className="max-w-xl">
                <VaultPanel />
              </div>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center bg-slate-50 text-slate-600 dark:bg-slate-900 dark:text-slate-300">
      {children}
    </div>
  );
}
