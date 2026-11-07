/**
 * Overdraft warning for a payment from a bank account.
 *
 * A bank payment may take an account below zero (overdrafts exist), so this
 * only warns, using the bank account's book balance from the bank accounts API.
 */
import type { BankAccount } from "./types";
import { fmtLKR } from "@/components/tijaero";

export function bankOverdraftWarning(
  bank: Pick<BankAccount, "name" | "book_balance"> | null | undefined,
  amount: number,
  currencySymbol: string
): string | null {
  if (!bank || !(amount > 0)) return null;
  const balance = Number(bank.book_balance);
  if (!Number.isFinite(balance)) return null;
  const after = Math.round((balance - amount) * 100) / 100;
  if (after >= 0) return null;
  return `This will take ${bank.name} below zero (${currencySymbol} -${fmtLKR(Math.abs(after))}).`;
}
