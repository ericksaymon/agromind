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
  revision: number;
  products: ProductView[];
}
export interface ProductInput {
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
