import type { ImportRow, InventoryView } from "./index";

// Import quantities have already been validated and normalized to at most three decimals.
const milli = (value: string) => {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole || "0") * 1000n + BigInt(fraction.padEnd(3, "0"));
};
const decimal = (value: bigint) => {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  return (
    sign +
    String(absolute / 1000n) +
    "." +
    String(absolute % 1000n).padStart(3, "0")
  );
};
export function reconcileImport(
  rows: ImportRow[],
  selected: number[],
  inventory: InventoryView,
) {
  const lines = new Set(selected);
  const grouped = new Map<
    string,
    {
      name: string;
      unit: string;
      before: bigint;
      incoming: bigint;
      outgoing: bigint;
      lines: number[];
    }
  >();
  for (const row of rows) {
    if (!lines.has(row.line) || row.errors.length) continue;
    const v = row.values,
      key =
        row.productId ||
        `${v.product
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, " ")
          .trim()}|${v.unit}`;
    const product = inventory.products.find((p) => p.id === row.productId);
    const entry = grouped.get(key) || {
      name: product?.name || v.product,
      unit: v.unit,
      before: milli(product?.balance || "0"),
      incoming: 0n,
      outgoing: 0n,
      lines: [],
    };
    const quantity = milli(v.quantity);
    if (["CONSUMPTION", "DISPOSAL", "ADJUST_OUT"].includes(v.kind))
      entry.outgoing += quantity;
    else entry.incoming += quantity;
    entry.lines.push(row.line);
    grouped.set(key, entry);
  }
  return [...grouped.entries()].map(([id, p]) => ({
    id,
    name: p.name,
    unit: p.unit,
    before: decimal(p.before),
    incoming: decimal(p.incoming),
    outgoing: decimal(p.outgoing),
    after: decimal(p.before + p.incoming - p.outgoing),
    lines: p.lines,
  }));
}
