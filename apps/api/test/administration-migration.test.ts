import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import pg from "pg";
import { settings } from "../src/config";
import { keyOf } from "../src/stock-service";
test("migração em cópia sintética detecta colisão antes do cutover e preserva saldos, valores e papéis", async () => {
  const base = new URL(settings.databaseUrl);
  assert.equal(process.env.APP_ENV, "local");
  assert(["localhost", "127.0.0.1", "[::1]"].includes(base.hostname));
  const database = `agromind_migration7_${randomBytes(8).toString("hex")}`;
  assert.match(database, /^agromind_migration7_[a-f0-9]{16}$/);
  const admin = new pg.Client({ connectionString: settings.databaseUrl });
  await admin.connect();
  let copy: pg.Client | undefined;
  try {
    await admin.query(`CREATE DATABASE "${database}"`);
    const target = new URL(base);
    target.pathname = `/${database}`;
    copy = new pg.Client({ connectionString: target.toString() });
    await copy.connect();
    const root = new URL("../prisma/migrations/", import.meta.url),
      names = (await readdir(root)).filter((x) => /^\d/.test(x)).sort();
    for (const name of names.filter((x) => x < "20261022180000"))
      await copy.query(
        await readFile(new URL(`${name}/migration.sql`, root), "utf8"),
      );
    const user = randomUUID(),
      property = randomUUID(),
      first = randomUUID(),
      second = randomUUID(),
      lotA = randomUUID(),
      lotB = randomUUID();
    await copy.query(
      'INSERT INTO "User"(id,name,email,"passwordHash") VALUES($1,$2,$3,$4)',
      [
        user,
        "Pessoa sintética",
        "migration@example.test",
        "not-a-real-password",
      ],
    );
    await copy.query(
      'INSERT INTO "Property"(id,name,responsible,timezone,"startMethod","updatedAt") VALUES($1,$2,$3,$4,$5,now())',
      [property, "Cópia sintética", "Teste", "America/Cuiaba", "MANUAL"],
    );
    await copy.query(
      'INSERT INTO "Membership"("userId","propertyId",role) VALUES($1,$2,$3)',
      [user, property, "ADMIN"],
    );
    for (const [id, label, name, archived] of [
      [first, "Óleo-rural", "oleo a", false],
      [second, "oleo rural", "oleo b", true],
    ])
      await copy.query(
        'INSERT INTO "Product"(id,"propertyId",name,"nameKey",category,unit,archived,"updatedAt") VALUES($1,$2,$3,$3,$4,$5,$6,now())',
        [id, property, name, label, "L", archived],
      );
    for (const [id, product] of [
      [lotA, first],
      [lotB, second],
    ])
      await copy.query(
        'INSERT INTO "StockLot"(id,"productId",code,balance,"unitCost") VALUES($1,$2,$3,$4,$5)',
        [id, product, "L1", "10.125", "5.4321"],
      );
    for (const [lot, product] of [
      [lotA, first],
      [lotB, second],
    ])
      await copy.query(
        'INSERT INTO "StockMovement"(id,"productId","lotId",kind,delta,"unitCost","occurredAt","actorId","actorName",source,"requestKey") VALUES($1,$2,$3,$4,$5,$6,now(),$7,$8,$9,$10)',
        [
          randomUUID(),
          product,
          lot,
          "OPENING",
          "10.125",
          "5.4321",
          user,
          "Autor original",
          "WEB",
          randomUUID(),
        ],
      );
    const metrics = async () => {
      assert(copy);
      return (
        await copy.query(
          'SELECT (SELECT count(*)::text FROM "Product") products,(SELECT count(*)::text FROM "StockLot") lots,(SELECT count(*)::text FROM "StockMovement") movements,(SELECT sum(balance)::text FROM "StockLot") balance,(SELECT sum(balance*"unitCost")::text FROM "StockLot") value',
        )
      ).rows[0];
    };
    const before = await metrics(),
      sql = await readFile(
        new URL("20261022180000_administration/migration.sql", root),
        "utf8",
      );
    await assert.rejects(copy.query(sql), /CATEGORY_COLLISION/);
    await copy.query("ROLLBACK");
    assert.equal(
      (
        await copy.query(
          "SELECT to_regclass('public.\"Category\"') AS relation",
        )
      ).rows[0].relation,
      null,
    );
    assert.deepEqual(await metrics(), before);
    // Explicitly resolve the synthetic collision; no migration silently selects a spelling.
    await copy.query(
      'UPDATE "Product" SET category=$1 WHERE id=ANY($2::uuid[])',
      ["Óleo rural", [first, second]],
    );
    for (const name of names.filter((x) => x >= "20261022180000"))
      await copy.query(
        await readFile(new URL(`${name}/migration.sql`, root), "utf8"),
      );
    assert.deepEqual(await metrics(), before);
    assert.equal(
      (
        await copy.query('SELECT role FROM "Membership" WHERE "userId"=$1', [
          user,
        ])
      ).rows[0].role,
      "ADMIN",
    );
    const rows = (
      await copy.query('SELECT id,"categoryId" FROM "Product" ORDER BY id')
    ).rows;
    assert.equal(rows.length, 2);
    assert(rows.every((x) => x.categoryId));
    assert.equal(rows[0].categoryId, rows[1].categoryId);
    for (const name of [
      "Ação -- Rural",
      "straße rural",
      "Æther rural",
      "İrrigação",
      "µ óleo",
    ]) {
      const k: string = (
        await copy.query("SELECT agromind_category_key($1) key", [name])
      ).rows[0].key;
      assert.equal(k, keyOf(name));
    }
  } finally {
    await copy?.end();
    // Only the exact, freshly generated synthetic database is eligible for cleanup.
    assert.match(database, /^agromind_migration7_[a-f0-9]{16}$/);
    await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
    await admin.end();
  }
});
