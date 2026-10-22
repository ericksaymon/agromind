import { mkdir, writeFile } from "node:fs/promises";
import { db } from "../src/db";
import { keyOf } from "../src/stock-service";
try {
  const present = await db.$queryRaw<
    { table: string | null }[]
  >`SELECT to_regclass('public."Product"')::text AS table`;
  const products = present[0].table
    ? await db.product.findMany({
        select: { id: true, propertyId: true, category: true, archived: true },
        orderBy: [{ propertyId: "asc" }, { id: "asc" }],
      })
    : [];
  const groups = new Map<
    string,
    {
      propertyId: string;
      nameKey: string;
      variants: Set<string>;
      productIds: string[];
      archived: number;
    }
  >();
  for (const product of products) {
    const nameKey = keyOf(product.category),
      key = product.propertyId + ":" + nameKey;
    let group = groups.get(key);
    if (!group) {
      group = {
        propertyId: product.propertyId,
        nameKey,
        variants: new Set(),
        productIds: [],
        archived: 0,
      };
      groups.set(key, group);
    }
    group.variants.add(product.category);
    group.productIds.push(product.id);
    if (product.archived) group.archived++;
  }
  const mapping = [...groups.values()].map((g) => ({
      ...g,
      variants: [...g.variants],
    })),
    collisions = mapping.filter((g) => g.variants.length > 1 || !g.nameKey);
  const root = new URL("../../../outputs/", import.meta.url);
  await mkdir(root, { recursive: true });
  const report = new URL("etapa-7-category-preflight.json", root);
  await writeFile(
    report,
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        schemaInitialized: !!present[0].table,
        products: products.length,
        mapping,
        collisions,
        action:
          "Não fundir automaticamente. Resolver cada colisão explicitamente antes de aplicar a migration. O corte SQL também verifica colisões conservadoras de transliteração do legado.",
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(
    `Pré-validação: ${products.length} produtos, ${collisions.length} colisões. Mapa local em outputs/etapa-7-category-preflight.json.`,
  );
  if (collisions.length) process.exitCode = 1;
} catch {
  console.error(
    "Não foi possível concluir a pré-validação de categorias. Confira a disponibilidade do banco e execute novamente.",
  );
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
