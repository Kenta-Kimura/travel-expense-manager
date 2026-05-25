import type { AppData, Expense, Trip } from './types';
import { toBaseAmount } from './calculations';

const escapeCsv = (value: string | number) => {
  const text = String(value);
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
};

export const downloadText = (filename: string, content: string, type: string) => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

export const exportJson = (data: AppData) => {
  downloadText('travel-expense-manager-backup.json', JSON.stringify(data, null, 2), 'application/json');
};

export const exportExpensesCsv = (trip: Trip, expenses: Expense[]) => {
  const categories = new Map(trip.categories.map((category) => [category.id, category.name]));
  const companions = new Map(trip.companions.map((companion) => [companion.id, companion.name]));
  const paymentMethods = new Map(trip.paymentMethods.map((method) => [method.id, method.name]));
  const rows = [
    [
      '旅行名',
      '日付',
      '時刻',
      '金額',
      '通貨',
      '為替レート',
      '基準通貨換算額',
      'カテゴリ',
      '支払者',
      '決済方法',
      '負担対象者',
      '店名・場所',
      'メモ',
    ],
    ...expenses.map((expense) => [
      trip.name,
      expense.date,
      expense.time ?? '',
      expense.amount,
      expense.currency,
      expense.exchangeRate,
      toBaseAmount(expense).toFixed(2),
      categories.get(expense.categoryId) ?? '',
      companions.get(expense.payerId) ?? '',
      paymentMethods.get(expense.paymentMethodId ?? '') ?? '',
      expense.participantIds.map((id) => companions.get(id) ?? '').join(' / '),
      expense.place,
      expense.memo,
    ]),
  ];

  downloadText(
    `travel-expenses-${trip.name}.csv`,
    rows.map((row) => row.map(escapeCsv).join(',')).join('\n'),
    'text/csv;charset=utf-8',
  );
};
