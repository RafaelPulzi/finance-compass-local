import { localTodayISO } from "../domain/dates";
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

/**
 * Today on the user's own calendar. Not `toISOString()`, which is UTC: from
 * 21:00 in Brazil it already says tomorrow (see domain/dates).
 */
export function todayISO(): string {
  return localTodayISO();
}
