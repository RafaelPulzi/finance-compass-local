import { useEffect } from "react";
import { deriveNetWorth } from "./domain/balances";
import { formatBRL } from "./domain/money";
import { useVault } from "./store/useVault";
import { AccountsPanel } from "./ui/AccountsPanel";
import { ImportPanel } from "./ui/ImportPanel";
import { TransactionsPanel } from "./ui/TransactionsPanel";

export default function App() {
  const status = useVault((s) => s.status);
  const error = useVault((s) => s.error);
  const repoLabel = useVault((s) => s.repoLabel);
  const vault = useVault((s) => s.vault);
  const init = useVault((s) => s.init);

  useEffect(() => {
    void init();
  }, [init]);

  if (status === "loading") {
    return <Centered>Carregando…</Centered>;
  }
  if (status === "error") {
    return <Centered>Erro ao abrir o cofre: {error}</Centered>;
  }

  const netWorth = deriveNetWorth(vault);

  return (
    <div className="min-h-full bg-slate-50 text-slate-900 dark:bg-slate-900 dark:text-slate-100">
      <header className="border-b border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
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
      </header>

      <main className="mx-auto grid max-w-4xl items-start gap-5 px-6 py-6 md:grid-cols-2">
        <div className="grid gap-5">
          <AccountsPanel />
          <ImportPanel />
        </div>
        <TransactionsPanel />
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
