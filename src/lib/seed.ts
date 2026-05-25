import type { AppData, Category, Companion, Trip } from './types';

export const initialCategories: Category[] = [
  { id: 'cat-food', name: '食費' },
  { id: 'cat-transport', name: '交通費' },
  { id: 'cat-hotel', name: '宿泊費' },
  { id: 'cat-sightseeing', name: '観光' },
  { id: 'cat-shopping', name: '買い物' },
  { id: 'cat-communication', name: '通信' },
  { id: 'cat-other', name: 'その他' },
];

export const initialCompanions: Companion[] = [{ id: 'person-me', name: '自分' }];

export const createId = (prefix: string) => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export const today = () => new Date().toISOString().slice(0, 10);

export const createTrip = (overrides: Partial<Trip> = {}): Trip => {
  const now = new Date().toISOString();
  const startDate = overrides.startDate ?? today();

  return {
    id: overrides.id ?? createId('trip'),
    name: overrides.name ?? '新しい旅行',
    startDate,
    endDate: overrides.endDate ?? startDate,
    baseCurrency: overrides.baseCurrency ?? 'JPY',
    defaultRates: overrides.defaultRates ?? [
      { currency: 'JPY', rateToBase: 1 },
      { currency: 'USD', rateToBase: 150 },
      { currency: 'EUR', rateToBase: 165 },
    ],
    categories: overrides.categories ?? initialCategories,
    companions: overrides.companions ?? initialCompanions,
    createdAt: overrides.createdAt ?? now,
    updatedAt: now,
  };
};

export const createInitialData = (): AppData => {
  const trip = createTrip({
    name: 'サンプル旅行',
    startDate: today(),
    endDate: today(),
  });

  return {
    schemaVersion: 1,
    trips: [trip],
    expenses: [],
    selectedTripId: trip.id,
  };
};
