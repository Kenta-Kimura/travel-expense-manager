import type { ChangeEvent, FormEvent, ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { exportExpensesCsv, exportJson } from './lib/backup';
import { summarizeTrip, toBaseAmount } from './lib/calculations';
import { createId, createTrip, today } from './lib/seed';
import { loadAppData, replaceAppData, saveAppData } from './lib/storage';
import type { AppData, Category, Companion, CurrencyCode, Expense, ExchangeRate, Trip } from './lib/types';

type ExpenseDraft = Omit<Expense, 'id' | 'tripId' | 'createdAt' | 'updatedAt'>;
const BASE_CURRENCY: CurrencyCode = 'JPY';

const emptyExpenseDraft = (trip: Trip): ExpenseDraft => {
  const currency = trip.defaultRates[0]?.currency ?? BASE_CURRENCY;
  const rate = trip.defaultRates.find((item) => item.currency === currency)?.rateToBase ?? 1;
  const payerId = trip.companions[0]?.id ?? 'person-me';

  return {
    date: today(),
    amount: 0,
    currency,
    exchangeRate: rate,
    categoryId: trip.categories[0]?.id ?? 'cat-other',
    payerId,
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
  trips: data.trips.map((trip) => ({ ...trip, baseCurrency: BASE_CURRENCY })),
});

const Field = ({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) => (
  <label className={wide ? 'field field-wide' : 'field'}>
    <span>{label}</span>
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
  const [status, setStatus] = useState('');

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
    if (selectedTrip && !expenseDraft) setExpenseDraft(emptyExpenseDraft(selectedTrip));
  }, [expenseDraft, selectedTrip]);

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
    if (!selectedTrip || !expenseDraft || expenseDraft.amount <= 0 || expenseDraft.participantIds.length === 0) return;

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
    setExpenseDraft(emptyExpenseDraft(selectedTrip));
    setStatus(editingExpenseId ? '支出を更新しました。' : '支出を追加しました。');
  };

  const editExpense = (expense: Expense) => {
    const { id: _id, tripId: _tripId, createdAt: _createdAt, updatedAt: _updatedAt, ...draft } = expense;
    setEditingExpenseId(expense.id);
    setExpenseDraft(draft);
  };

  const deleteExpense = (id: string) => {
    updateData((current) => ({ ...current, expenses: current.expenses.filter((expense) => expense.id !== id) }));
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
            <button type="button" onClick={() => setActiveSettings('app')}>
              全体設定
            </button>
            <button type="button" onClick={() => exportExpensesCsv({ ...selectedTrip, baseCurrency: BASE_CURRENCY }, tripExpenses)}>
              CSVエクスポート
            </button>
            <button type="button" onClick={() => exportJson(data)}>
              JSONエクスポート
            </button>
            <label className="file-button">
              JSONインポート
              <input accept="application/json" type="file" onChange={importJson} />
            </label>
          </div>
        </header>

        {status && <p className="status">{status}</p>}

        <div className="grid-layout">
          <section className="main-column">
            <Section title="支出入力">
              <form className="expense-form" onSubmit={saveExpense}>
                <Field label="日付">
                  <input value={expenseDraft.date} type="date" onChange={(event) => setDraft({ date: event.target.value })} />
                </Field>
                <Field label="金額">
                  <input
                    value={expenseDraft.amount || ''}
                    min="0"
                    step="0.01"
                    type="number"
                    onChange={(event) => setDraft({ amount: Number(event.target.value) })}
                  />
                </Field>
                <Field label="通貨">
                  <select value={expenseDraft.currency} onChange={(event) => changeDraftCurrency(event.target.value)}>
                    {selectedTrip.defaultRates.map((rate) => (
                      <option key={rate.currency} value={rate.currency}>
                        {rate.currency}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="為替レート">
                  <input
                    value={expenseDraft.exchangeRate}
                    min="0"
                    step="0.0001"
                    type="number"
                    onChange={(event) => setDraft({ exchangeRate: Number(event.target.value) })}
                  />
                </Field>
                <Field label="カテゴリ">
                  <select value={expenseDraft.categoryId} onChange={(event) => setDraft({ categoryId: event.target.value })}>
                    {selectedTrip.categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="支払者">
                  <select value={expenseDraft.payerId} onChange={(event) => setDraft({ payerId: event.target.value })}>
                    {selectedTrip.companions.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.name}
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
                  <legend>負担対象者</legend>
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
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>日付</th>
                      <th>金額</th>
                      <th>通貨</th>
                      <th>レート</th>
                      <th>換算額</th>
                      <th>カテゴリ</th>
                      <th>支払者</th>
                      <th>負担対象者</th>
                      <th>店名・場所</th>
                      <th>メモ</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tripExpenses.map((expense) => (
                      <tr key={expense.id}>
                        <td>{expense.date}</td>
                        <td className="number">{formatNumber(expense.amount)}</td>
                        <td>{expense.currency}</td>
                        <td className="number">{formatNumber(expense.exchangeRate)}</td>
                        <td className="number">{formatMoney(toBaseAmount(expense), BASE_CURRENCY)}</td>
                        <td>{categories.get(expense.categoryId) ?? ''}</td>
                        <td>{companions.get(expense.payerId) ?? ''}</td>
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
                    {tripExpenses.length === 0 && (
                      <tr>
                        <td className="empty-row" colSpan={11}>
                          支出を追加すると、ここに一覧と集計が表示されます。
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
        </SettingsDialog>
      )}

      {activeSettings === 'app' && (
        <SettingsDialog title="全体設定" onClose={() => setActiveSettings(null)}>
          <NameEditor title="カテゴリ" items={selectedTrip.categories} prefix="cat" onRemove={removeCategory} onSave={upsertCategory} />
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
