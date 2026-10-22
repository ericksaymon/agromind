import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { db } from "./db";
import { Prisma } from "./generated/prisma/client";
import { failure } from "./security";
import {
  stockActor,
  validDay,
  decimal,
  checkUnitQuantity,
} from "./stock-service";
import { calculateAnalysis } from "./analysis-engine";
import { buildIntelligence } from "./intelligence-engine";
import { dateKey, shiftDay, dayStamp, RULE_VERSION } from "./analysis-common";
import { propertyPolicy } from "./analysis-policy";
import { projectInventory } from "./intelligence-projection";
import type {
  SimulationView,
  ProductAnalysis,
  AnalysisResult,
  IntelligenceView,
} from "../../../packages/contracts/src/index";
const id = Type.String({ format: "uuid" }),
  params = Type.Object({ propertyId: id });
const query = Type.Object(
  {
    from: Type.Optional(Type.String({ maxLength: 10 })),
    to: Type.Optional(Type.String({ maxLength: 10 })),
    grouping: Type.Optional(
      Type.Union([
        Type.Literal("DAY"),
        Type.Literal("WEEK"),
        Type.Literal("MONTH"),
      ]),
    ),
    productId: Type.Optional(id),
    category: Type.Optional(Type.String({ maxLength: 80 })),
    page: Type.Optional(Type.Integer({ minimum: 1, maximum: 100000 })),
    anomalyPage: Type.Optional(Type.Integer({ minimum: 1, maximum: 100000 })),
    horizonDays: Type.Optional(Type.Integer({ minimum: 1, maximum: 365 })),
  },
  { additionalProperties: false },
);
const simulation = Type.Object(
  {
    productId: id,
    horizonDays: Type.Integer({ minimum: 1, maximum: 365 }),
    consumptionPercent: Type.Integer({ minimum: -100, maximum: 500 }),
    quantity: Type.String({ minLength: 1, maxLength: 22 }),
    arrivalDay: Type.String({ maxLength: 10 }),
    expiryStatus: Type.Union([
      Type.Literal("NA"),
      Type.Literal("DATED"),
      Type.Literal("UNKNOWN"),
    ]),
    expiresOn: Type.Optional(Type.String({ maxLength: 10 })),
    unitCost: Type.Optional(Type.String({ maxLength: 22 })),
  },
  { additionalProperties: false },
);
export async function registerIntelligenceRoutes(app: FastifyInstance) {
  app.get<{ Params: Static<typeof params>; Querystring: Static<typeof query> }>(
    "/api/properties/:propertyId/intelligence",
    { schema: { params, querystring: query } },
    async (req) => {
      const actor = await stockActor(req, req.params.propertyId),
        q = req.query;
      return db.$transaction(
        async (tx) => {
          const p = await tx.property.findUniqueOrThrow({
              where: { id: actor.propertyId },
            }),
            policy = propertyPolicy(p),
            referenceDay = dateKey(new Date(), p.timezone);
          const to = q.to ?? shiftDay(referenceDay, -1),
            from =
              q.from ?? shiftDay(to, 1 - policy.intelligence!.comparisonDays);
          if (
            !validDay(from) ||
            !validDay(to) ||
            from > to ||
            to >= referenceDay ||
            dayStamp(to) - dayStamp(from) >= 365 ||
            from < "1901-01-01"
          )
            failure(
              400,
              "Escolha de 1 a 365 dias completos, encerrados até ontem.",
            );
          // Recusa explícita evita resultados truncados. A consulta de relatórios nunca omite movimentos silenciosamente.
          if (
            (await tx.stockMovement.count({
              where: { product: { propertyId: p.id } },
            })) > 50000
          )
            failure(
              413,
              "A base excede 50.000 movimentos para esta versão analítica. É necessário ampliar o processamento antes de analisar todos os dados.",
            );
          const products = await tx.product.findMany({
            where: { propertyId: p.id },
            include: { lots: true, movements: true },
            orderBy: { name: "asc" },
          });
          if (q.productId && !products.some((x) => x.id === q.productId))
            failure(404, "Produto não encontrado nesta propriedade.");
          const snapshot = await tx.analysisSnapshot.findUnique({
            where: {
              propertyId_revision_policyVersion_referenceDay_ruleVersion: {
                propertyId: p.id,
                revision: p.inventoryRevision,
                policyVersion: p.policyVersion,
                referenceDay,
                ruleVersion: RULE_VERSION,
              },
            },
          });
          const metrics = snapshot
            ? (snapshot.result as unknown as AnalysisResult).products
            : calculateAnalysis(
                products,
                referenceDay,
                p.timezone,
                p.inventoryRevision,
                policy,
              ).products;
          const selected = products.filter(
            (x) =>
              (!q.productId || x.id === q.productId) &&
              (!q.category || x.category === q.category),
          );
          const result = buildIntelligence(
            selected,
            metrics,
            referenceDay,
            p.timezone,
            p.inventoryRevision,
            policy,
            {
              from,
              to,
              grouping: q.grouping,
              horizonDays: q.horizonDays,
              propertyKnownValue: products
                .filter((x) => !x.archived)
                .flatMap((x) => x.lots.filter((l) => l.unitCost !== null))
                .reduce(
                  (sum, lot) => sum.plus(lot.balance.mul(lot.unitCost!)),
                  new Prisma.Decimal(0),
                )
                .toString(),
            },
          );
          const total = result.products.length,
            page = q.page ?? 1,
            anomalyPage = q.anomalyPage ?? 1;
          const anomalyRows = result.anomalies.slice(
              (anomalyPage - 1) * 20,
              anomalyPage * 20,
            ),
            anomalyTotal = result.anomalies.length;
          result.products = result.products
            .slice((page - 1) * 20, page * 20)
            .map((product) => ({
              ...product,
              prices: product.prices.slice(0, 20),
            }));
          result.anomalies = anomalyRows;
          const value: IntelligenceView = {
            result,
            page,
            pageSize: 20,
            total,
            options: {
              products: products.map((x) => ({
                id: x.id,
                name: x.name,
                category: x.category,
                unit: x.unit,
                archived: x.archived,
              })),
              categories: [...new Set(products.map((x) => x.category))].sort(),
            },
            anomalies: {
              total: anomalyTotal,
              page: anomalyPage,
              rows: anomalyRows,
            },
          };
          return value;
        },
        { isolationLevel: "RepeatableRead", timeout: 60000 },
      );
    },
  );
  app.post<{ Params: Static<typeof params>; Body: Static<typeof simulation> }>(
    "/api/properties/:propertyId/intelligence/simulate",
    { schema: { params, body: simulation } },
    async (req) => {
      const actor = await stockActor(req, req.params.propertyId),
        b = req.body;
      // Somente leitura: simulação não solicita reanálise, grava snapshot ou registra movimento.
      return db.$transaction(
        async (tx) => {
          const p = await tx.property.findUniqueOrThrow({
              where: { id: actor.propertyId },
            }),
            policy = propertyPolicy(p),
            referenceDay = dateKey(new Date(), p.timezone);
          const product = await tx.product.findFirst({
            where: { propertyId: p.id, id: b.productId, archived: false },
            include: { lots: true, movements: true },
          });
          if (!product)
            failure(404, "Produto ativo não encontrado nesta propriedade.");
          const quantity = decimal(b.quantity, "Reposição hipotética");
          checkUnitQuantity(product.unit, quantity);
          if (
            !validDay(b.arrivalDay) ||
            b.arrivalDay < referenceDay ||
            b.arrivalDay > shiftDay(referenceDay, 365)
          )
            failure(
              400,
              "A chegada hipotética precisa estar entre hoje e os próximos 365 dias.",
            );
          if (
            b.expiryStatus === "DATED" &&
            (!b.expiresOn ||
              !validDay(b.expiresOn) ||
              b.expiresOn < b.arrivalDay)
          )
            failure(
              400,
              "A validade da reposição deve ser igual ou posterior à chegada.",
            );
          const unitCost = b.unitCost?.trim()
            ? decimal(b.unitCost, "Custo hipotético", 4)
            : null;
          const snapshot = await tx.analysisSnapshot.findUnique({
            where: {
              propertyId_revision_policyVersion_referenceDay_ruleVersion: {
                propertyId: p.id,
                revision: p.inventoryRevision,
                policyVersion: p.policyVersion,
                referenceDay,
                ruleVersion: RULE_VERSION,
              },
            },
          });
          const metric: ProductAnalysis = snapshot
            ? (snapshot.result as unknown as AnalysisResult).products.find(
                (x) => x.id === product.id,
              )!
            : calculateAnalysis(
                [product],
                referenceDay,
                p.timezone,
                p.inventoryRevision,
                policy,
              ).products[0];
          const rate = metric?.dailyAverage
            ? new Prisma.Decimal(metric.dailyAverage)
            : null;
          const scenarioRate =
            rate?.mul(100 + b.consumptionPercent).div(100) ?? null;
          const limitations = [...(metric?.limitations ?? [])];
          limitations.push(
            "Cenário hipotético de ritmo constante em passos diários, a partir do saldo atual. Não cria movimentos ou pedidos. Consumo não atendido não é acumulado como encomenda.",
          );
          if (!rate)
            limitations.push(
              "Sem média positiva e cobertura suficiente: a projeção não foi calculada.",
            );
          if (b.expiryStatus === "UNKNOWN" && quantity.gt(0))
            limitations.push(
              "Reposição com validade desconhecida: quantidade excluída do saldo elegível simulado.",
            );
          if (scenarioRate?.eq(0))
            limitations.push(
              "Consumo hipotético zero: não há previsão de esgotamento por consumo; vencimentos continuam sendo considerados.",
            );
          const result: SimulationView = {
            productId: product.id,
            productName: product.name,
            unit: product.unit,
            revision: p.inventoryRevision,
            policyVersion: p.policyVersion,
            ruleVersion: RULE_VERSION,
            referenceDay,
            baselineRate: rate?.toString() ?? null,
            scenarioRate: scenarioRate?.toString() ?? null,
            limitations,
            baseline: rate
              ? projectInventory(
                  product.lots,
                  rate,
                  referenceDay,
                  b.horizonDays,
                )
              : null,
            scenario: scenarioRate
              ? projectInventory(
                  product.lots,
                  scenarioRate,
                  referenceDay,
                  b.horizonDays,
                  {
                    quantity: quantity.toString(),
                    day: b.arrivalDay,
                    expiryStatus: b.expiryStatus,
                    expiresOn: b.expiresOn,
                  },
                )
              : null,
            arrivalDay: b.arrivalDay,
            estimatedCost: unitCost ? quantity.mul(unitCost).toFixed(2) : null,
          };
          return result;
        },
        { isolationLevel: "RepeatableRead", timeout: 60000 },
      );
    },
  );
}
