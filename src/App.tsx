import { useEffect, useState } from "react";
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
import { type MonthKey, recentMonths } from "./domain/reporting";
import { useVault } from "./store/useVault";
import { AccountsPanel } from "./ui/AccountsPanel";
import { BudgetsPanel } from "./ui/BudgetsPanel";
import { DashboardPage } from "./ui/DashboardPage";
import { ImportPanel } from "./ui/ImportPanel";
import { TransactionsPanel } from "./ui/TransactionsPanel";
import { monthLongLabel } from "./ui/charts/format";
import { todayISO } from "./ui/labels";

const NAV = [
  { to: "/", label: "Painel" },
  { to: "/transacoes", label: "Transações" },
  { to: "/contas", label: "Contas" },
  { to: "/orcamentos", label: "Orçamentos" },
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
  const location = useLocation();

  const [month, setMonth] = useState<MonthKey>(() => todayISO().slice(0, 7));

  useEffect(() => {
    void init();
  }, [init]);

  if (status === "loading") return <Centered>Carregando…</Centered>;
  if (status === "error") return <Centered>Erro ao abrir o cofre: {error}</Centered>;

  const netWorth = deriveNetWorth(vault);
  const monthOptions = [...recentMonths(todayISO().slice(0, 7), 12)].reverse();
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
          <Route path="/orcamentos" element={<BudgetsPanel month={month} />} />
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
