export type PropertyRole = "ADMIN" | "OPERATOR" | "VIEWER";
export type StartMethod = "IMPORT" | "MANUAL";
export interface PropertySummary {
  id: string;
  name: string;
  responsible: string;
  timezone: string;
  phone: string | null;
  startMethod: StartMethod;
  role: PropertyRole;
}
export interface AuthSession {
  user: { id: string; name: string; email: string; emailVerified: boolean };
  property: PropertySummary | null;
  properties: PropertySummary[];
}
export interface ApiError {
  message: string;
  code?: string;
}

export const stockKinds = {
  OPENING: "Abertura",
  IN: "Entrada",
  CONSUMPTION: "Consumo",
  DISPOSAL: "Perda / descarte",
  ADJUST_IN: "Ajuste positivo",
  ADJUST_OUT: "Ajuste negativo",
  REVERSAL: "Estorno",
} as const;
export type StockKind = keyof typeof stockKinds;
export const stockUnits = ["L", "kg", "g", "mL", "un", "m"] as const;
export const stockCategories = [
  "Combustíveis",
  "Lubrificantes",
  "Fertilizantes",
  "Corretivos",
  "Sementes",
  "Defensivos e biológicos",
  "Peças e manutenção",
  "Irrigação",
  "EPI",
  "Outros",
];
export interface LotView {
  id: string;
  code: string;
  balance: string;
  expiresOn: string | null;
  expiryStatus: string;
  unitCost: string | null;
  supplier: string | null;
}
export interface ProductView {
  categoryId?: string;
  id: string;
  name: string;
  category: string;
  unit: string;
  minimum: string;
  minimumKnown: boolean;
  archived: boolean;
  balance: string;
  knownValue: string;
  unpricedBalance: string;
  lots: LotView[];
}
export interface MovementView {
  id: string;
  productId: string;
  productName: string;
  unit: string;
  lotCode: string;
  kind: StockKind;
  delta: string;
  unitCost: string | null;
  occurredAt: string;
  recordedAt: string;
  actorName: string;
  originalResponsible: string | null;
  originalReference: string | null;
  originalLine: number | null;
  consumptionConfirmed: boolean;
  destination: string | null;
  notes: string | null;
  source: string;
  reversalOf: string | null;
  reversed: boolean;
}
export interface InventoryView {
  categories?: { id: string; name: string; archived: boolean; version: number }[];
  revision: number;
  products: ProductView[];
}
export interface ProductInput {
  categoryId?: string;
  name: string;
  category: string;
  unit: string;
  minimum: string;
  minimumKnown?: boolean;
  acknowledgeSimilar?: boolean;
}
export interface LotInput {
  code: string;
  expiryStatus: "UNKNOWN" | "DATED" | "NA";
  expiresOn?: string;
  unitCost?: string;
  supplier?: string;
}
export interface MovementInput {
  productId: string;
  lotId?: string;
  kind: Exclude<StockKind, "REVERSAL">;
  quantity: string;
  occurredAt: string;
  destination?: string;
  notes?: string;
  lot?: LotInput;
  originalResponsible?: string;
  originalReference?: string;
  originalLine?: number;
  consumptionConfirmed?: boolean;
}
export const importFields = {
  product: "Produto",
  category: "Categoria",
  unit: "Unidade",
  quantity: "Quantidade",
  minimum: "Estoque mínimo",
  unitCost: "Custo unitário (R$)",
  lot: "Lote",
  expiry: "Validade",
  supplier: "Fornecedor",
  kind: "Tipo de movimento",
  date: "Data do fato",
  destination: "Destino",
  notes: "Observações",
  reference: "Identificador de origem",
  responsible: "Responsável histórico",
  usageConfirmed: "Saída genérica confirmada como uso (sim/não)",
} as const;
export type ImportField = keyof typeof importFields;
export interface ImportSheet {
  name: string;
  headers: string[];
  rows: string[][];
}

export type AlertPriority = "CRITICAL" | "HIGH" | "MODERATE";
export type ActionState = "PENDING" | "REVIEWING" | "RESOLVED" | "DISMISSED";
export interface AnalysisPolicy {
  reorderDays: number; expiryWarningDays: number; inactivityDays: number; policyVersion: number;
  intelligence?: IntelligencePolicy;
}
export interface AnalysisAlert {
  identity: string; productId: string; productName: string; category: string; unit: string;
  lotId: string | null; lotCode: string | null; rule: string; priority: AlertPriority;
  title: string; explanation: string; suggestion: string; deadlineDays: number | null;
  exposedQuantity: string; knownValue: string; partialCost: boolean;
  limitations: string[]; referenceDay: string; revision: number; ruleVersion: string; policyVersion: number;
}
export interface ProductAnalysis {
  id: string; name: string; category: string; unit: string;
  physical: string; eligible: string; expired: string; unknownExpiry: string;
  minimum: string; minimumKnown: boolean; knownValue: string; unpricedLots: number;
  consumption: string; observedDays: number; from: string | null; to: string;
  dailyAverage: string | null; autonomyDays: string | null; unstable: boolean;
  preliminary: boolean; limitations: string[]; daily: { day: string; quantity: string }[];
  coverageStart: string | null; coverageEnd: string | null; coverageOngoing: boolean;
  leadTimeDays: number | null; safetyDays: number; movementIds: string[];
}
export interface AnalysisResult {
  referenceDay: string; timezone: string; ruleVersion: string; revision: number;
  policy: AnalysisPolicy; products: ProductAnalysis[]; alerts: AnalysisAlert[];
  summary: { products: number; knownValue: string; unpricedLots: number; criticalProducts: number;
    expiringLots: number; knownRiskValue: string; incompleteProducts: number };
  intelligence?: IntelligenceResult;
}
export interface AlertOccurrenceView {
  id: string; identity: string; productId: string; priority: string; rule: string;
  evidence: AnalysisAlert; firstSeenAt: string; lastSeenAt: string; closedAt: string | null;
  previousId: string | null; actionState: ActionState; actionVersion: number;
  assigneeId: string | null; assigneeName: string | null;
}
export interface AnalysisView {
  status: "EMPTY" | "CURRENT" | "PENDING" | "STALE" | "ERROR";
  snapshotId: string | null; calculatedAt: string | null; result: AnalysisResult | null;
  error: string | null; policy: AnalysisPolicy; revision: number;
  alerts: AlertOccurrenceView[];
}
export interface ImportRow {
  line: number;
  original: string[];
  values: Record<ImportField, string>;
  productId: string | null;
  fingerprint: string;
  errors: string[];
  warnings: string[];
  duplicate: boolean;
}
export interface ImportView {
  id: string;
  status: string;
  fileName: string;
  mode: "POSITION" | "HISTORY";
  sheets: ImportSheet[];
  mapping: Partial<Record<ImportField, number>>;
  rows: ImportRow[];
  revision: number;
  previewToken?: string;
  fileRepeated: boolean;
  aiAvailable: boolean;
  analysisNote?: string | null;
  model?: string | null;
  result?: { imported: number; ignored: number; movementIds: string[] } | null;
}

export interface IntelligencePolicy {
  comparisonDays: number;
  consumptionChangePercent: number;
  trendPercent: number;
  withdrawalMultiplier: number;
  withdrawalMinSamples: number;
  excessDays: number;
  priceChangePercent: number;
  highValuePercent: number;
  minimumChangeQuantity: string;
}
export const defaultIntelligencePolicy: IntelligencePolicy = {
  comparisonDays: 30, consumptionChangePercent: 50, trendPercent: 20,
  withdrawalMultiplier: 3, withdrawalMinSamples: 10, excessDays: 90,
  priceChangePercent: 20, highValuePercent: 20, minimumChangeQuantity: "1",
};
export interface IntelligenceSeriesPoint { from: string; to: string; quantity: string | null; coveredDays: number; totalDays: number }
export interface PricePoint { id: string; day: string; quantity: string; unitCost: string | null; supplier: string | null; lotCode: string }
export interface IntelligenceProduct {
  id: string; name: string; category: string; unit: string; archived: boolean;
  currentConsumption: string; previousConsumption: string; currentCovered: boolean; previousCovered: boolean;
  comparisonStatus: string; changePercent: string | null; difference: string; currentRecords: number; previousRecords: number;
  series: IntelligenceSeriesPoint[]; trend: { blocks: string[]; detected: boolean; covered: boolean };
  currentValue: string; eligible: string; unpricedLots: number; knownValueShare: string | null; weightedCost: string | null;
  purchaseValue: string; purchaseUnpriced: number; consumptionValue: string; consumptionUnpriced: number;
  prices: PricePoint[]; priceChangePercent: string | null; priceStatus: string; priceImpact: string | null;
  priceTotal: number; priceComparison: { previous: PricePoint | null; current: PricePoint | null };
  excessQuantity: string | null; excessKnownValue: string; idle: boolean; idleCovered: boolean; idleKnownValue: string;
  exposureKnownValue: string; limitations: string[];
  planning: { horizonDays: number; targetQuantity: string | null; suggestedQuantity: string | null; basis: string;
    estimatedUnitCost: string | null; priceReference: string | null; estimatedBudget: string | null; expiryLoss: string | null };
}
export interface IntelligenceResult {
  referenceDay: string; timezone: string; revision: number; policyVersion: number; ruleVersion: string;
  period: { from: string; to: string; previousFrom: string; previousTo: string; days: number; grouping: "DAY" | "WEEK" | "MONTH" };
  policy: IntelligencePolicy; products: IntelligenceProduct[]; signals: AnalysisAlert[];
  summary: { currentValue: string; purchaseValue: string; consumptionValue: string; purchaseUnpriced: number;
    consumptionUnpriced: number; unpricedLots: number; idleKnownValue: string; excessKnownValue: string;
    exposureKnownValue: string; estimatedBudget: string; budgetMissingProducts: number; products: number };
  categories: { category: string; currentValue: string; purchaseValue: string; consumptionValue: string }[];
  anomalies: { movementId: string; productId: string; productName: string; unit: string; day: string; quantity: string;
    median: string; threshold: string; samples: number; destination: string | null; explanation: string }[];
  assumptions: string[];
}
export interface ProjectionPoint { day: string; balance: string; demand: string; used: string; unmet: string; expired: string; arrival: string }
export interface ProjectionResult {
  points: ProjectionPoint[]; closingBalance: string; expiredQuantity: string; unmetQuantity: string;
  shortageDays: number; firstShortageDay: string | null; unmetBeforeArrival: string;
}
export interface SimulationView {
  productId: string; productName: string; unit: string; revision: number; policyVersion: number; ruleVersion: string; referenceDay: string;
  baselineRate: string | null; scenarioRate: string | null; limitations: string[];
  baseline: ProjectionResult | null; scenario: ProjectionResult | null; arrivalDay: string; estimatedCost: string | null;
}
export interface IntelligenceView {
  result: IntelligenceResult; page: number; pageSize: number; total: number;
  options: { products: { id: string; name: string; category: string; unit: string; archived: boolean }[]; categories: string[] };
  anomalies: { total: number; page: number; rows: IntelligenceResult["anomalies"] };
}
