import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app";
import { db } from "../src/db";
import { digest, randomToken, sessionCookie } from "../src/security";
import { settings } from "../src/config";
import { guessMapping, readSheets } from "../src/import-parser";
import ExcelJS from "exceljs";
let app: Awaited<ReturnType<typeof buildApp>>;
const users: string[] = [],
  properties: string[] = [];
class Client {
  cookies = new Map<string, string>();
  csrf = "";
  constructor(public userId: string) {}
  async init() {
    const token = randomToken();
    await db.session.create({
      data: {
        userId: this.userId,
        tokenHash: digest(token),
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
    this.cookies.set(sessionCookie, token);
    const r = await this.get("/api/auth/csrf");
    this.csrf = r.json().token;
    return this;
  }
  async req(method: "GET" | "POST", url: string, body?: unknown) {
    const r = await app.inject({
      method,
      url,
      payload: body as object,
      headers: {
        cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "),
        ...(method === "POST"
          ? { origin: settings.origin, "x-csrf-token": this.csrf }
          : {}),
      },
    });
    for (const c of r.cookies) this.cookies.set(c.name, c.value);
    return r;
  }
  get(url: string) {
    return this.req("GET", url);
  }
  post(url: string, body: unknown) {
    return this.req("POST", url, body);
  }
}
let admin: Client, viewer: Client, outsider: Client, operator: Client;
async function property() {
  const p = await db.property.create({
    data: {
      name: "Estoque sintético",
      responsible: "Teste",
      timezone: "America/Cuiaba",
      startMethod: "MANUAL",
      memberships: {
        create: [
          { userId: admin.userId, role: "ADMIN" },
          { userId: viewer.userId, role: "VIEWER" },
          { userId: operator.userId, role: "OPERATOR" },
        ],
      },
    },
  });
  properties.push(p.id);
  return `/api/properties/${p.id}`;
}
async function revision(base: string) {
  return (await admin.get(base + "/inventory")).json().revision as number;
}
async function product(base: string, name = "Diesel S10", unit = "L") {
  const r = await admin.post(base + "/products", {
    key: randomUUID(),
    revision: await revision(base),
    name,
    category: "Combustíveis",
    unit,
    minimum: "10",
    acknowledgeSimilar: true,
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json().id as string;
}
async function move(
  base: string,
  productId: string,
  extra: Record<string, unknown> = {},
  client = admin,
) {
  return client.post(base + "/movements", {
    key: randomUUID(),
    revision: await revision(base),
    productId,
    kind: "IN",
    quantity: "100",
    occurredAt: "2026-10-01",
    ...(extra.lotId
      ? {}
      : { lot: { code: "LOTE-01", expiryStatus: "NA", unitCost: "6.10" } }),
    ...extra,
  });
}
async function upload(base: string, text: string, mode = "POSITION") {
  const r = await admin.post(base + "/imports", {
    fileName: "teste.csv",
    content: Buffer.from(text).toString("base64"),
    mode,
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
}
async function preview(
  base: string,
  batch: { id: string; sheets: { headers: string[] }[] },
  extra: Record<string, unknown> = {},
) {
  return admin.post(`${base}/imports/${batch.id}/preview`, {
    sheet: 0,
    mapping: guessMapping(batch.sheets[0].headers),
    locale: "BR",
    positionDate: "2026-10-01",
    edits: [],
    ...extra,
  });
}
async function confirm(
  base: string,
  batch: {
    id: string;
    previewToken: string;
    rows: { line: number; errors: string[]; duplicate: boolean }[];
  },
  extra: Record<string, unknown> = {},
) {
  return admin.post(`${base}/imports/${batch.id}/confirm`, {
    previewToken: batch.previewToken,
    lines: batch.rows
      .filter((r) => !r.errors.length && !r.duplicate)
      .map((r) => r.line),
    acknowledgeWarnings: true,
    allowDuplicates: false,
    ...extra,
  });
}
before(async () => {
  app = await buildApp({ test: true });
  for (let i = 0; i < 4; i++) {
    const u = await db.user.create({
      data: {
        name: "Pessoa sintética",
        email: `stock-${randomUUID()}@example.test`,
        passwordHash: "unused-test-hash",
        emailVerifiedAt: new Date(),
      },
    });
    users.push(u.id);
  }
  [admin, viewer, outsider, operator] = await Promise.all(
    users.map((id) => new Client(id).init()),
  );
});
after(async () => {
  await db.property.deleteMany({ where: { id: { in: properties } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  await app.close();
  await db.$disconnect();
});
test("estoque transacional: permissões, precisão, idempotência, concorrência, validade e estorno", async () => {
  const base = await property(),
    id = await product(base);
  let r = await move(base, id, { kind: "OPENING" });
  assert.equal(r.statusCode, 201, r.body);
  let inv = (await admin.get(base + "/inventory")).json();
  const lot = inv.products[0].lots[0].id;
  assert.equal(inv.products[0].balance, "100");
  assert.equal(inv.products[0].knownValue, "610.00");
  assert.equal((await outsider.get(base + "/inventory")).statusCode, 404);
  assert.equal((await viewer.get(base + "/inventory")).statusCode, 200);
  assert.equal(
    (
      await move(
        base,
        id,
        {
          lotId: lot,
          kind: "CONSUMPTION",
          quantity: "1",
          destination: "Trator",
        },
        viewer,
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await move(
        base,
        id,
        { lotId: lot, kind: "ADJUST_OUT", quantity: "1", notes: "Conferência" },
        operator,
      )
    ).statusCode,
    403,
  );
  const payload = {
    key: randomUUID(),
    revision: await revision(base),
    productId: id,
    lotId: lot,
    kind: "CONSUMPTION",
    quantity: "60",
    occurredAt: "2026-10-02",
    destination: "Trator 1",
  };
  const contenders = [payload, { ...payload, key: randomUUID() }];
  const race = await Promise.all(
    contenders.map((request) => admin.post(base + "/movements", request)),
  );
  assert.deepEqual(race.map((r) => r.statusCode).sort(), [201, 409]);
  const winner = race.findIndex((r) => r.statusCode === 201);
  const saved = race[winner].json();
  const acceptedPayload = contenders[winner];
  assert.equal(
    (await admin.post(base + "/movements", acceptedPayload)).statusCode,
    201,
  );
  assert.equal(
    (await admin.post(base + "/movements", { ...acceptedPayload, quantity: "1" }))
      .statusCode,
    409,
  );
  inv = (await admin.get(base + "/inventory")).json();
  assert.equal(inv.products[0].balance, "40");
  assert.equal(await db.stockMovement.count({ where: { productId: id } }), 2);
  assert.equal(
    (
      await move(base, id, {
        lotId: lot,
        quantity: "50",
        kind: "CONSUMPTION",
        destination: "Trator",
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await move(base, id, {
        lotId: lot,
        quantity: "1",
        kind: "CONSUMPTION",
        destination: "Trator",
        occurredAt: "2026-09-01",
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (await move(base, id, { lotId: lot, quantity: "0", kind: "IN" }))
      .statusCode,
    400,
  );
  assert.equal(
    (await move(base, id, { lotId: lot, quantity: "0.0001", kind: "IN" }))
      .statusCode,
    400,
  );
  assert.equal(
    (
      await move(base, id, {
        lotId: lot,
        quantity: "1",
        kind: "IN",
        lot: { code: "LOTE-01", expiryStatus: "NA", unitCost: "7" },
      })
    ).statusCode,
    400,
  );
  const reverseBody = {
    key: randomUUID(),
    revision: await revision(base),
    notes: "Retirada lançada incorretamente",
  };
  r = await admin.post(`${base}/movements/${saved.id}/reverse`, reverseBody);
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(
    (await admin.post(`${base}/movements/${saved.id}/reverse`, reverseBody))
      .statusCode,
    200,
  );
  assert.equal(
    (
      await admin.post(`${base}/movements/${saved.id}/reverse`, {
        ...reverseBody,
        key: randomUUID(),
        revision: await revision(base),
      })
    ).statusCode,
    409,
  );
  inv = (await admin.get(base + "/inventory")).json();
  assert.equal(inv.products[0].balance, "100");
  r = await move(base, id, {
    quantity: "10",
    lot: { code: "VENCIDO", expiryStatus: "DATED", expiresOn: "2026-09-01" },
    occurredAt: "2026-08-01",
  });
  assert.equal(r.statusCode, 201, r.body);
  inv = (await admin.get(base + "/inventory")).json();
  const expired = inv.products[0].lots.find(
    (l: { code: string }) => l.code === "VENCIDO",
  ).id;
  assert.equal(
    (
      await move(base, id, {
        kind: "CONSUMPTION",
        lotId: expired,
        quantity: "1",
        destination: "Trator",
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await move(base, id, {
        kind: "DISPOSAL",
        lotId: expired,
        quantity: "10",
        notes: "Lote vencido na conferência",
      })
    ).statusCode,
    201,
  );
  assert.equal(
    (await admin.get(base + "/inventory")).json().products[0].unpricedBalance,
    "0",
  );
  const edit = {
    key: randomUUID(),
    revision: await revision(base),
    name: "Diesel S10",
    category: "Combustíveis",
    unit: "kg",
    minimum: "10",
  };
  assert.equal(
    (await admin.post(`${base}/products/${id}/update`, edit)).statusCode,
    400,
  );
  assert.equal(
    (
      await admin.post(`${base}/products/${id}/archive`, {
        key: randomUUID(),
        revision: await revision(base),
        archived: true,
      })
    ).statusCode,
    400,
  );
  const piece = await product(base, "Filtro trator", "un");
  assert.equal((await move(base, piece, { quantity: "1.5" })).statusCode, 400);
});
test("importação: posição brasileira, correção, revisão, duplicidades e cancelamento", async () => {
  const base = await property();
  const raw =
    "produto;categoria;quantidade;unidade;estoque_minimo;custo_unitario;lote;validade\nAdubo;Fertilizantes;1.250,500;kg;100;3,8000;AD-01;N/A\nSemente;Sementes;abc;kg;10;;SE-01;\n";
  const draft = await upload(base, raw);
  const pr = await preview(base, draft);
  assert.equal(pr.statusCode, 200, pr.body);
  let p = pr.json();
  assert.equal(p.rows[0].values.quantity, "1250.5");
  assert.equal(p.rows[0].values.unitCost, "3.8");
  assert(p.rows[1].errors.length > 0);
  assert.equal(
    (await admin.get(base + "/inventory")).json().products.length,
    0,
  );
  const corrected = await preview(base, draft, {
    edits: [{ line: 3, values: { quantity: "20" } }],
  });
  assert.equal(corrected.statusCode, 200, corrected.body);
  p = corrected.json();
  assert.equal(p.rows[1].errors.length, 0);
  const result = await confirm(base, p);
  assert.equal(result.statusCode, 200, result.body);
  assert.equal(result.json().result.imported, 2);
  assert.equal((await confirm(base, p)).json().result.imported, 2);
  const inv = (await admin.get(base + "/inventory")).json();
  assert.equal(
    inv.products.find((v: { name: string }) => v.name === "Adubo").balance,
    "1250.5",
  );
  assert.equal(
    inv.products.find((v: { name: string }) => v.name === "Semente")
      .unpricedBalance,
    "20",
  );
  const duplicate = await upload(base, raw);
  assert.equal(duplicate.fileRepeated, true);
  const dp = (await preview(base, duplicate)).json();
  assert(dp.rows[0].errors.length > 0);
  assert.equal(dp.rows[0].duplicate, true);
  const cancelled = await upload(
    base,
    "produto;quantidade;unidade\nOutro;2;L\n",
  );
  assert.equal(
    (await admin.post(`${base}/imports/${cancelled.id}/cancel`, {})).statusCode,
    200,
  );
  assert.deepEqual(
    (await db.importBatch.findUniqueOrThrow({ where: { id: cancelled.id } }))
      .raw,
    [],
  );
  assert.equal((await outsider.get(`${base}/imports/${p.id}`)).statusCode, 404);
  assert.equal(
    (
      await viewer.post(`${base}/imports`, {
        fileName: "x.csv",
        content: Buffer.from(raw).toString("base64"),
        mode: "POSITION",
      })
    ).statusCode,
    403,
  );
});
test("histórico importado, conciliação, falha atômica, prévia antiga e preço por lote", async () => {
  const base = await property();
  const header =
    "produto;quantidade;unidade;tipo;data;lote;custo_unitario;destino;referencia\n";
  let draft = await upload(
    base,
    header +
      "Diesel;100;L;abertura;01/10/2026;D1;6,10;;A1\nDiesel;30;L;consumo;02/10/2026;D1;;Trator;A2\n",
    "HISTORY",
  );
  let p = (await preview(base, draft)).json();
  let r = await confirm(base, p);
  assert.equal(r.statusCode, 200, r.body);
  let inv = (await admin.get(base + "/inventory")).json();
  assert.equal(inv.products[0].balance, "70");
  assert.equal(
    await db.stockMovement.count({ where: { productId: inv.products[0].id } }),
    2,
  );
  draft = await upload(
    base,
    header +
      "Diesel;999;L;consumo;03/10/2026;D1;;Trator;A3\nAgua;4;L;entrada;01/10/2026;AG1;;;B1\n",
    "HISTORY",
  );
  p = (await preview(base, draft)).json();
  r = await confirm(base, p);
  assert.equal(r.statusCode, 409, r.body);
  assert.equal(
    (await admin.get(base + "/inventory")).json().products.length,
    1,
  );
  draft = await upload(
    base,
    header + "Diesel;30;L;consumo;02/10/2026;D1;;Trator;A2\n",
    "HISTORY",
  );
  p = (await preview(base, draft)).json();
  assert.equal(p.rows[0].duplicate, true);
  assert.equal((await confirm(base, p, { lines: [2] })).statusCode, 409);
  assert.equal(
    (await confirm(base, p, { lines: [2], allowDuplicates: true })).statusCode,
    200,
  );
  draft = await upload(
    base,
    "produto;quantidade;unidade;lote;custo_unitario\nCal;20;kg;CA1;\n",
  );
  p = (await preview(base, draft)).json();
  await product(base, "Filtro novo", "un");
  assert.equal((await confirm(base, p)).statusCode, 409);
  p = (await preview(base, draft)).json();
  assert.equal((await confirm(base, p)).statusCode, 200);
  inv = (await admin.get(base + "/inventory")).json();
  const diesel = inv.products.find(
    (p: { name: string }) => p.name === "Diesel",
  );
  r = await move(base, diesel.id, {
    quantity: "10",
    occurredAt: "2026-10-03",
    lot: { code: "D2", expiryStatus: "NA", unitCost: "7.00" },
  });
  assert.equal(r.statusCode, 201, r.body);
  inv = (await admin.get(base + "/inventory")).json();
  assert.equal(
    inv.products.find((p: { name: string }) => p.name === "Diesel").knownValue,
    "314.00",
  );
});
test("XLSX: múltiplas abas, datas e bloqueio de fórmulas; CSV malformado", async () => {
  const wb = new ExcelJS.Workbook();
  const w = wb.addWorksheet("Estoque");
  w.addRow(["produto", "quantidade", "unidade"]);
  w.addRow(["Diesel", 20, "L"]);
  const w2 = wb.addWorksheet("Outra");
  w2.addRow(["produto", "quantidade"]);
  w2.addRow(["Semente", 4]);
  let bytes = await wb.xlsx.writeBuffer();
  let sheets = await readSheets(
    "estoque.xlsx",
    Buffer.from(bytes).toString("base64"),
  );
  assert.equal(sheets.length, 2);
  assert.equal(sheets[0].rows[0][1], "20");
  w.getCell("B2").value = { formula: "1+1", result: 2 };
  bytes = await wb.xlsx.writeBuffer();
  await assert.rejects(
    () => readSheets("x.xlsx", Buffer.from(bytes).toString("base64")),
    /fórmulas/,
  );
  await assert.rejects(() =>
    readSheets("x.csv", Buffer.from("a,b\n1,2,3").toString("base64")),
  );
  await assert.rejects(() => readSheets("x.xlsm", "aGVsbG8="));
});

test("posição com saldo zero preserva cadastro e ausência de custo sem gerar movimento nulo", async () => {
  const base = await property();
  const draft = await upload(
    base,
    "produto;quantidade;unidade;estoque_minimo\nAdubo sem saldo;0;kg;100\n",
  );
  const pr = await preview(base, draft);
  assert.equal(pr.statusCode, 200, pr.body);
  const p = pr.json();
  assert.equal(p.rows[0].errors.length, 0);
  const result = await confirm(base, p);
  assert.equal(result.statusCode, 200, result.body);
  assert.equal(result.json().result.imported, 1);
  assert.equal(result.json().result.movementIds.length, 0);
  const inv = (await admin.get(base + "/inventory")).json();
  assert.equal(inv.products[0].balance, "0");
  assert.equal(inv.products[0].lots[0].unitCost, null);
  const archive = {
    key: randomUUID(),
    revision: await revision(base),
    archived: true,
  };
  assert.equal(
    (
      await admin.post(
        `${base}/products/${inv.products[0].id}/archive`,
        archive,
      )
    ).statusCode,
    200,
  );
});

test('limite de 1.000 movimentos no mesmo dia mantém ordem e saldo sem validação quadrática',async()=>{
 const base=await property();const header='produto;quantidade;unidade;tipo;data;lote;destino;referencia\n';
 const lines=['Carga;1000;L;abertura;01/10/2026;C1;;carga-0',...Array.from({length:999},(_,i)=>`Carga;1;L;consumo;01/10/2026;C1;Trator;carga-${i+1}`)];
 const draft=await upload(base,header+lines.join('\n'),'HISTORY');const pr=await preview(base,draft);assert.equal(pr.statusCode,200,pr.body);const p=pr.json();assert.equal(p.rows.length,1000);
 const r=await confirm(base,p);assert.equal(r.statusCode,200,r.body);assert.equal(r.json().result.imported,1000);
 const inv=(await admin.get(base+'/inventory')).json();assert.equal(inv.products[0].balance,'1');
 const history=(await admin.get(base+'/movements')).json();assert.equal(history.total,1000);assert.equal(history.rows[0].id,r.json().result.movementIds[999]);
});
