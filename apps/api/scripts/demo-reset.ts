import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import argon2 from "argon2";
import { settings } from "../src/config";
import { db } from "../src/db";
import { dateKey } from "../src/analysis-common";
import { demoFixture } from "../src/demo-fixture";
import { processAnalysis } from "../src/analysis-service";
import {keyOf} from "../src/stock-service";
const folder = new URL("../../../.private/", import.meta.url);
const manifest = new URL("demo.local.json", folder);
type Manifest = {
  userId: string;
  email: string;
  password: string;
  propertyIds: string[];
  marker: string;
};
try {
  if (
    process.env.APP_ENV !== "local" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(
      new URL(settings.databaseUrl).hostname,
    )
  )
    throw new Error(
      "A demonstração reinicializável exige APP_ENV=local e banco em loopback.",
    );
  let previous: Manifest | null = null;
  try {
    previous = JSON.parse(await readFile(manifest, "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const email =
    previous?.email || `demo-${randomBytes(5).toString("hex")}@agromind.local`;
  const password =
    previous?.password || `Agro9-${randomBytes(16).toString("base64url")}`;
  const marker = previous?.marker || randomBytes(12).toString("hex");
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const result = await db.$transaction(
    async (tx) => {
      if (previous) {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id=${previous.userId}::uuid FOR UPDATE`;
        const owner = await tx.user.findUnique({
          where: { id: previous.userId },
        });
        if (owner?.email !== email)
          throw new Error(
            "O proprietário da demonstração diverge do manifesto. Nenhum dado foi apagado.",
          );
        for (const id of [...previous.propertyIds].sort()) {
          await tx.$queryRaw`SELECT id FROM "Property" WHERE id = ${id}::uuid FOR UPDATE`;
          const p = await tx.property.findUnique({
            where: { id },
            include: { memberships: true },
          });
          if (
            p &&
            (!p.name.endsWith(`[${marker}]`) ||
              p.memberships.length !== 1 ||
              p.memberships[0].userId !== previous.userId)
          )
            throw new Error(
              "A propriedade deixou de ser uma demonstração isolada. Reinicialização bloqueada.",
            );
        }
        await tx.administrativeEvent.deleteMany({ where: { propertyId: { in: previous.propertyIds } } });
        await tx.property.deleteMany({
          where: { id: { in: previous.propertyIds } },
        });
        await tx.session.deleteMany({ where: { userId: previous.userId } });
      }
      const user = previous
        ? await tx.user.update({
            where: { id: previous.userId },
            data: { passwordHash },
          })
        : await tx.user.create({
            data: {
              name: "Demonstração AgroMind",
              email,
              passwordHash,
              emailVerifiedAt: new Date(),
            },
          });
      const first = await tx.property.create({
        data: {
          name: `Fazenda demonstrativa [${marker}]`,
          responsible: "João Exemplo",
          timezone: "America/Cuiaba",
          startMethod: "MANUAL",
          inventoryRevision: 1,
          memberships: { create: { userId: user.id, role: "ADMIN" } },
        },
      });
      const second = await tx.property.create({
        data: {
          name: `Segunda propriedade fictícia [${marker}]`,
          responsible: "Maria Exemplo",
          timezone: "America/Cuiaba",
          startMethod: "MANUAL",
          memberships: { create: { userId: user.id, role: "ADMIN" } },
        },
      });
      const fixture = demoFixture(
        first.id,
        user.id,
        dateKey(new Date(), first.timezone),
      );
      for (const p of fixture) {
        const { lots, movements, ...product } = p;
        const category=await tx.category.upsert({where:{propertyId_nameKey:{propertyId:first.id,nameKey:keyOf(p.category)}},create:{propertyId:first.id,name:p.category,nameKey:keyOf(p.category)},update:{}});
        await tx.product.create({ data: {...product,categoryId:category.id} });
        await tx.stockLot.createMany({ data: lots });
        await tx.stockMovement.createMany({
          data: movements.map(({ sequence: _sequence, ...m }) => m),
        });
      }
      return {
        userId: user.id,
        email,
        password,
        marker,
        propertyIds: [first.id, second.id],
      };
    },
    { timeout: 30000 },
  );
  await mkdir(folder, { recursive: true });
  await writeFile(manifest, JSON.stringify(result, null, 2), { mode: 0o600 });
  for (const id of result.propertyIds) await processAnalysis(id);
  console.log(
    "Demonstração operacional pronta: 6 produtos, 2 propriedades isoladas. Acesso em .private/demo.local.json. Nenhuma credencial foi impressa.",
  );
} finally {
  await db.$disconnect();
}
