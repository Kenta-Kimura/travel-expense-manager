import type { Expense, Settlement, SummaryRow, Trip, TripSummary } from './types';

export const toBaseAmount = (expense: Expense) => expense.amount * expense.exchangeRate;

const add = (map: Map<string, number>, key: string, value: number) => {
  map.set(key, (map.get(key) ?? 0) + value);
};

const rowsFromMap = (map: Map<string, number>, labelFor: (id: string) => string): SummaryRow[] =>
  Array.from(map.entries())
    .map(([id, amount]) => ({ id, label: labelFor(id), amount }))
    .sort((a, b) => b.amount - a.amount);

const getTripDays = (trip: Trip) => {
  const start = new Date(`${trip.startDate}T00:00:00`);
  const end = new Date(`${trip.endDate || trip.startDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 1;

  const diff = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
  return Math.max(1, diff);
};

export const summarizeTrip = (trip: Trip, expenses: Expense[]): TripSummary => {
  const categories = new Map(trip.categories.map((category) => [category.id, category.name]));
  const companions = new Map(trip.companions.map((companion) => [companion.id, companion.name]));
  const categoryTotals = new Map<string, number>();
  const currencyTotals = new Map<string, number>();
  const payerTotals = new Map<string, number>();
  const personPaid = new Map<string, number>();
  const personBurden = new Map<string, number>();

  let totalBase = 0;

  expenses.forEach((expense) => {
    const baseAmount = toBaseAmount(expense);
    totalBase += baseAmount;
    add(categoryTotals, expense.categoryId, baseAmount);
    add(currencyTotals, expense.currency, expense.amount);
    add(payerTotals, expense.payerId, baseAmount);
    add(personPaid, expense.payerId, baseAmount);

    const participantIds = expense.participantIds.length ? expense.participantIds : [expense.payerId];
    const share = baseAmount / participantIds.length;
    participantIds.forEach((personId) => add(personBurden, personId, share));
  });

  trip.companions.forEach((person) => {
    if (!personPaid.has(person.id)) personPaid.set(person.id, 0);
    if (!personBurden.has(person.id)) personBurden.set(person.id, 0);
  });

  const netBalanceMap = new Map<string, number>();
  trip.companions.forEach((person) => {
    netBalanceMap.set(person.id, (personPaid.get(person.id) ?? 0) - (personBurden.get(person.id) ?? 0));
  });

  return {
    totalBase,
    dailyAverageBase: totalBase / getTripDays(trip),
    categoryTotals: rowsFromMap(categoryTotals, (id) => categories.get(id) ?? '未分類'),
    currencyTotals: rowsFromMap(currencyTotals, (id) => id),
    payerTotals: rowsFromMap(payerTotals, (id) => companions.get(id) ?? '不明'),
    personPaid: rowsFromMap(personPaid, (id) => companions.get(id) ?? '不明'),
    personBurden: rowsFromMap(personBurden, (id) => companions.get(id) ?? '不明'),
    netBalances: rowsFromMap(netBalanceMap, (id) => companions.get(id) ?? '不明'),
    settlements: calculateSettlements(netBalanceMap),
  };
};

export const calculateSettlements = (balances: Map<string, number>): Settlement[] => {
  const debtors = Array.from(balances.entries())
    .filter(([, amount]) => amount < -0.01)
    .map(([id, amount]) => ({ id, amount: Math.abs(amount) }))
    .sort((a, b) => b.amount - a.amount);

  const creditors = Array.from(balances.entries())
    .filter(([, amount]) => amount > 0.01)
    .map(([id, amount]) => ({ id, amount }))
    .sort((a, b) => b.amount - a.amount);

  const settlements: Settlement[] = [];
  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const amount = Math.min(debtor.amount, creditor.amount);

    if (amount > 0.01) {
      settlements.push({ fromId: debtor.id, toId: creditor.id, amount });
    }

    debtor.amount -= amount;
    creditor.amount -= amount;

    if (debtor.amount <= 0.01) debtorIndex += 1;
    if (creditor.amount <= 0.01) creditorIndex += 1;
  }

  return settlements;
};
