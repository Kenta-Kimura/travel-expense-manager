import { createInitialData } from './seed';
import type { AppData } from './types';

const STORAGE_KEY = 'travel-expense-manager:v1';

const isAppData = (value: unknown): value is AppData => {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<AppData>;
  return data.schemaVersion === 1 && Array.isArray(data.trips) && Array.isArray(data.expenses);
};

export const loadAppData = (): AppData => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return createInitialData();

    const parsed = JSON.parse(raw);
    if (!isAppData(parsed)) return createInitialData();

    return parsed;
  } catch {
    return createInitialData();
  }
};

export const saveAppData = (data: AppData) => {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
};

export const replaceAppData = (data: AppData) => {
  saveAppData(data);
};
