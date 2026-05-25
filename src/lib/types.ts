export type CurrencyCode = string;

export type Category = {
  id: string;
  name: string;
};

export type Companion = {
  id: string;
  name: string;
};

export type PaymentMethod = {
  id: string;
  name: string;
};

export type ExchangeRate = {
  currency: CurrencyCode;
  rateToBase: number;
};

export type Trip = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  baseCurrency: CurrencyCode;
  defaultRates: ExchangeRate[];
  categories: Category[];
  companions: Companion[];
  paymentMethods: PaymentMethod[];
  createdAt: string;
  updatedAt: string;
};

export type Expense = {
  id: string;
  tripId: string;
  date: string;
  time?: string;
  amount: number;
  currency: CurrencyCode;
  exchangeRate: number;
  categoryId: string;
  payerId: string;
  paymentMethodId?: string;
  participantIds: string[];
  memo: string;
  place: string;
  createdAt: string;
  updatedAt: string;
};

export type AppData = {
  schemaVersion: 1;
  trips: Trip[];
  expenses: Expense[];
  selectedTripId: string | null;
  paymentMethods: PaymentMethod[];
};

export type Settlement = {
  fromId: string;
  toId: string;
  amount: number;
};

export type SummaryRow = {
  id: string;
  label: string;
  amount: number;
};

export type TripSummary = {
  totalBase: number;
  dailyAverageBase: number;
  categoryTotals: SummaryRow[];
  currencyTotals: SummaryRow[];
  payerTotals: SummaryRow[];
  personPaid: SummaryRow[];
  personBurden: SummaryRow[];
  netBalances: SummaryRow[];
  settlements: Settlement[];
};
