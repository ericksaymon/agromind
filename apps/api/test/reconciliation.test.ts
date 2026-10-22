import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcileImport } from "../../../packages/contracts/src/reconciliation";
import type {
  ImportRow,
  InventoryView,
} from "../../../packages/contracts/src/index";
const inventory = {
  revision: 1,
  products: [{ id: "diesel", name: "Diesel", balance: "420.001" }],
} as InventoryView;
const row = (
  line: number,
  quantity: string,
  kind = "CONSUMPTION",
  productId: string | null = "diesel",
) =>
  ({
    line,
    productId,
    values: { quantity, kind, product: "Diesel", unit: "L" },
    errors: [],
  }) as unknown as ImportRow;
test("conciliação respeita seleção, entradas, retiradas e precisão de três casas", () => {
  const rows = [
    row(2, "150.001"),
    row(3, "200", "IN"),
    row(4, "300"),
    { ...row(5, "10"), errors: ["inválida"] },
  ];
  const result = reconcileImport(rows, [2, 3, 5], inventory)[0];
  assert.equal(result.before, "420.001");
  assert.equal(result.after, "470.000");
  assert.deepEqual(result.lines, [2, 3]);
});
test("posição nova e saldo negativo não são confundidos com referência externa", () => {
  assert.equal(
    reconcileImport([row(2, "0", "OPENING", null)], [2], inventory)[0].after,
    "0.000",
  );
  assert.equal(
    reconcileImport([row(2, "500")], [2], inventory)[0].after,
    "-79.999",
  );
  const first = row(2, "1", "OPENING", null);
  const second = row(3, "2", "OPENING", null);
  first.values.product = "Semente-de milho";
  second.values.product = "  Semente de  milho  ";
  const combined = reconcileImport([first, second], [2, 3], inventory);
  assert.equal(combined.length, 1);
  assert.equal(combined[0].after, "3.000");
});
