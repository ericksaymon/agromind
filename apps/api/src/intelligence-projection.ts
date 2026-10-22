import { Prisma } from "./generated/prisma/client";
import type { StockLot } from "./generated/prisma/client";
import { shiftDay } from "./analysis-common";
import type { ProjectionResult } from "../../../packages/contracts/src/index";
const D = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v);
export interface HypotheticalArrival {
  quantity: string;
  day: string;
  expiryStatus: "NA" | "DATED" | "UNKNOWN";
  expiresOn?: string;
}
export function projectInventory(
  lots: StockLot[],
  rate: Prisma.Decimal,
  referenceDay: string,
  days: number,
  arrival?: HypotheticalArrival,
): ProjectionResult {
  const stock = lots
    .filter(
      (l) =>
        l.balance.gt(0) &&
        (l.expiryStatus === "NA" ||
          (l.expiryStatus === "DATED" &&
            l.expiresOn &&
            l.expiresOn.toISOString().slice(0, 10) >= referenceDay)),
    )
    .map((l) => ({
      id: l.id,
      balance: D(l.balance),
      expiry:
        l.expiryStatus === "DATED"
          ? l.expiresOn!.toISOString().slice(0, 10)
          : null,
      order: l.createdAt.getTime(),
    }));
  const result: ProjectionResult = {
    points: [],
    closingBalance: "0",
    expiredQuantity: "0",
    unmetQuantity: "0",
    shortageDays: 0,
    firstShortageDay: null,
    unmetBeforeArrival: "0",
  };
  let expired = D(0),
    unmet = D(0),
    before = D(0);
  for (let i = 0; i < days; i++) {
    const day = shiftDay(referenceDay, i);
    let expiredToday = D(0),
      arrived = D(0);
    for (const l of stock)
      if (l.expiry && l.expiry < day && l.balance.gt(0)) {
        expiredToday = expiredToday.plus(l.balance);
        l.balance = D(0);
      }
    if (arrival?.day === day && arrival.expiryStatus !== "UNKNOWN") {
      arrived = D(arrival.quantity);
      stock.push({
        id: "hypothetical",
        balance: arrived,
        expiry: arrival.expiryStatus === "DATED" ? arrival.expiresOn! : null,
        order: Number.MAX_SAFE_INTEGER,
      });
    }
    stock.sort(
      (a, b) =>
        (a.expiry ?? "9999").localeCompare(b.expiry ?? "9999") ||
        a.order - b.order ||
        a.id.localeCompare(b.id),
    );
    let remaining = rate;
    for (const l of stock) {
      if (remaining.lte(0)) break;
      const used = Prisma.Decimal.min(l.balance, remaining);
      l.balance = l.balance.minus(used);
      remaining = remaining.minus(used);
    }
    if (remaining.gt(0)) {
      result.shortageDays++;
      result.firstShortageDay ??= day;
    }
    if (arrival && day < arrival.day) before = before.plus(remaining);
    expired = expired.plus(expiredToday);
    unmet = unmet.plus(remaining);
    result.points.push({
      day,
      balance: stock.reduce((s, l) => s.plus(l.balance), D(0)).toString(),
      demand: rate.toString(),
      used: rate.minus(remaining).toString(),
      unmet: remaining.toString(),
      expired: expiredToday.toString(),
      arrival: arrived.toString(),
    });
  }
  result.closingBalance = result.points.at(-1)?.balance ?? "0";
  result.expiredQuantity = expired.toString();
  result.unmetQuantity = unmet.toString();
  result.unmetBeforeArrival = before.toString();
  return result;
}
