export function ImportDataGuide() {
  return <section className="import-data-guide" aria-label="Dados para preparar seu estoque">
    <h3>O que preparar na sua planilha</h3>
    <p>O modelo de exemplo reúne estes dados dos insumos:</p>
    <ul>{["Nome do produto", "Categoria", "Quantidade em estoque", "Unidade (kg, L, un.)", "Estoque mínimo", "Custo por unidade"].map(field => <li key={field}>{field}</li>)}</ul>
    <p>Exemplos: diesel, fertilizantes, sementes e defensivos. Você também pode informar lote, validade e fornecedor. O histórico de movimentações tem um modelo próprio na área de importação.</p>
    <a href="/modelo-estoque.csv" download>Baixar planilha de exemplo <span aria-hidden="true">↗</span></a>
    <small>Você poderá corrigir os dados e selecionar os registros antes de confirmar. Custos ausentes continuam como não informados.</small>
  </section>;
}
