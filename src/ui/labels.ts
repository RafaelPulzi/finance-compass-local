import type { AccountType } from "../domain/types";

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  checking: "Conta corrente",
  savings: "Poupança",
  cash: "Dinheiro",
  "credit-card": "Cartão de crédito",
};

export const ACCOUNT_TYPES: AccountType[] = [
  "checking",
  "savings",
  "cash",
  "credit-card",
];

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
