import ExcelJS from "exceljs";
import { parse } from "csv-parse/sync";
import yauzl from "yauzl";
import { failure } from "./security";
import { dec, keyOf } from "./stock-service";
import {
  importFields,
  type ImportField,
  type ImportSheet,
} from "../../../packages/contracts/src/index";
export const fields = Object.keys(importFields) as ImportField[];
export function guessMapping(headers: string[]) {
  const aliases: Record<ImportField, string[]> = {
    product: ["produto", "nome", "insumo", "material", "descricao"],
    category: ["categoria", "grupo"],
    unit: ["unidade", "un", "medida"],
    quantity: ["quantidade", "qtd", "saldo", "estoque"],
    minimum: ["estoque minimo", "minimo"],
    unitCost: ["custo unitario", "preco unitario", "custo", "preco"],
    lot: ["lote", "numero lote"],
    expiry: ["validade", "data validade", "vencimento"],
    supplier: ["fornecedor"],
    kind: ["tipo", "operacao", "movimento", "tipo movimento"],
    date: ["data", "data movimento", "data do fato"],
    destination: ["destino", "destinacao"],
    notes: ["observacoes", "obs", "motivo"],
    reference: ["id", "referencia", "identificador", "codigo movimento"],
  };
  const result: Partial<Record<ImportField, number>> = {};
  for (const f of fields) {
    const index = headers.findIndex((h) => aliases[f].includes(keyOf(h)));
    if (index >= 0) result[f] = index;
  }
  return result;
}
async function inspectZip(buffer: Buffer) {
  await new Promise<void>((resolve, reject) =>
    yauzl.fromBuffer(
      buffer,
      { lazyEntries: true, validateEntrySizes: true },
      (error, zip) => {
        if (error || !zip) return reject(new Error("XLSX inválido."));
        let size = 0,
          count = 0,
          done = false;
        const fail = (e: Error) => {
          if (done) return;
          done = true;
          zip.close();
          reject(e);
        };
        zip.on("error", fail);
        zip.on("end", () => {
          if (!done) {
            done = true;
            resolve();
          }
        });
        zip.on("entry", (entry) => {
          if (
            ++count > 300 ||
            entry.uncompressedSize > 20_000_000 ||
            /vbaProject\.bin$/i.test(entry.fileName)
          )
            return fail(new Error("XLSX excede os limites ou contém macros."));
          zip.openReadStream(entry, (e, stream) => {
            if (e || !stream) return fail(new Error("XLSX inválido."));
            stream.on("error", fail);
            stream.on("data", (chunk) => {
              size += chunk.length;
              if (size > 20_000_000) {
                stream.destroy();
                fail(new Error("Conteúdo descompactado excede 20 MB."));
              }
            });
            stream.on("end", () => {
              if (!done) zip.readEntry();
            });
          });
        });
        zip.readEntry();
      },
    ),
  );
}
export async function readSheets(
  fileName: string,
  content: string,
): Promise<ImportSheet[]> {
  if (
    !/\.(csv|xlsx)$/i.test(fileName) ||
    fileName.length > 180 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(content)
  )
    failure(400, "Envie um arquivo CSV UTF-8 ou XLSX, com até 1 MB.");
  const buffer = Buffer.from(content, "base64");
  if (!buffer.length || buffer.length > 1_000_000)
    failure(400, "O arquivo deve ter até 1 MB.");
  let sheets: ImportSheet[] = [];
  try {
    if (/\.csv$/i.test(fileName)) {
      const input = new TextDecoder("utf-8", { fatal: true })
        .decode(buffer)
        .replace(/^\uFEFF/, "");
      const first = input.split(/\r?\n/)[0];
      const delimiter = first.includes(";")
        ? ";"
        : first.includes("\t")
          ? "\t"
          : ",";
      const rows = parse(input, {
        delimiter,
        bom: true,
        skip_empty_lines: true,
        max_record_size: 32000,
        relax_column_count: false,
      }) as string[][];
      sheets = [{ name: "CSV", headers: rows[0] || [], rows: rows.slice(1) }];
    } else {
      await inspectZip(buffer);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
      if (workbook.worksheets.length > 10) throw new Error("Use até 10 abas.");
      let total = 0;
      sheets = workbook.worksheets
        .filter((w) => w.actualRowCount > 0)
        .map((w) => {
          if (w.rowCount > 1001 || w.columnCount > 32)
            throw new Error("Use até 1.000 linhas e 32 colunas por arquivo.");
          const values: string[][] = [];
          w.eachRow((row) => {
            const cells: string[] = [];
            for (let i = 1; i <= w.columnCount; i++) {
              const value = row.getCell(i).value;
              if (
                value &&
                typeof value === "object" &&
                ("formula" in value || "sharedFormula" in value)
              )
                throw new Error(
                  "Substitua fórmulas por valores antes de importar.",
                );
              cells.push(
                value instanceof Date
                  ? value.toISOString().slice(0, 10)
                  : value === null
                    ? ""
                    : row.getCell(i).text,
              );
            }
            values.push(cells);
          });
          total += values.length - 1;
          if (total > 1000)
            throw new Error("Use até 1.000 linhas por arquivo.");
          return {
            name: w.name,
            headers: values[0] || [],
            rows: values.slice(1),
          };
        });
    }
    if (
      !sheets.length ||
      sheets.some(
        (s) =>
          !s.rows.length ||
          s.rows.length > 1000 ||
          s.headers.length > 32 ||
          s.headers.length < 2 ||
          s.headers.some((h) => !h.trim() || h.length > 120) ||
          s.rows.some(
            (r) =>
              r.length !== s.headers.length || r.some((c) => c.length > 500),
          ),
      )
    )
      throw new Error(
        "Use cabeçalho na primeira linha, até 1.000 registros, 32 colunas e 500 caracteres por célula.",
      );
  } catch (error) {
    failure(
      400,
      error instanceof Error
        ? `Não foi possível ler a planilha. ${error.message.slice(0, 250)}`
        : "Arquivo inválido.",
    );
  }
  return sheets;
}
export function importNumber(
  value: string,
  locale: "BR" | "DOT",
  scale = 3,
  required = true,
) {
  let v = value.trim();
  if (!v) {
    if (required) throw new Error("Quantidade não informada.");
    return "";
  }
  if (locale === "BR") {
    if (!/^\d+(,\d+)?$/.test(v) && !/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(v))
      throw new Error(
        `Número inválido: ${v}. Confira o formato decimal escolhido.`,
      );
    v = v.replaceAll(".", "").replace(",", ".");
  }
  if (!/^\d+(\.\d+)?$/.test(v)) throw new Error(`Número inválido: ${v}.`);
  const parts = v.split(".");
  if ((parts[1]?.length || 0) > scale || Number(v) > 999999999999)
    throw new Error(
      `Use até ${scale} casas decimais e valor até 999999999999.`,
    );
  return dec(v).toString();
}
export function importDate(value: string) {
  const v = value.trim();
  if (!v) return "";
  const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : v;
}
