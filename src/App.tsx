import type { ChangeEvent, FormEvent, ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { exportExpensesCsv, exportJson } from './lib/backup';
import { summarizeTrip, toBaseAmount } from './lib/calculations';
import { createId, createTrip, initialPaymentMethods, today } from './lib/seed';
import { loadAppData, replaceAppData, saveAppData } from './lib/storage';
import type { AppData, Category, Companion, CurrencyCode, Expense, ExchangeRate, PaymentMethod, Trip } from './lib/types';

type ExpenseDraft = Omit<Expense, 'id' | 'tripId' | 'createdAt' | 'updatedAt'>;
const BASE_CURRENCY: CurrencyCode = 'JPY';
type SortKey =
  | 'date'
  | 'amount'
  | 'currency'
  | 'exchangeRate'
  | 'baseAmount'
  | 'category'
  | 'payer'
  | 'paymentMethod'
  | 'place'
  | 'memo';
type SortDirection = 'asc' | 'desc';
type ExpenseFilters = {
  search: string;
  categoryId: string;
  currency: string;
  payerId: string;
  paymentMethodId: string;
};
type BulkEditDraft = {
  date: string;
  time: string;
  currency: string;
  exchangeRate: number;
  categoryId: string;
  payerId: string;
  paymentMethodId: string;
  participantIds: string[];
  place: string;
  memo: string;
};
type BulkEditApply = Record<keyof BulkEditDraft, boolean>;

const emptyExpenseDraft = (trip: Trip): ExpenseDraft => {
  const currency = trip.defaultRates[0]?.currency ?? BASE_CURRENCY;
  const rate = trip.defaultRates.find((item) => item.currency === currency)?.rateToBase ?? 1;
  const payerId = trip.companions[0]?.id ?? 'person-me';

  return {
    date: today(),
    time: '',
    amount: 0,
    currency,
    exchangeRate: rate,
    categoryId: trip.categories[0]?.id ?? 'cat-other',
    payerId,
    paymentMethodId: '',
    participantIds: trip.companions.map((person) => person.id),
    memo: '',
    place: '',
  };
};

const formatMoney = (amount: number, currency: CurrencyCode) =>
  new Intl.NumberFormat('ja-JP', {
    style: 'currency',
    currency,
    maximumFractionDigits: currency === 'JPY' ? 0 : 2,
  }).format(amount || 0);

const formatNumber = (amount: number) =>
  new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 2 }).format(amount || 0);

const readJsonFile = (file: File): Promise<AppData> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(JSON.parse(String(reader.result)) as AppData);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });

const normalizeAppData = (data: AppData): AppData => ({
  ...data,
  paymentMethods: data.paymentMethods ?? initialPaymentMethods,
  trips: data.trips.map((trip) => ({ ...trip, baseCurrency: BASE_CURRENCY, paymentMethods: trip.paymentMethods ?? [] })),
  expenses: data.expenses.map((expense) => ({ ...expense, time: expense.time ?? '', paymentMethodId: expense.paymentMethodId ?? '' })),
});

const createBulkEditDraft = (trip: Trip): BulkEditDraft => {
  const base = emptyExpenseDraft(trip);
  return {
    date: base.date,
    time: base.time ?? '',
    currency: base.currency,
    exchangeRate: base.exchangeRate,
    categoryId: base.categoryId,
    payerId: base.payerId,
    paymentMethodId: base.paymentMethodId ?? '',
    participantIds: base.participantIds,
    place: '',
    memo: '',
  };
};

const createBulkEditApply = (): BulkEditApply => ({
  date: false,
  time: false,
  currency: false,
  exchangeRate: false,
  categoryId: false,
  payerId: false,
  paymentMethodId: false,
  participantIds: false,
  place: false,
  memo: false,
});

const getExpenseDateTime = (expense: Expense) => `${expense.date}T${expense.time || '00:00'}`;

const compareValues = (a: string | number, b: string | number) => {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'ja');
};

const Field = ({
  label,
  children,
  wide = false,
  required = false,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
  required?: boolean;
}) => (
  <label className={wide ? 'field field-wide' : 'field'}>
    <span>
      {label}
      {required && <b className="required-mark">*</b>}
    </span>
    {children}
  </label>
);

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="section">
    <h2>{title}</h2>
    {children}
  </section>
);

function App() {
  const [data, setData] = useState<AppData>(() => normalizeAppData(loadAppData()));
  const [expenseDraft, setExpenseDraft] = useState<ExpenseDraft | null>(null);
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [activeSettings, setActiveSettings] = useState<'trip' | 'app' | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [status, setStatus] = useState('');
  const [filters, setFilters] = useState<ExpenseFilters>({ search: '', categoryId: '', currency: '', payerId: '', paymentMethodId: '' });
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [selectedExpenseIds, setSelectedExpenseIds] = useState<string[]>([]);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkDraft, setBulkDraft] = useState<BulkEditDraft | null>(null);
  const [bulkApply, setBulkApply] = useState<BulkEditApply>(() => createBulkEditApply());

  const selectedTrip = data.trips.find((trip) => trip.id === data.selectedTripId) ?? data.trips[0] ?? null;
  const tripExpenses = useMemo(
    () => (selectedTrip ? data.expenses.filter((expense) => expense.tripId === selectedTrip.id) : []),
    [data.expenses, selectedTrip],
  );
  const summary = useMemo(
    () => (selectedTrip ? summarizeTrip(selectedTrip, tripExpenses) : null),
    [selectedTrip, tripExpenses],
  );

  useEffect(() => {
    saveAppData(data);
  }, [data]);

  useEffect(() => {
    if (!status) return;
    const timer = window.setTimeout(() => setStatus(''), 3000);
    return () => window.clearTimeout(timer);
  }, [status]);

  useEffect(() => {
    if (selectedTrip && !expenseDraft) setExpenseDraft(emptyExpenseDraft(selectedTrip));
  }, [expenseDraft, selectedTrip]);

  useEffect(() => {
    setSelectedExpenseIds((current) => current.filter((id) => tripExpenses.some((expense) => expense.id === id)));
  }, [tripExpenses]);

  const updateData = (updater: (current: AppData) => AppData) => {
    setData((current) => updater(current));
  };

  const updateTrip = (patch: Partial<Trip>) => {
    if (!selectedTrip) return;
    updateData((current) => ({
      ...current,
      trips: current.trips.map((trip) =>
        trip.id === selectedTrip.id ? { ...trip, ...patch, updatedAt: new Date().toISOString() } : trip,
      ),
    }));
  };

  const addTrip = () => {
    const trip = createTrip({
      baseCurrency: BASE_CURRENCY,
      categories: selectedTrip?.categories,
    });
    updateData((current) => ({
      ...current,
      trips: [...current.trips, trip],
      selectedTripId: trip.id,
    }));
    setExpenseDraft(emptyExpenseDraft(trip));
    setEditingExpenseId(null);
    setActiveSettings('trip');
  };

  const deleteTrip = () => {
    if (!selectedTrip || !confirm(`「${selectedTrip.name}」を削除しますか？関連する支出も削除されます。`)) return;
    setActiveSettings(null);
    updateData((current) => {
      const trips = current.trips.filter((trip) => trip.id !== selectedTrip.id);
      return {
        ...current,
        trips,
        expenses: current.expenses.filter((expense) => expense.tripId !== selectedTrip.id),
        selectedTripId: trips[0]?.id ?? null,
      };
    });
  };

  const upsertCategory = (category: Category) => {
    if (!selectedTrip) return;
    const exists = selectedTrip.categories.some((item) => item.id === category.id);
    updateData((current) => ({
      ...current,
      trips: current.trips.map((trip) => ({
        ...trip,
        categories: exists
          ? trip.categories.map((item) => (item.id === category.id ? category : item))
          : [...trip.categories, category],
        updatedAt: new Date().toISOString(),
      })),
    }));
  };

  const removeCategory = (id: string) => {
    if (!selectedTrip) return;
    const fallbackCategoryId = selectedTrip.categories.find((category) => category.id !== id)?.id ?? 'cat-other';
    updateData((current) => ({
      ...current,
      trips: current.trips.map((trip) => ({
        ...trip,
        categories: trip.categories.filter((category) => category.id !== id),
        updatedAt: new Date().toISOString(),
      })),
      expenses: current.expenses.map((expense) =>
        expense.categoryId === id ? { ...expense, categoryId: fallbackCategoryId, updatedAt: new Date().toISOString() } : expense,
      ),
    }));
  };

  const upsertCompanion = (person: Companion) => {
    if (!selectedTrip) return;
    const exists = selectedTrip.companions.some((item) => item.id === person.id);
    updateTrip({
      companions: exists
        ? selectedTrip.companions.map((item) => (item.id === person.id ? person : item))
        : [...selectedTrip.companions, person],
    });
  };

  const removeCompanion = (id: string) => {
    if (!selectedTrip || selectedTrip.companions.length <= 1) return;
    updateTrip({ companions: selectedTrip.companions.filter((person) => person.id !== id) });
  };

  const upsertCommonPaymentMethod = (method: PaymentMethod) => {
    const exists = data.paymentMethods.some((item) => item.id === method.id);
    updateData((current) => ({
      ...current,
      paymentMethods: exists
        ? current.paymentMethods.map((item) => (item.id === method.id ? method : item))
        : [...current.paymentMethods, method],
    }));
  };

  const removeCommonPaymentMethod = (id: string) => {
    updateData((current) => ({
      ...current,
      paymentMethods: current.paymentMethods.filter((method) => method.id !== id),
      expenses: current.expenses.map((expense) =>
        expense.paymentMethodId === id ? { ...expense, paymentMethodId: '', updatedAt: new Date().toISOString() } : expense,
      ),
    }));
  };

  const upsertTripPaymentMethod = (method: PaymentMethod) => {
    if (!selectedTrip) return;
    const exists = selectedTrip.paymentMethods.some((item) => item.id === method.id);
    updateTrip({
      paymentMethods: exists
        ? selectedTrip.paymentMethods.map((item) => (item.id === method.id ? method : item))
        : [...selectedTrip.paymentMethods, method],
    });
  };

  const removeTripPaymentMethod = (id: string) => {
    if (!selectedTrip) return;
    updateTrip({ paymentMethods: selectedTrip.paymentMethods.filter((method) => method.id !== id) });
    updateData((current) => ({
      ...current,
      expenses: current.expenses.map((expense) =>
        expense.paymentMethodId === id ? { ...expense, paymentMethodId: '', updatedAt: new Date().toISOString() } : expense,
      ),
    }));
  };

  const upsertRate = (rate: ExchangeRate) => {
    if (!selectedTrip) return;
    const exists = selectedTrip.defaultRates.some((item) => item.currency === rate.currency);
    updateTrip({
      defaultRates: exists
        ? selectedTrip.defaultRates.map((item) => (item.currency === rate.currency ? rate : item))
        : [...selectedTrip.defaultRates, rate],
    });
  };

  const removeRate = (currency: string) => {
    if (!selectedTrip) return;
    updateTrip({ defaultRates: selectedTrip.defaultRates.filter((rate) => rate.currency !== currency) });
  };

  const setDraft = (patch: Partial<ExpenseDraft>) => {
    setExpenseDraft((current) => (current ? { ...current, ...patch } : current));
  };

  const changeDraftCurrency = (currency: string) => {
    if (!selectedTrip) return;
    const exchangeRate = selectedTrip.defaultRates.find((rate) => rate.currency === currency)?.rateToBase ?? 1;
    setDraft({ currency, exchangeRate });
  };

  const saveExpense = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedTrip || !expenseDraft) return;

    const errors = validateExpenseDraft();
    setValidationErrors(errors);
    if (errors.length > 0) return;

    const now = new Date().toISOString();
    updateData((current) => {
      if (editingExpenseId) {
        return {
          ...current,
          expenses: current.expenses.map((expense) =>
            expense.id === editingExpenseId ? { ...expense, ...expenseDraft, updatedAt: now } : expense,
          ),
        };
      }

      return {
        ...current,
        expenses: [
          ...current.expenses,
          {
            ...expenseDraft,
            id: createId('expense'),
            tripId: selectedTrip.id,
            createdAt: now,
            updatedAt: now,
          },
        ],
      };
    });

    setEditingExpenseId(null);
    setExpenseDraft(editingExpenseId ? expenseDraft : { ...expenseDraft, amount: 0 });
    setStatus(editingExpenseId ? '支出を更新しました。' : '支出を追加しました。');
  };

  const editExpense = (expense: Expense) => {
    const { id: _id, tripId: _tripId, createdAt: _createdAt, updatedAt: _updatedAt, ...draft } = expense;
    setEditingExpenseId(expense.id);
    setExpenseDraft(draft);
    setValidationErrors([]);
  };

  const deleteExpense = (id: string) => {
    updateData((current) => ({ ...current, expenses: current.expenses.filter((expense) => expense.id !== id) }));
  };

  const validateExpenseDraft = () => {
    if (!expenseDraft) return ['支出情報を入力してください。'];
    const errors: string[] = [];
    if (!expenseDraft.date) errors.push('日付を入力してください。');
    if (!expenseDraft.amount || expenseDraft.amount <= 0) errors.push('金額は0より大きい値を入力してください。');
    if (!expenseDraft.currency) errors.push('通貨を選択してください。');
    if (!expenseDraft.exchangeRate || expenseDraft.exchangeRate <= 0) errors.push('為替レートは0より大きい値を入力してください。');
    if (!expenseDraft.categoryId) errors.push('カテゴリを選択してください。');
    if (!expenseDraft.payerId) errors.push('支払者を選択してください。');
    if (expenseDraft.participantIds.length === 0) errors.push('負担対象者を1人以上選択してください。');
    return errors;
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }

    setSortKey(key);
    setSortDirection('asc');
  };

  const toggleExpenseSelection = (id: string, checked: boolean) => {
    setSelectedExpenseIds((current) => (checked ? [...new Set([...current, id])] : current.filter((item) => item !== id)));
  };

  const openBulkEdit = () => {
    if (!selectedTrip || selectedExpenseIds.length === 0) return;
    const first = tripExpenses.find((expense) => selectedExpenseIds.includes(expense.id));
    setBulkDraft(
      first
        ? {
            date: first.date,
            time: first.time ?? '',
            currency: first.currency,
            exchangeRate: first.exchangeRate,
            categoryId: first.categoryId,
            payerId: first.payerId,
            paymentMethodId: first.paymentMethodId ?? '',
            participantIds: first.participantIds,
            place: first.place,
            memo: first.memo,
          }
        : createBulkEditDraft(selectedTrip),
    );
    setBulkApply(createBulkEditApply());
    setBulkEditOpen(true);
  };

  const bulkDeleteExpenses = () => {
    if (selectedExpenseIds.length === 0) return;
    if (!confirm(`${selectedExpenseIds.length}件の支出を削除しますか？`)) return;
    updateData((current) => ({
      ...current,
      expenses: current.expenses.filter((expense) => !selectedExpenseIds.includes(expense.id)),
    }));
    setSelectedExpenseIds([]);
    setStatus('選択した支出を削除しました。');
  };

  const applyBulkEdit = () => {
    if (!bulkDraft || selectedExpenseIds.length === 0) return;
    const now = new Date().toISOString();
    updateData((current) => ({
      ...current,
      expenses: current.expenses.map((expense) => {
        if (!selectedExpenseIds.includes(expense.id)) return expense;
        return {
          ...expense,
          ...(bulkApply.date ? { date: bulkDraft.date } : {}),
          ...(bulkApply.time ? { time: bulkDraft.time } : {}),
          ...(bulkApply.currency ? { currency: bulkDraft.currency } : {}),
          ...(bulkApply.exchangeRate ? { exchangeRate: bulkDraft.exchangeRate } : {}),
          ...(bulkApply.categoryId ? { categoryId: bulkDraft.categoryId } : {}),
          ...(bulkApply.payerId ? { payerId: bulkDraft.payerId } : {}),
          ...(bulkApply.paymentMethodId ? { paymentMethodId: bulkDraft.paymentMethodId } : {}),
          ...(bulkApply.participantIds ? { participantIds: bulkDraft.participantIds } : {}),
          ...(bulkApply.place ? { place: bulkDraft.place } : {}),
          ...(bulkApply.memo ? { memo: bulkDraft.memo } : {}),
          updatedAt: now,
        };
      }),
    }));
    setBulkEditOpen(false);
    setSelectedExpenseIds([]);
    setStatus('選択した支出を更新しました。');
  };

  const importJson = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const imported = await readJsonFile(file);
      const normalized = normalizeAppData(imported);
      replaceAppData(normalized);
      setData(normalized);
      setExpenseDraft(null);
      setStatus('JSONをインポートしました。');
    } catch {
      setStatus('JSONの読み込みに失敗しました。');
    } finally {
      event.target.value = '';
    }
  };

  if (!selectedTrip || !summary || !expenseDraft) {
    return (
      <main className="empty-screen">
        <button className="primary-button" type="button" onClick={addTrip}>
          旅行を作成
        </button>
      </main>
    );
  }

  const companions = new Map(selectedTrip.companions.map((person) => [person.id, person.name]));
  const categories = new Map(selectedTrip.categories.map((category) => [category.id, category.name]));
  const paymentMethodOptions = [...data.paymentMethods, ...selectedTrip.paymentMethods];
  const paymentMethods = new Map(paymentMethodOptions.map((method) => [method.id, method.name]));
  const availableCurrencies = Array.from(new Set([...selectedTrip.defaultRates.map((rate) => rate.currency), ...tripExpenses.map((expense) => expense.currency)]));
  const visibleExpenses = tripExpenses
    .filter((expense) => {
      const searchText = filters.search.trim().toLowerCase();
      const searchable = [
        expense.date,
        expense.time ?? '',
        expense.currency,
        categories.get(expense.categoryId) ?? '',
        companions.get(expense.payerId) ?? '',
        paymentMethods.get(expense.paymentMethodId ?? '') ?? '',
        expense.place,
        expense.memo,
      ]
        .join(' ')
        .toLowerCase();

      return (
        (!searchText || searchable.includes(searchText)) &&
        (!filters.categoryId || expense.categoryId === filters.categoryId) &&
        (!filters.currency || expense.currency === filters.currency) &&
        (!filters.payerId || expense.payerId === filters.payerId) &&
        (!filters.paymentMethodId ||
          (filters.paymentMethodId === '__none__' ? !expense.paymentMethodId : expense.paymentMethodId === filters.paymentMethodId))
      );
    })
    .sort((a, b) => {
      const values: Record<SortKey, [string | number, string | number]> = {
        date: [getExpenseDateTime(a), getExpenseDateTime(b)],
        amount: [a.amount, b.amount],
        currency: [a.currency, b.currency],
        exchangeRate: [a.exchangeRate, b.exchangeRate],
        baseAmount: [toBaseAmount(a), toBaseAmount(b)],
        category: [categories.get(a.categoryId) ?? '', categories.get(b.categoryId) ?? ''],
        payer: [companions.get(a.payerId) ?? '', companions.get(b.payerId) ?? ''],
        paymentMethod: [paymentMethods.get(a.paymentMethodId ?? '') ?? '', paymentMethods.get(b.paymentMethodId ?? '') ?? ''],
        place: [a.place, b.place],
        memo: [a.memo, b.memo],
      };
      const [left, right] = values[sortKey];
      const result = compareValues(left, right);
      return sortDirection === 'asc' ? result : -result;
    });
  const allVisibleSelected =
    visibleExpenses.length > 0 && visibleExpenses.every((expense) => selectedExpenseIds.includes(expense.id));
  const sortLabel = (key: SortKey) => (sortKey === key ? (sortDirection === 'asc' ? ' ▲' : ' ▼') : '');

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">T</span>
          <div>
            <strong>Travel Expense</strong>
            <span>Manager</span>
          </div>
        </div>

        <button className="primary-button full" type="button" onClick={addTrip}>
          ＋ 旅行を追加
        </button>

        <div className="trip-list">
          {data.trips.map((trip) => (
            <button
              className={trip.id === selectedTrip.id ? 'trip-item selected' : 'trip-item'}
              key={trip.id}
              type="button"
              onClick={() => {
                setData((current) => ({ ...current, selectedTripId: trip.id }));
                setExpenseDraft(emptyExpenseDraft(trip));
                setEditingExpenseId(null);
              }}
            >
              <strong>{trip.name}</strong>
              <span>
                {trip.startDate} - {trip.endDate}
              </span>
            </button>
          ))}
        </div>

        <div className="sidebar-settings">
          <button type="button" onClick={() => setActiveSettings('app')}>
            アプリ設定
          </button>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <h1>{selectedTrip.name}</h1>
            <p>
              {selectedTrip.startDate} - {selectedTrip.endDate}
            </p>
          </div>
          <div className="top-actions">
            <button type="button" onClick={() => setActiveSettings('trip')}>
              旅行を編集
            </button>
            <button
              type="button"
              onClick={() => exportExpensesCsv({ ...selectedTrip, baseCurrency: BASE_CURRENCY, paymentMethods: paymentMethodOptions }, tripExpenses)}
            >
              CSVエクスポート
            </button>
          </div>
        </header>

        {status && <p className="toast-status">{status}</p>}

        <div className="grid-layout">
          <section className="main-column">
            <Section title="支出入力">
              <form className="expense-form" onSubmit={saveExpense}>
                {validationErrors.length > 0 && (
                  <div className="error-box">
                    {validationErrors.map((error) => (
                      <p key={error}>{error}</p>
                    ))}
                  </div>
                )}
                <Field label="日付" required>
                  <input value={expenseDraft.date} type="date" onChange={(event) => setDraft({ date: event.target.value })} />
                </Field>
                <Field label="時刻">
                  <input
                    value={expenseDraft.time ?? ''}
                    inputMode="numeric"
                    maxLength={5}
                    placeholder="09:30"
                    onChange={(event) => setDraft({ time: event.target.value })}
                  />
                </Field>
                <Field label="金額" required>
                  <input
                    value={expenseDraft.amount || ''}
                    min="0"
                    step="0.01"
                    type="number"
                    onChange={(event) => setDraft({ amount: Number(event.target.value) })}
                  />
                </Field>
                <Field label="通貨" required>
                  <select value={expenseDraft.currency} onChange={(event) => changeDraftCurrency(event.target.value)}>
                    {selectedTrip.defaultRates.map((rate) => (
                      <option key={rate.currency} value={rate.currency}>
                        {rate.currency}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="為替レート" required>
                  <input
                    value={expenseDraft.exchangeRate}
                    min="0"
                    step="0.0001"
                    type="number"
                    onChange={(event) => setDraft({ exchangeRate: Number(event.target.value) })}
                  />
                </Field>
                <Field label="カテゴリ" required>
                  <select value={expenseDraft.categoryId} onChange={(event) => setDraft({ categoryId: event.target.value })}>
                    {selectedTrip.categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="支払者" required>
                  <select value={expenseDraft.payerId} onChange={(event) => setDraft({ payerId: event.target.value })}>
                    {selectedTrip.companions.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="決済方法">
                  <select value={expenseDraft.paymentMethodId ?? ''} onChange={(event) => setDraft({ paymentMethodId: event.target.value })}>
                    <option value="">未設定</option>
                    {data.paymentMethods.length > 0 && <option disabled>共通</option>}
                    {data.paymentMethods.map((method) => (
                      <option key={method.id} value={method.id}>
                        {method.name}
                      </option>
                    ))}
                    {selectedTrip.paymentMethods.length > 0 && <option disabled>旅行ごと</option>}
                    {selectedTrip.paymentMethods.map((method) => (
                      <option key={method.id} value={method.id}>
                        {method.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="店名・場所">
                  <input value={expenseDraft.place} onChange={(event) => setDraft({ place: event.target.value })} />
                </Field>
                <Field label="メモ">
                  <input value={expenseDraft.memo} onChange={(event) => setDraft({ memo: event.target.value })} />
                </Field>
                <fieldset className="participant-box">
                  <legend>
                    負担対象者 <b className="required-mark">*</b>
                  </legend>
                  {selectedTrip.companions.map((person) => (
                    <label key={person.id}>
                      <input
                        checked={expenseDraft.participantIds.includes(person.id)}
                        type="checkbox"
                        onChange={(event) => {
                          setDraft({
                            participantIds: event.target.checked
                              ? [...expenseDraft.participantIds, person.id]
                              : expenseDraft.participantIds.filter((id) => id !== person.id),
                          });
                        }}
                      />
                      {person.name}
                    </label>
                  ))}
                </fieldset>
                <div className="form-actions">
                  {editingExpenseId && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingExpenseId(null);
                        setExpenseDraft(emptyExpenseDraft(selectedTrip));
                      }}
                    >
                      編集をキャンセル
                    </button>
                  )}
                  <button className="primary-button" type="submit">
                    {editingExpenseId ? '支出を更新' : '支出を追加'}
                  </button>
                </div>
              </form>
            </Section>

            <Section title="支出一覧">
              <div className="expense-tools">
                <Field label="検索">
                  <input
                    value={filters.search}
                    placeholder="店名・場所、メモなど"
                    onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
                  />
                </Field>
                <Field label="カテゴリ">
                  <select value={filters.categoryId} onChange={(event) => setFilters((current) => ({ ...current, categoryId: event.target.value }))}>
                    <option value="">すべて</option>
                    {selectedTrip.categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="通貨">
                  <select value={filters.currency} onChange={(event) => setFilters((current) => ({ ...current, currency: event.target.value }))}>
                    <option value="">すべて</option>
                    {availableCurrencies.map((currency) => (
                      <option key={currency} value={currency}>
                        {currency}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="支払者">
                  <select value={filters.payerId} onChange={(event) => setFilters((current) => ({ ...current, payerId: event.target.value }))}>
                    <option value="">すべて</option>
                    {selectedTrip.companions.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="決済方法">
                  <select
                    value={filters.paymentMethodId}
                    onChange={(event) => setFilters((current) => ({ ...current, paymentMethodId: event.target.value }))}
                  >
                    <option value="">すべて</option>
                    <option value="__none__">未設定</option>
                    {paymentMethodOptions.map((method) => (
                      <option key={method.id} value={method.id}>
                        {method.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="bulk-toolbar">
                <span>
                  {visibleExpenses.length}件表示 / {selectedExpenseIds.length}件選択
                </span>
                <div>
                  <button type="button" disabled={selectedExpenseIds.length === 0} onClick={openBulkEdit}>
                    選択行を一括編集
                  </button>
                  <button className="danger-inline-button" type="button" disabled={selectedExpenseIds.length === 0} onClick={bulkDeleteExpenses}>
                    選択行を削除
                  </button>
                </div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th className="select-cell">
                        <input
                          aria-label="表示中の支出をすべて選択"
                          checked={allVisibleSelected}
                          type="checkbox"
                          onChange={(event) =>
                            setSelectedExpenseIds((current) =>
                              event.target.checked
                                ? [...new Set([...current, ...visibleExpenses.map((expense) => expense.id)])]
                                : current.filter((id) => !visibleExpenses.some((expense) => expense.id === id)),
                            )
                          }
                        />
                      </th>
                      <th>
                        <button className="sort-button" type="button" onClick={() => toggleSort('date')}>
                          日付{sortLabel('date')}
                        </button>
                      </th>
                      <th>時刻</th>
                      <th>
                        <button className="sort-button" type="button" onClick={() => toggleSort('amount')}>
                          金額{sortLabel('amount')}
                        </button>
                      </th>
                      <th>
                        <button className="sort-button" type="button" onClick={() => toggleSort('currency')}>
                          通貨{sortLabel('currency')}
                        </button>
                      </th>
                      <th>
                        <button className="sort-button" type="button" onClick={() => toggleSort('exchangeRate')}>
                          レート{sortLabel('exchangeRate')}
                        </button>
                      </th>
                      <th>
                        <button className="sort-button" type="button" onClick={() => toggleSort('baseAmount')}>
                          換算額{sortLabel('baseAmount')}
                        </button>
                      </th>
                      <th>
                        <button className="sort-button" type="button" onClick={() => toggleSort('category')}>
                          カテゴリ{sortLabel('category')}
                        </button>
                      </th>
                      <th>
                        <button className="sort-button" type="button" onClick={() => toggleSort('payer')}>
                          支払者{sortLabel('payer')}
                        </button>
                      </th>
                      <th>
                        <button className="sort-button" type="button" onClick={() => toggleSort('paymentMethod')}>
                          決済方法{sortLabel('paymentMethod')}
                        </button>
                      </th>
                      <th>負担対象者</th>
                      <th>
                        <button className="sort-button" type="button" onClick={() => toggleSort('place')}>
                          店名・場所{sortLabel('place')}
                        </button>
                      </th>
                      <th>
                        <button className="sort-button" type="button" onClick={() => toggleSort('memo')}>
                          メモ{sortLabel('memo')}
                        </button>
                      </th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleExpenses.map((expense) => (
                      <tr key={expense.id}>
                        <td className="select-cell">
                          <input
                            aria-label={`${expense.date} ${expense.place || '支出'}を選択`}
                            checked={selectedExpenseIds.includes(expense.id)}
                            type="checkbox"
                            onChange={(event) => toggleExpenseSelection(expense.id, event.target.checked)}
                          />
                        </td>
                        <td>{expense.date}</td>
                        <td>{expense.time ?? ''}</td>
                        <td className="number">{formatNumber(expense.amount)}</td>
                        <td>{expense.currency}</td>
                        <td className="number">{formatNumber(expense.exchangeRate)}</td>
                        <td className="number">{formatMoney(toBaseAmount(expense), BASE_CURRENCY)}</td>
                        <td>{categories.get(expense.categoryId) ?? ''}</td>
                        <td>{companions.get(expense.payerId) ?? ''}</td>
                        <td>{paymentMethods.get(expense.paymentMethodId ?? '') ?? ''}</td>
                        <td>{expense.participantIds.map((id) => companions.get(id)).join(' / ')}</td>
                        <td>{expense.place}</td>
                        <td>{expense.memo}</td>
                        <td className="row-actions">
                          <button type="button" onClick={() => editExpense(expense)}>
                            編集
                          </button>
                          <button type="button" onClick={() => deleteExpense(expense.id)}>
                            削除
                          </button>
                        </td>
                      </tr>
                    ))}
                    {visibleExpenses.length === 0 && (
                      <tr>
                        <td className="empty-row" colSpan={14}>
                          {tripExpenses.length === 0 ? '支出を追加すると、ここに一覧と集計が表示されます。' : '条件に一致する支出がありません。'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Section>
          </section>
        </div>

        <section className="summary-board">
          <div className="metric-card">
            <span>総支出</span>
            <strong>{formatMoney(summary.totalBase, BASE_CURRENCY)}</strong>
          </div>
          <div className="metric-card">
            <span>1日あたり平均</span>
            <strong>{formatMoney(summary.dailyAverageBase, BASE_CURRENCY)}</strong>
          </div>
          <SummaryTable title="カテゴリ別合計" rows={summary.categoryTotals} currency={BASE_CURRENCY} />
          <SummaryTable title="通貨別合計" rows={summary.currencyTotals} />
          <SummaryTable title="支払者別合計" rows={summary.payerTotals} currency={BASE_CURRENCY} />
          <SummaryTable title="同行者ごとの実質負担額" rows={summary.personBurden} currency={BASE_CURRENCY} />
          <SummaryTable title="差額" rows={summary.netBalances} currency={BASE_CURRENCY} showSign />
          <div className="summary-panel">
            <h3>割り勘精算</h3>
            {summary.settlements.length ? (
              <ul className="settlement-list">
                {summary.settlements.map((settlement) => (
                  <li key={`${settlement.fromId}-${settlement.toId}-${settlement.amount}`}>
                    <span>{companions.get(settlement.fromId)} → {companions.get(settlement.toId)}</span>
                    <strong>{formatMoney(settlement.amount, BASE_CURRENCY)}</strong>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">精算は不要です。</p>
            )}
          </div>
        </section>
      </main>

      {activeSettings === 'trip' && (
        <SettingsDialog title="旅行を編集" onClose={() => setActiveSettings(null)}>
          <Section title="旅行設定">
            <div className="settings-grid">
              <Field label="旅行名" wide>
                <input value={selectedTrip.name} onChange={(event) => updateTrip({ name: event.target.value })} />
              </Field>
              <Field label="開始日">
                <input value={selectedTrip.startDate} type="date" onChange={(event) => updateTrip({ startDate: event.target.value })} />
              </Field>
              <Field label="終了日">
                <input value={selectedTrip.endDate} type="date" onChange={(event) => updateTrip({ endDate: event.target.value })} />
              </Field>
            </div>
            <button className="danger-button" type="button" onClick={deleteTrip}>
              旅行を削除
            </button>
          </Section>

          <NameEditor title="同行者" items={selectedTrip.companions} prefix="person" onRemove={removeCompanion} onSave={upsertCompanion} />
          <RatesEditor rates={selectedTrip.defaultRates} onRemove={removeRate} onSave={upsertRate} />
          <NameEditor
            title="旅行ごとの決済方法"
            items={selectedTrip.paymentMethods}
            prefix="trip-pay"
            onRemove={removeTripPaymentMethod}
            onSave={upsertTripPaymentMethod}
          />
        </SettingsDialog>
      )}

      {activeSettings === 'app' && (
        <SettingsDialog title="アプリ設定" onClose={() => setActiveSettings(null)}>
          <NameEditor title="カテゴリ" items={selectedTrip.categories} prefix="cat" onRemove={removeCategory} onSave={upsertCategory} />
          <NameEditor
            title="共通の決済方法"
            items={data.paymentMethods}
            prefix="pay"
            onRemove={removeCommonPaymentMethod}
            onSave={upsertCommonPaymentMethod}
          />
          <Section title="バックアップ">
            <div className="backup-actions">
              <button type="button" onClick={() => exportJson(data)}>
                JSONエクスポート
              </button>
              <label className="file-button">
                JSONインポート
                <input accept="application/json" type="file" onChange={importJson} />
              </label>
            </div>
          </Section>
        </SettingsDialog>
      )}

      {bulkEditOpen && bulkDraft && (
        <SettingsDialog title={`選択行を一括編集（${selectedExpenseIds.length}件）`} onClose={() => setBulkEditOpen(false)}>
          <BulkEditPanel
            apply={bulkApply}
            categories={selectedTrip.categories}
            companions={selectedTrip.companions}
            draft={bulkDraft}
            paymentMethods={paymentMethodOptions}
            rates={selectedTrip.defaultRates}
            onApply={applyBulkEdit}
            onChangeApply={(key, checked) => setBulkApply((current) => ({ ...current, [key]: checked }))}
            onChangeDraft={(patch) => setBulkDraft((current) => (current ? { ...current, ...patch } : current))}
          />
        </SettingsDialog>
      )}
    </div>
  );
}

const SettingsDialog = ({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) => (
  <div className="dialog-backdrop" role="presentation">
    <aside className="settings-dialog" aria-label={title}>
      <header className="dialog-header">
        <h2>{title}</h2>
        <button aria-label="閉じる" type="button" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="dialog-body">{children}</div>
    </aside>
  </div>
);

const BulkEditPanel = ({
  apply,
  categories,
  companions,
  draft,
  paymentMethods,
  rates,
  onApply,
  onChangeApply,
  onChangeDraft,
}: {
  apply: BulkEditApply;
  categories: Category[];
  companions: Companion[];
  draft: BulkEditDraft;
  paymentMethods: PaymentMethod[];
  rates: ExchangeRate[];
  onApply: () => void;
  onChangeApply: (key: keyof BulkEditDraft, checked: boolean) => void;
  onChangeDraft: (patch: Partial<BulkEditDraft>) => void;
}) => {
  const ApplyField = ({
    field,
    label,
    children,
  }: {
    field: keyof BulkEditDraft;
    label: string;
    children: ReactNode;
  }) => (
    <div className="bulk-edit-field">
      <label className="apply-check">
        <input checked={apply[field]} type="checkbox" onChange={(event) => onChangeApply(field, event.target.checked)} />
        {label}
      </label>
      {children}
    </div>
  );

  return (
    <div className="bulk-edit-panel">
      <ApplyField field="date" label="日付">
        <input disabled={!apply.date} type="date" value={draft.date} onChange={(event) => onChangeDraft({ date: event.target.value })} />
      </ApplyField>
      <ApplyField field="time" label="時刻">
        <input
          disabled={!apply.time}
          inputMode="numeric"
          maxLength={5}
          placeholder="09:30"
          value={draft.time}
          onChange={(event) => onChangeDraft({ time: event.target.value })}
        />
      </ApplyField>
      <ApplyField field="currency" label="通貨">
        <select
          disabled={!apply.currency}
          value={draft.currency}
          onChange={(event) => {
            const exchangeRate = rates.find((rate) => rate.currency === event.target.value)?.rateToBase ?? draft.exchangeRate;
            onChangeDraft({ currency: event.target.value, exchangeRate });
          }}
        >
          {rates.map((rate) => (
            <option key={rate.currency} value={rate.currency}>
              {rate.currency}
            </option>
          ))}
        </select>
      </ApplyField>
      <ApplyField field="exchangeRate" label="為替レート">
        <input
          disabled={!apply.exchangeRate}
          min="0"
          step="0.0001"
          type="number"
          value={draft.exchangeRate}
          onChange={(event) => onChangeDraft({ exchangeRate: Number(event.target.value) })}
        />
      </ApplyField>
      <ApplyField field="categoryId" label="カテゴリ">
        <select disabled={!apply.categoryId} value={draft.categoryId} onChange={(event) => onChangeDraft({ categoryId: event.target.value })}>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </ApplyField>
      <ApplyField field="payerId" label="支払者">
        <select disabled={!apply.payerId} value={draft.payerId} onChange={(event) => onChangeDraft({ payerId: event.target.value })}>
          {companions.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </select>
      </ApplyField>
      <ApplyField field="paymentMethodId" label="決済方法">
        <select
          disabled={!apply.paymentMethodId}
          value={draft.paymentMethodId}
          onChange={(event) => onChangeDraft({ paymentMethodId: event.target.value })}
        >
          <option value="">未設定</option>
          {paymentMethods.map((method) => (
            <option key={method.id} value={method.id}>
              {method.name}
            </option>
          ))}
        </select>
      </ApplyField>
      <div className="bulk-edit-field bulk-edit-wide">
        <label className="apply-check">
          <input
            checked={apply.participantIds}
            type="checkbox"
            onChange={(event) => onChangeApply('participantIds', event.target.checked)}
          />
          負担対象者
        </label>
        <div className="participant-box compact">
          {companions.map((person) => (
            <label key={person.id}>
              <input
                checked={draft.participantIds.includes(person.id)}
                disabled={!apply.participantIds}
                type="checkbox"
                onChange={(event) =>
                  onChangeDraft({
                    participantIds: event.target.checked
                      ? [...draft.participantIds, person.id]
                      : draft.participantIds.filter((id) => id !== person.id),
                  })
                }
              />
              {person.name}
            </label>
          ))}
        </div>
      </div>
      <ApplyField field="place" label="店名・場所">
        <input disabled={!apply.place} value={draft.place} onChange={(event) => onChangeDraft({ place: event.target.value })} />
      </ApplyField>
      <ApplyField field="memo" label="メモ">
        <input disabled={!apply.memo} value={draft.memo} onChange={(event) => onChangeDraft({ memo: event.target.value })} />
      </ApplyField>
      <div className="form-actions bulk-edit-actions">
        <button className="primary-button" type="button" onClick={onApply}>
          選択行を更新
        </button>
      </div>
    </div>
  );
};

const SummaryTable = ({
  title,
  rows,
  currency,
  showSign = false,
}: {
  title: string;
  rows: { id: string; label: string; amount: number }[];
  currency?: string;
  showSign?: boolean;
}) => (
  <div className="summary-panel">
    <h3>{title}</h3>
    {rows.length ? (
      <ul className="summary-list">
        {rows.map((row) => (
          <li key={row.id}>
            <span>{row.label}</span>
            <strong className={showSign && row.amount < 0 ? 'negative' : undefined}>
              {showSign && row.amount > 0 ? '+' : ''}
              {currency ? formatMoney(row.amount, currency) : formatNumber(row.amount)}
            </strong>
          </li>
        ))}
      </ul>
    ) : (
      <p className="muted">データがありません。</p>
    )}
  </div>
);

const NameEditor = <T extends { id: string; name: string }>({
  title,
  items,
  prefix,
  onSave,
  onRemove,
}: {
  title: string;
  items: T[];
  prefix: string;
  onSave: (item: T) => void;
  onRemove: (id: string) => void;
}) => {
  const [name, setName] = useState('');

  return (
    <Section title={title}>
      <div className="chip-list">
        {items.map((item) => (
          <span className="editable-chip" key={item.id}>
            <input value={item.name} onChange={(event) => onSave({ ...item, name: event.target.value })} />
            <button type="button" onClick={() => onRemove(item.id)}>
              ×
            </button>
          </span>
        ))}
      </div>
      <form
        className="inline-form name-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) return;
          onSave({ id: createId(prefix), name: name.trim() } as T);
          setName('');
        }}
      >
        <input value={name} placeholder={`${title}を追加`} onChange={(event) => setName(event.target.value)} />
        <button type="submit">追加</button>
      </form>
    </Section>
  );
};

const RatesEditor = ({
  rates,
  onSave,
  onRemove,
}: {
  rates: ExchangeRate[];
  onSave: (rate: ExchangeRate) => void;
  onRemove: (currency: string) => void;
}) => {
  const [currency, setCurrency] = useState('');
  const [rate, setRate] = useState(1);

  return (
    <Section title="通貨別デフォルト為替レート">
      <div className="rate-list">
        {rates.map((item) => (
          <div className="rate-row" key={item.currency}>
            <input
              value={item.currency}
              maxLength={3}
              onChange={(event) => onSave({ currency: event.target.value.toUpperCase(), rateToBase: item.rateToBase })}
            />
            <input
              value={item.rateToBase}
              min="0"
              step="0.0001"
              type="number"
              onChange={(event) => onSave({ ...item, rateToBase: Number(event.target.value) })}
            />
            <button type="button" onClick={() => onRemove(item.currency)}>
              ×
            </button>
          </div>
        ))}
      </div>
      <form
        className="inline-form rate-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!currency.trim()) return;
          onSave({ currency: currency.trim().toUpperCase(), rateToBase: rate });
          setCurrency('');
          setRate(1);
        }}
      >
        <input value={currency} maxLength={3} placeholder="USD" onChange={(event) => setCurrency(event.target.value)} />
        <input value={rate} min="0" step="0.0001" type="number" onChange={(event) => setRate(Number(event.target.value))} />
        <button type="submit">追加</button>
      </form>
    </Section>
  );
};

export default App;
