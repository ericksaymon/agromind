// Conta de teste local com ~6 meses de uso. Somente APP_ENV=local + banco em loopback.
// Uso: pnpm --filter @agromind/api exec tsx scripts/seed-rich-test.ts
// Reexecutar recria a conta (apaga apenas o que ela possui). Credenciais em .private/rich.local.json.
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import argon2 from "argon2";
import { settings } from "../src/config";
import { db } from "../src/db";
import { dateKey, shiftDay } from "../src/analysis-common";
import { processAnalysis } from "../src/analysis-service";
import { keyOf } from "../src/stock-service";
import { Prisma } from "../src/generated/prisma/client";

const folder = new URL("../../../.private/", import.meta.url);
const manifest = new URL("rich.local.json", folder);
const DAYS = 182;
const D = (v: number) => new Prisma.Decimal(v);

// PRNG determinístico para o histórico ser reproduzível.
let seed = 20261029;
const rnd = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
const between = (a: number, b: number) => a + rnd() * (b - a);

type Season = "steady" | "plant" | "harvest" | "dry";
// multiplicador por mês (1-12)
const SEASON: Record<Season, Record<number, number>> = {
  steady: {},
  plant: { 5: 0.35, 6: 0.3, 7: 0.3, 8: 0.7, 9: 1.25, 10: 1.4 },
  harvest: { 5: 1.5, 6: 1.6, 7: 1.3, 8: 0.8, 9: 0.9, 10: 1.2 },
  dry: { 5: 0.5, 6: 0.9, 7: 1.5, 8: 1.8, 9: 1.7, 10: 0.8 },
};

type Def = {
  name: string;
  cat: string;
  unit: "L" | "kg" | "g" | "mL" | "un" | "m";
  rate: number; // consumo médio por dia de uso
  cost: number;
  min: number | null;
  lot: number; // tamanho típico da compra
  lead: number | null;
  shelf?: number; // validade em dias a partir da compra; omitido = sem validade
  unknownExpiry?: boolean;
  suppliers: string[];
  season?: Season;
  dest: string[];
  startDays?: number; // consumo só começa N dias depois (produto novo)
  stopUseAt?: number; // consumo cessa nesse offset negativo (parado)
  noBuyAfter?: number; // deixa de comprar a partir desse offset (queda de saldo)
  bigBuyAt?: number; // compra grande nesse offset (excesso)
  bigBuyMult?: number;
  spikeAt?: number; // retirada incomum
  priceJumpAt?: number; // reajuste forte
  expireSoon?: number; // último lote vence em N dias
  noCost?: boolean;
  archived?: boolean;
  freq?: number; // probabilidade de uso por dia
};

const FARM = ["Talhão 1 – Soja", "Talhão 2 – Milho", "Talhão 3 – Soja", "Talhão 5 – Café", "Pastagem Sul", "Horta e pomar"];
const MACH = ["Trator John Deere 6110J", "Trator New Holland TL75", "Colheitadeira CR5.85", "Pulverizador Jacto", "Caminhão Mercedes 1620", "Gerador da sede", "Camioneta Hilux"];
const SHOP = ["Oficina", "Oficina – trator", "Oficina – colheitadeira", "Manutenção preventiva", "Galpão de máquinas"];
const IRRIG = ["Pivô central 1", "Pivô central 2", "Irrigação da horta", "Gotejamento – café"];
const EPI_D = ["Equipe de aplicação", "Equipe de colheita", "Oficina", "Equipe de campo"];

const defs: Def[] = [
  // Combustíveis
  { name: "Diesel S10", cat: "Combustíveis", unit: "L", rate: 310, cost: 6.05, min: 2500, lot: 6000, lead: 4, suppliers: ["Posto Ipiranga BR-364", "Distribuidora Rondônia Petro"], season: "harvest", dest: MACH, freq: 0.95 },
  { name: "Gasolina comum", cat: "Combustíveis", unit: "L", rate: 28, cost: 6.4, min: 150, lot: 400, lead: 3, suppliers: ["Posto Ipiranga BR-364"], dest: ["Camioneta Hilux", "Motosserra e roçadeiras", "Moto da fazenda"], freq: 0.8 },
  { name: "Etanol hidratado", cat: "Combustíveis", unit: "L", rate: 4, cost: 4.7, min: 30, lot: 200, lead: 5, suppliers: ["Posto Ipiranga BR-364"], dest: ["Moto da fazenda", "Gerador da sede"], stopUseAt: -125 },
  // Lubrificantes
  { name: "Óleo motor 15W40", cat: "Lubrificantes", unit: "L", rate: 6, cost: 31, min: 40, lot: 80, lead: 7, shelf: 1095, suppliers: ["Lubrifort Ariquemes", "Agro Lub Distribuidora"], season: "harvest", dest: MACH.slice(0, 5) },
  { name: "Óleo hidráulico 68", cat: "Lubrificantes", unit: "L", rate: 4, cost: 27, min: 30, lot: 60, lead: 7, shelf: 1095, suppliers: ["Lubrifort Ariquemes"], dest: MACH.slice(0, 4) },
  { name: "Graxa multiuso (balde 18 kg)", cat: "Lubrificantes", unit: "kg", rate: 0.9, cost: 22, min: 10, lot: 36, lead: 10, shelf: 1460, suppliers: ["Lubrifort Ariquemes"], dest: SHOP, freq: 0.4 },
  { name: "Óleo de corte e lâmina", cat: "Lubrificantes", unit: "L", rate: 0.5, cost: 38, min: 4, lot: 20, lead: 10, shelf: 730, suppliers: ["Agro Lub Distribuidora"], dest: ["Motosserra e roçadeiras", "Oficina"], noBuyAfter: -140 },
  // Fertilizantes
  { name: "NPK 04-14-08", cat: "Fertilizantes", unit: "kg", rate: 520, cost: 3.15, min: 4000, lot: 12000, lead: 12, shelf: 1095, suppliers: ["Agrocampo Fertilizantes", "Nutrisul Insumos"], season: "plant", dest: ["Talhão 1 – Soja", "Talhão 3 – Soja", "Talhão 2 – Milho"], freq: 0.7 },
  { name: "Ureia 45% N", cat: "Fertilizantes", unit: "kg", rate: 260, cost: 3.9, min: 2000, lot: 6000, lead: 12, shelf: 1095, suppliers: ["Agrocampo Fertilizantes"], season: "plant", dest: ["Talhão 2 – Milho", "Talhão 5 – Café", "Pastagem Sul"], freq: 0.6, priceJumpAt: -35 },
  { name: "Cloreto de potássio (KCl)", cat: "Fertilizantes", unit: "kg", rate: 210, cost: 3.45, min: 1800, lot: 5000, lead: 14, shelf: 1095, suppliers: ["Nutrisul Insumos"], season: "plant", dest: ["Talhão 1 – Soja", "Talhão 3 – Soja"], freq: 0.55 },
  { name: "Superfosfato simples (SSP)", cat: "Fertilizantes", unit: "kg", rate: 180, cost: 2.2, min: 1500, lot: 5000, lead: 14, suppliers: ["Nutrisul Insumos"], season: "plant", dest: FARM.slice(0, 3), bigBuyAt: -12, bigBuyMult: 3.2 },
  { name: "Adubo foliar micronutrientes", cat: "Fertilizantes", unit: "L", rate: 5, cost: 48, min: 30, lot: 100, lead: 10, shelf: 540, suppliers: ["Agrocampo Fertilizantes"], dest: ["Talhão 5 – Café", "Horta e pomar"], freq: 0.35 },
  // Corretivos
  { name: "Calcário dolomítico", cat: "Corretivos", unit: "kg", rate: 900, cost: 0.19, min: 8000, lot: 30000, lead: 10, suppliers: ["Calcário Cacoal Mineração"], season: "plant", dest: ["Talhão 1 – Soja", "Talhão 3 – Soja", "Pastagem Sul"], freq: 0.35 },
  { name: "Gesso agrícola", cat: "Corretivos", unit: "kg", rate: 300, cost: 0.24, min: 4000, lot: 15000, lead: 10, suppliers: ["Calcário Cacoal Mineração"], dest: ["Talhão 2 – Milho", "Talhão 5 – Café"], freq: 0.3, stopUseAt: -115 },
  // Sementes
  { name: "Semente de soja M8372 IPRO", cat: "Sementes", unit: "kg", rate: 260, cost: 8.6, min: 1200, lot: 3000, lead: 15, shelf: 240, suppliers: ["Cooperativa Agrícola Vale do Jamari"], season: "plant", dest: ["Talhão 1 – Soja", "Talhão 3 – Soja"], freq: 0.45 },
  { name: "Semente de milho safrinha", cat: "Sementes", unit: "kg", rate: 60, cost: 22, min: 300, lot: 800, lead: 15, shelf: 270, suppliers: ["Cooperativa Agrícola Vale do Jamari", "Sementes Brasil Central"], season: "plant", dest: ["Talhão 2 – Milho"], freq: 0.3 },
  { name: "Semente de braquiária ruziziensis", cat: "Sementes", unit: "kg", rate: 25, cost: 21, min: 150, lot: 400, lead: 12, shelf: 360, suppliers: ["Sementes Brasil Central"], dest: ["Pastagem Sul"], freq: 0.3 },
  { name: "Mudas de café clonal (bandeja 50)", cat: "Sementes", unit: "un", rate: 2, cost: 85, min: 4, lot: 30, lead: 20, shelf: 60, suppliers: ["Viveiro Café Rondônia"], dest: ["Talhão 5 – Café"], freq: 0.12, startDays: 60 },
  { name: "Sementes de hortaliças (mix)", cat: "Sementes", unit: "g", rate: 70, cost: 0.9, min: null, lot: 1000, lead: null, unknownExpiry: true, suppliers: ["Casa do Produtor"], dest: ["Horta e pomar"], freq: 0.2, noCost: true },
  // Defensivos e biológicos
  { name: "Glifosato 480 g/L", cat: "Defensivos e biológicos", unit: "L", rate: 42, cost: 24, min: 300, lot: 800, lead: 8, shelf: 720, suppliers: ["AgroVet Defensivos", "Cooperativa Agrícola Vale do Jamari"], season: "plant", dest: ["Talhão 1 – Soja", "Talhão 3 – Soja", "Pastagem Sul"], freq: 0.65 },
  { name: "2,4-D amina", cat: "Defensivos e biológicos", unit: "L", rate: 15, cost: 19.5, min: 100, lot: 300, lead: 8, shelf: 720, suppliers: ["AgroVet Defensivos"], season: "plant", dest: ["Pastagem Sul", "Talhão 2 – Milho"], freq: 0.4 },
  { name: "Fungicida Fox Xpro (Bayer)", cat: "Defensivos e biológicos", unit: "L", rate: 8, cost: 205, min: 60, lot: 120, lead: 7, shelf: 365, suppliers: ["AgroVet Defensivos"], season: "plant", dest: ["Talhão 1 – Soja", "Talhão 3 – Soja"], freq: 0.4, expireSoon: 17 },
  { name: "Inseticida Engeo Pleno S", cat: "Defensivos e biológicos", unit: "L", rate: 4, cost: 168, min: 30, lot: 60, lead: 7, shelf: 540, suppliers: ["AgroVet Defensivos"], season: "plant", dest: ["Talhão 1 – Soja", "Talhão 2 – Milho"], freq: 0.35, spikeAt: -6 },
  { name: "Óleo mineral (adjuvante)", cat: "Defensivos e biológicos", unit: "L", rate: 7, cost: 14.8, min: 60, lot: 200, lead: 8, shelf: 730, suppliers: ["AgroVet Defensivos"], season: "plant", dest: ["Pulverizador Jacto"], freq: 0.5 },
  { name: "Trichoderma (biológico)", cat: "Defensivos e biológicos", unit: "L", rate: 3, cost: 62, min: 20, lot: 40, lead: 9, shelf: 150, suppliers: ["BioCampo Soluções"], dest: ["Talhão 3 – Soja", "Horta e pomar"], freq: 0.3, startDays: 40 },
  { name: "Isca formicida granulada", cat: "Defensivos e biológicos", unit: "kg", rate: 1.2, cost: 34, min: 8, lot: 30, lead: 8, shelf: 365, suppliers: ["AgroVet Defensivos"], dest: ["Pastagem Sul", "Talhão 5 – Café"], freq: 0.3, noBuyAfter: -60 },
  { name: "Herbicida pré-emergente (lote antigo)", cat: "Defensivos e biológicos", unit: "L", rate: 2, cost: 98, min: 15, lot: 40, lead: 10, shelf: 420, suppliers: ["AgroVet Defensivos"], dest: ["Talhão 2 – Milho"], stopUseAt: -128, archived: false },
  // Peças e manutenção
  { name: "Filtro de óleo trator JD 6110J", cat: "Peças e manutenção", unit: "un", rate: 0.35, cost: 78, min: 3, lot: 6, lead: 9, suppliers: ["Tratopeças Ariquemes"], dest: SHOP, freq: 0.35 },
  { name: "Filtro de combustível (par)", cat: "Peças e manutenção", unit: "un", rate: 0.4, cost: 64, min: 4, lot: 8, lead: 9, suppliers: ["Tratopeças Ariquemes"], dest: SHOP, freq: 0.4 },
  { name: "Correia dentada da colheitadeira", cat: "Peças e manutenção", unit: "un", rate: 0.08, cost: 410, min: 1, lot: 2, lead: 18, suppliers: ["Case IH Concessionária Ji-Paraná"], dest: ["Oficina – colheitadeira"], freq: 0.12 },
  { name: "Rolamento 6205 2RS", cat: "Peças e manutenção", unit: "un", rate: 0.5, cost: 24, min: 6, lot: 20, lead: 7, suppliers: ["Rolamentos Norte"], dest: SHOP, freq: 0.4 },
  { name: "Parafuso sextavado M12 (cx 50)", cat: "Peças e manutenção", unit: "un", rate: 0.3, cost: 58, min: 2, lot: 6, lead: 7, suppliers: ["Rolamentos Norte"], dest: SHOP, freq: 0.3 },
  { name: "Ponta de pulverização leque (jogo)", cat: "Peças e manutenção", unit: "un", rate: 0.25, cost: 95, min: 2, lot: 5, lead: 12, suppliers: ["Jacto Peças"], dest: ["Pulverizador Jacto"], freq: 0.25 },
  { name: "Bateria 150 Ah", cat: "Peças e manutenção", unit: "un", rate: 0.04, cost: 890, min: 1, lot: 2, lead: 10, suppliers: ["Tratopeças Ariquemes"], dest: ["Trator New Holland TL75", "Caminhão Mercedes 1620"], freq: 0.08, noBuyAfter: -100 },
  { name: "Pneu 18.4-34 (reserva)", cat: "Peças e manutenção", unit: "un", rate: 0, cost: 4650, min: null, lot: 2, lead: null, suppliers: ["Pneus Rondon"], dest: ["Trator John Deere 6110J"], freq: 0 },
  // Irrigação
  { name: "Mangueira PEAD 32 mm", cat: "Irrigação", unit: "m", rate: 22, cost: 3.4, min: 200, lot: 600, lead: 9, suppliers: ["Irrigaplan"], season: "dry", dest: IRRIG, freq: 0.5 },
  { name: "Gotejador autocompensante", cat: "Irrigação", unit: "un", rate: 40, cost: 0.62, min: 500, lot: 3000, lead: 9, suppliers: ["Irrigaplan"], season: "dry", dest: IRRIG, freq: 0.5 },
  { name: "Conexão T 32 mm", cat: "Irrigação", unit: "un", rate: 2.2, cost: 4.1, min: 40, lot: 150, lead: 8, suppliers: ["Irrigaplan"], season: "dry", dest: IRRIG, freq: 0.45 },
  { name: "Bico aspersor pivô", cat: "Irrigação", unit: "un", rate: 0.8, cost: 18, min: 20, lot: 60, lead: 12, suppliers: ["Irrigaplan", "Valmont Pivôs"], season: "dry", dest: ["Pivô central 1", "Pivô central 2"], freq: 0.3 },
  // EPI
  { name: "Luva nitrílica (par)", cat: "EPI", unit: "un", rate: 5, cost: 7.8, min: 40, lot: 150, lead: 6, suppliers: ["EPI Rondônia"], dest: EPI_D, freq: 0.85 },
  { name: "Máscara respirador PFF2", cat: "EPI", unit: "un", rate: 6, cost: 5.5, min: 60, lot: 200, lead: 6, shelf: 1095, suppliers: ["EPI Rondônia"], season: "plant", dest: EPI_D, freq: 0.85 },
  { name: "Macacão de aplicação", cat: "EPI", unit: "un", rate: 0.4, cost: 189, min: 4, lot: 8, lead: 12, suppliers: ["EPI Rondônia"], season: "plant", dest: EPI_D.slice(0, 1), freq: 0.3 },
  { name: "Óculos de proteção", cat: "EPI", unit: "un", rate: 0.7, cost: 11.5, min: 6, lot: 25, lead: 6, suppliers: ["EPI Rondônia"], dest: EPI_D, freq: 0.45 },
  { name: "Protetor auricular", cat: "EPI", unit: "un", rate: 0.9, cost: 3.2, min: 10, lot: 50, lead: 6, suppliers: ["EPI Rondônia"], dest: EPI_D, freq: 0.5 },
  // Outros
  { name: "Arame farpado (rolo 500 m)", cat: "Outros", unit: "un", rate: 0.2, cost: 520, min: 2, lot: 6, lead: 10, suppliers: ["Casa do Produtor"], dest: ["Pastagem Sul", "Curral"], freq: 0.2 },
  { name: "Sal mineral (saco 25 kg)", cat: "Outros", unit: "un", rate: 5, cost: 118, min: 30, lot: 80, lead: 7, shelf: 365, suppliers: ["Agropecuária Nova Fronteira"], dest: ["Pastagem Sul", "Curral"], freq: 0.8 },
  { name: "Vacina aftosa (frasco 50 dose)", cat: "Outros", unit: "un", rate: 0.6, cost: 74, min: 5, lot: 30, lead: 6, shelf: 45, suppliers: ["Agropecuária Nova Fronteira"], dest: ["Curral"], freq: 0.12, expireSoon: 9 },
  { name: "Ração para bezerros", cat: "Outros", unit: "kg", rate: 55, cost: 2.4, min: 400, lot: 1500, lead: 5, shelf: 120, suppliers: ["Agropecuária Nova Fronteira"], dest: ["Curral"], freq: 0.9 },
  { name: "Lona plástica 6x4 m", cat: "Outros", unit: "un", rate: 0, cost: 135, min: null, lot: 6, lead: null, unknownExpiry: false, suppliers: ["Casa do Produtor"], dest: ["Galpão de máquinas"], freq: 0, noCost: true },
  { name: "Cal hidratada para pintura de troncos", cat: "Corretivos", unit: "kg", rate: 4, cost: 1.9, min: 40, lot: 200, lead: 8, suppliers: ["Calcário Cacoal Mineração"], dest: ["Talhão 5 – Café", "Horta e pomar"], freq: 0.2, archived: true, stopUseAt: -75 },
];

const users = [
  { key: "admin", name: "Rafael Almeida", email: "teste@agromind.local", role: "ADMIN" as const },
  { key: "op", name: "Carlos Mendes", email: "operador.teste@agromind.local", role: "OPERATOR" as const },
  { key: "view", name: "Dra. Paula Ribeiro", email: "consulta.teste@agromind.local", role: "VIEWER" as const },
];
const RESPONSIBLES = ["Rafael Almeida", "Carlos Mendes", "Seu Antônio (capataz)", "Josué Tavares", "Marcos Pereira"];

async function main() {
  if (
    process.env.APP_ENV !== "local" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(new URL(settings.databaseUrl).hostname)
  )
    throw new Error("Este seed exige APP_ENV=local e banco em loopback.");

  let previous: { password: string; marker: string } | null = null;
  try {
    previous = JSON.parse(await readFile(manifest, "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const password = previous?.password || `Agro9-${randomBytes(12).toString("base64url")}`;
  const marker = previous?.marker || randomBytes(6).toString("hex");
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const tz = "America/Cuiaba";
  const today = dateKey(new Date(), tz);

  // ---------- simulação ----------
  type Lot = { id: string; code: string; expiresOn: string | null; cost: number | null; supplier: string; balance: number; createdDay: number };
  type Mv = Prisma.StockMovementUncheckedCreateInput;
  const out: { def: Def; id: string; lots: Lot[]; mvs: Mv[]; first: number }[] = [];
  const at = (day: number) => {
    // horário local 06:30–17:30 (UTC-4) → UTC
    const h = 6 + Math.floor(rnd() * 11), m = Math.floor(rnd() * 60);
    return new Date(`${shiftDay(today, day)}T${String(h + 4).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);
  };
  const fmt = (d: Def, v: number) => (d.unit === "un" ? Math.max(1, Math.round(v)) : Math.round(v * (v < 10 ? 100 : 10)) / (v < 10 ? 100 : 10)) || 1;
  const monthOf = (day: number) => Number(shiftDay(today, day).slice(5, 7));
  const dowOf = (day: number) => new Date(shiftDay(today, day) + "T12:00:00Z").getUTCDay();

  for (const d of defs) {
    const id = randomUUID();
    const lots: Lot[] = [];
    const mvs: Mv[] = [];
    let n = 0;
    const base = (kind: Mv["kind"], lot: Lot, delta: number, day: number, extra: Partial<Mv> = {}): Mv => ({
      id: randomUUID(),
      productId: id,
      lotId: lot.id,
      kind,
      delta: D(delta),
      unitCost: lot.cost === null ? null : D(lot.cost),
      occurredAt: at(day),
      recordedAt: new Date(),
      actorId: "",
      actorName: "",
      originalResponsible: pick(RESPONSIBLES),
      originalReference: null,
      consumptionConfirmed: true,
      destination: null,
      notes: null,
      source: "WEB",
      requestKey: randomUUID(),
      ...extra,
    });
    const priceAt = (day: number) => {
      const drift = 1 + 0.07 * ((day + DAYS) / DAYS); // inflação ~7% no semestre
      const jump = d.priceJumpAt !== undefined && day >= d.priceJumpAt ? 1.34 : 1;
      return Math.round(d.cost * drift * jump * between(0.97, 1.03) * 100) / 100;
    };
    const addLot = (day: number, qty: number, kind: "OPENING" | "IN", shelfOverride?: number) => {
      const supplier = pick(d.suppliers);
      let expiresOn: string | null = null;
      if (d.shelf) expiresOn = shiftDay(today, day + Math.round((shelfOverride ?? d.shelf) * between(0.9, 1.05)));
      if (shelfOverride !== undefined && !d.shelf) expiresOn = shiftDay(today, day + shelfOverride);
      const lot: Lot = {
        id: randomUUID(),
        code: `${kind === "OPENING" ? "SALDO" : "NF"}-${shiftDay(today, day).replace(/-/g, "")}-${String(++n).padStart(2, "0")}`,
        expiresOn,
        cost: d.noCost ? null : priceAt(day),
        supplier,
        balance: 0,
        createdDay: day,
      };
      lots.push(lot);
      lot.balance += qty;
      const mv = base(kind, lot, qty, day, {
        occurredAt: new Date(`${shiftDay(today, day)}T09:${String(10 + Math.floor(rnd() * 40))}:00Z`),
        originalReference: kind === "IN" ? `NF ${Math.floor(1000 + rnd() * 8999)}` : "Contagem inicial",
        notes: kind === "IN" ? `Compra – ${supplier}` : "Saldo de abertura do sistema",
      });
      mvs.push(mv);
      return lot;
    };
    const usable = (day: number) => lots.filter((l) => l.balance > 0 && (l.expiresOn === null || l.expiresOn > shiftDay(today, day)));
    const eligible = (day: number) => usable(day).reduce((s, l) => s + l.balance, 0);

    const startDay = -DAYS + (d.startDays ?? 0);
    const reorderPoint = (d.min ?? d.rate * 12) * 1.9;
    const pending: { day: number; qty: number }[] = [];
    const openQty = d.rate > 0 ? d.rate * between(35, 55) / Math.max(d.freq ?? 0.6, 0.2) * (d.freq ?? 0.6) : d.lot;
    if (d.name === "Pneu 18.4-34 (reserva)" || d.name === "Lona plástica 6x4 m") addLot(startDay, d.lot, "OPENING");
    else addLot(startDay, Math.max(fmt(d, openQty), fmt(d, d.min ? d.min * 1.5 : 1)), "OPENING", d.shelf ? Math.round(d.shelf * 0.7) : undefined);

    for (let day = startDay + 1; day < 0; day++) {
      // chegada de compras agendadas
      for (let i = pending.length - 1; i >= 0; i--)
        if (pending[i].day <= day) {
          let shelf: number | undefined;
          if (d.expireSoon && pending[i].qty > 0 && day > -45) shelf = Math.max(1, -day + d.expireSoon);
          if (d.shelf === undefined && shelf !== undefined) shelf = undefined;
          addLot(day, pending[i].qty, "IN", shelf);
          pending.splice(i, 1);
        }
      // consumo
      const active = d.rate > 0 && day >= startDay + 3 && (d.stopUseAt === undefined || day < d.stopUseAt);
      const dow = dowOf(day);
      const p = (d.freq ?? 0.6) * (dow === 0 ? 0.25 : dow === 6 ? 0.6 : 1);
      if (active && rnd() < p) {
        const mult = (SEASON[d.season ?? "steady"][monthOf(day)] ?? 1) * between(0.55, 1.5);
        let want = fmt(d, (d.rate / (d.freq ?? 0.6)) * mult * (rnd() < 0.04 ? between(1.8, 2.6) : 1));
        if (d.spikeAt !== undefined && day >= d.spikeAt && day < d.spikeAt + 2) want = fmt(d, d.rate * 14);
        // retira dos lotes mais próximos do vencimento primeiro
        const order = usable(day).sort((a, b) => (a.expiresOn ?? "9999").localeCompare(b.expiresOn ?? "9999") || a.createdDay - b.createdDay);
        const dest = pick(d.dest);
        const who = pick(RESPONSIBLES);
        for (const lot of order) {
          if (want <= 0) break;
          const take = d.unit === "un" ? Math.min(Math.floor(lot.balance), want) : Math.min(lot.balance, want);
          if (take <= 0) continue;
          const t = Math.round(take * 1000) / 1000;
          lot.balance = Math.round((lot.balance - t) * 1000) / 1000;
          mvs.push(base("CONSUMPTION", lot, -t, day, { destination: dest, originalResponsible: who, notes: rnd() < 0.15 ? pick(["Aplicação programada", "Uso conforme ordem de serviço", "Reposição de campo", "Conferido pelo capataz"]) : null }));
          want = Math.round((want - t) * 1000) / 1000;
        }
      }
      // perda/descarte esporádico de lote vencido (a cada ~25 dias há chance)
      if (rnd() < 0.04)
        for (const lot of lots) {
          if (lot.balance > 0 && lot.expiresOn && lot.expiresOn < shiftDay(today, day - 2) && rnd() < 0.5) {
            const part = d.unit === "un" ? Math.max(1, Math.floor(lot.balance * 0.6)) : Math.round(lot.balance * 0.6 * 100) / 100;
            lot.balance = Math.round((lot.balance - part) * 1000) / 1000;
            mvs.push(base("DISPOSAL", lot, -part, day, { notes: "Descarte por vencimento – recolhido para logística reversa" }));
            break;
          }
        }
      // ajuste de inventário esporádico
      if (d.rate > 0 && rnd() < 0.006) {
        const lot = usable(day)[0];
        if (lot && lot.balance > 2) {
          const q = d.unit === "un" ? 1 : Math.max(0.5, Math.round(lot.balance * 0.02 * 10) / 10);
          if (rnd() < 0.6) {
            lot.balance = Math.round((lot.balance - q) * 1000) / 1000;
            mvs.push(base("ADJUST_OUT", lot, -q, day, { notes: "Ajuste após contagem física: diferença de inventário" }));
          } else {
            lot.balance += q;
            mvs.push(base("ADJUST_IN", lot, q, day, { notes: "Ajuste após contagem física: sobra encontrada" }));
          }
        }
      }
      // reposição
      const incoming = pending.reduce((s, x) => s + x.qty, 0);
      const buying = d.rate > 0 && d.lead !== null && (d.noBuyAfter === undefined || day < d.noBuyAfter);
      if (buying && eligible(day) + incoming < reorderPoint && !(d.expireSoon && day > -20))
        pending.push({ day: day + d.lead! + Math.floor(rnd() * 3), qty: fmt(d, d.lot * between(0.8, 1.15)) });
      if (d.bigBuyAt === day) pending.push({ day: day + 1, qty: fmt(d, d.lot * (d.bigBuyMult ?? 3)) });
    }
    // compras ainda pendentes que já "chegaram" não existem; descarte-as (ficam como pedido não registrado)
    out.push({ def: d, id, lots, mvs, first: startDay });
  }

  // Cenário: entrada lançada por engano e estornada (histórico de estornos)
  const reversals: { productIdx: number; day: number }[] = [
    { productIdx: 0, day: -41 },
    { productIdx: 7, day: -88 },
    { productIdx: 39, day: -23 },
    { productIdx: 30, day: -9 },
  ];
  for (const r of reversals) {
    const o = out[r.productIdx];
    if (!o) continue;
    const lot = [...o.lots].reverse().find((l) => l.createdDay < r.day) ?? o.lots[0];
    const qty = o.def.unit === "un" ? 2 : Math.round(o.def.lot * 0.05);
    const wrong = o.mvs.length;
    const orig: Mv = {
      id: randomUUID(), productId: o.id, lotId: lot.id, kind: "IN", delta: D(qty), unitCost: lot.cost === null ? null : D(lot.cost),
      occurredAt: new Date(`${shiftDay(today, r.day)}T15:10:00Z`), recordedAt: new Date(), actorId: "", actorName: "", originalResponsible: "Carlos Mendes",
      originalReference: "NF duplicada", consumptionConfirmed: true, notes: "Lançamento duplicado da mesma nota", source: "WEB", requestKey: randomUUID(),
    };
    const rev: Mv = {
      ...orig, id: randomUUID(), kind: "REVERSAL", delta: D(-qty), occurredAt: new Date(`${shiftDay(today, r.day)}T16:40:00Z`), reversalOf: orig.id,
      notes: "Estorno: entrada lançada em duplicidade", requestKey: randomUUID(), originalReference: null,
    };
    o.mvs.splice(wrong, 0, orig, rev);
    // saldo final inalterado (entrada + estorno); como o lote já existia no dia, tudo consistente
  }

  // Cenários de validade determinísticos (vencendo em breve / vencido com saldo).
  const expiry: [string, number][] = [
    ["Fungicida Fox Xpro (Bayer)", 17], ["Vacina aftosa (frasco 50 dose)", 9], ["Glifosato 480 g/L", 24], ["Ração para bezerros", 6],
    ["Ração para bezerros", -6], ["Óleo mineral (adjuvante)", -20], ["Semente de milho safrinha", -9], ["Inseticida Engeo Pleno S", -3],
  ];
  const touched = new Set<string>();
  for (const [name, offset] of expiry) {
    const o = out.find((x) => x.def.name === name);
    const withBalance = o?.lots.filter((l) => l.balance > 0 && !touched.has(l.id));
    // vencendo: lote mais novo; vencido: lote mais antigo
    const lot = offset > 0 ? withBalance?.at(-1) : withBalance?.find((l) => l.createdDay < offset - 5);
    if (!lot) continue;
    touched.add(lot.id);
    lot.expiresOn = shiftDay(today, offset);
  }

  // ---------- gravação ----------
  const result = await db.$transaction(
    async (tx) => {
      // limpa conta anterior (apenas as nossas)
      const old = await tx.user.findMany({ where: { email: { in: users.map((u) => u.email) } }, select: { id: true } });
      if (old.length) {
        const props = await tx.property.findMany({ where: { name: { startsWith: "Fazenda Santa Aurora" }, memberships: { some: { userId: { in: old.map((o) => o.id) } } } }, select: { id: true } });
        const ids = props.map((p) => p.id);
        await tx.administrativeEvent.deleteMany({ where: { OR: [{ propertyId: { in: ids } }, { userId: { in: old.map((o) => o.id) } }] } });
        await tx.property.deleteMany({ where: { id: { in: ids } } });
        await tx.user.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
      }
      const created: Record<string, string> = {};
      for (const u of users)
        created[u.key] = (
          await tx.user.create({ data: { name: u.name, email: u.email, passwordHash, emailVerifiedAt: new Date(), createdAt: new Date(shiftDay(today, -DAYS - 3) + "T12:00:00Z") } })
        ).id;
      const prop = await tx.property.create({
        data: {
          name: `Fazenda Santa Aurora`,
          responsible: "Rafael Almeida",
          timezone: tz,
          phone: "69992345678",
          startMethod: "MANUAL",
          inventoryRevision: 1,
          createdAt: new Date(shiftDay(today, -DAYS - 3) + "T12:00:00Z"),
          memberships: { create: users.map((u) => ({ userId: created[u.key], role: u.role })) },
        },
      });
      const cats = new Map((await tx.category.findMany({ where: { propertyId: prop.id } })).map((c) => [c.nameKey, c.id]));
      const actors = { admin: { id: created.admin, name: users[0].name }, op: { id: created.op, name: users[1].name } };
      const confirmedBy = created.admin;
      let created_n = 0;
      for (const o of out) {
        const d = o.def;
        const catId = cats.get(keyOf(d.cat));
        if (!catId) throw new Error(`Categoria ausente: ${d.cat}`);
        const hasHistory = d.rate > 0 && d.min !== null;
        await tx.product.create({
          data: {
            id: o.id,
            propertyId: prop.id,
            name: d.name,
            nameKey: keyOf(d.name),
            category: d.cat,
            categoryId: catId,
            unit: d.unit,
            minimum: D(d.min ?? 0),
            minimumKnown: d.min !== null,
            coverageStart: hasHistory ? new Date(shiftDay(today, o.first)) : null,
            coverageEnd: hasHistory ? new Date(shiftDay(today, -1)) : null,
            coverageOngoing: hasHistory && (d.stopUseAt === undefined),
            coverageConfirmedBy: hasHistory ? confirmedBy : null,
            leadTimeDays: d.lead,
            safetyDays: d.lead ? Math.round(d.lead / 3) : 0,
            archived: d.archived ?? false,
            createdAt: new Date(shiftDay(today, o.first) + "T11:00:00Z"),
          },
        });
        await tx.stockLot.createMany({
          data: o.lots.map((l) => ({
            id: l.id,
            productId: o.id,
            code: l.code,
            expiresOn: l.expiresOn ? new Date(l.expiresOn) : null,
            expiryStatus: l.expiresOn ? "DATED" : d.unknownExpiry ? "UNKNOWN" : "NA",
            unitCost: l.cost === null ? null : D(l.cost),
            supplier: l.supplier,
            balance: D(l.balance),
            createdAt: new Date(shiftDay(today, l.createdDay) + "T12:00:00Z"),
          })),
        });
        const sorted = [...o.mvs].sort((a, b) => +new Date(a.occurredAt) - +new Date(b.occurredAt));
        const rows = sorted.map((m) => {
          // Operador faz a maior parte das saídas; admin faz entradas, ajustes e estornos.
          const admin = m.kind !== "CONSUMPTION" || rnd() < 0.3;
          const a = m.kind === "ADJUST_IN" || m.kind === "ADJUST_OUT" || m.kind === "REVERSAL" || m.kind === "OPENING" ? actors.admin : admin ? actors.admin : actors.op;
          return { ...m, actorId: a.id, actorName: a.name, recordedAt: m.occurredAt } as Prisma.StockMovementCreateManyInput;
        });
        for (let i = 0; i < rows.length; i += 1000) await tx.stockMovement.createMany({ data: rows.slice(i, i + 1000) });
        created_n += rows.length;
      }
      return { property: prop.id, movements: created_n };
    },
    { timeout: 120000, maxWait: 20000 },
  );
  // Confere: saldo do lote = soma dos movimentos
  const mismatch = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) n FROM "StockLot" l WHERE l."productId" IN (SELECT id FROM "Product" WHERE "propertyId"=${result.property}::uuid) AND l.balance <> COALESCE((SELECT sum(delta) FROM "StockMovement" m WHERE m."lotId"=l.id),0)`;
  if (Number(mismatch[0].n) !== 0) throw new Error(`Saldos divergentes em ${mismatch[0].n} lote(s).`);

  await mkdir(folder, { recursive: true });
  await writeFile(manifest, JSON.stringify({ email: users[0].email, operatorEmail: users[1].email, viewerEmail: users[2].email, password, marker, propertyId: result.property }, null, 2), { mode: 0o600 });
  await processAnalysis(result.property);
  console.log(`Seed pronto: ${defs.length} produtos, ${result.movements} movimentações em ${DAYS} dias. Acesso em .private/rich.local.json.`);
}
main().finally(() => db.$disconnect());
