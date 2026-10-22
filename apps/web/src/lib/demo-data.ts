export type DemoView = "overview" | "stock" | "diesel" | "expiry";

export const products = [
  { id: "diesel", name: "Diesel S10", category: "Combustíveis", unit: "L", quantity: 420, minimum: 300, daily: 60, cost: 6.1, status: "Reposição em breve" },
  { id: "npk", name: "Fertilizante NPK", category: "Fertilizantes", unit: "kg", quantity: 120, minimum: 200, daily: 10, cost: 3.8, status: "Abaixo do mínimo" },
  { id: "herbicide", name: "Herbicida", category: "Defensivos", unit: "L", quantity: 40, minimum: 10, daily: 0.8, cost: 88, status: "Vence em 15 dias" },
  { id: "seeds", name: "Sementes de milho", category: "Sementes", unit: "kg", quantity: 350, minimum: 100, daily: 12, cost: 12.8, status: "Regular" },
  { id: "oil", name: "Óleo hidráulico", category: "Lubrificantes", unit: "L", quantity: 80, minimum: 30, daily: 2, cost: 24.5, status: "Regular" },
  { id: "limestone", name: "Calcário agrícola", category: "Corretivos", unit: "kg", quantity: 2400, minimum: 500, daily: 100, cost: 0.65, status: "Regular" },
] as const;

export const questions: { view: DemoView; label: string; note: string }[] = [
  { view: "overview", label: "O que preciso comprar?", note: "Veja as prioridades de reposição e os dados que explicam cada recomendação." },
  { view: "diesel", label: "Quanto diesel ainda temos?", note: "Consulte o saldo, acompanhe o consumo e experimente uma retirada de exemplo." },
  { view: "expiry", label: "O que está perto de vencer?", note: "Confira o lote, a validade e a quantidade que merece atenção." },
];

export const dailyConsumption = [45, 75, 60, 30, 90, 50, 70];
export const formatNumber = (value: number, digits = 0) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: digits }).format(value);
export const formatCurrency = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(value);

export const faq = [
  ["Para quem é o AgroMind?", "Para produtores rurais e responsáveis pelo estoque da propriedade que precisam acompanhar insumos, consumo e compras. A proposta reúne um painel web e um assistente no WhatsApp."],
  ["Preciso instalar um aplicativo?", "O painel foi pensado para funcionar no navegador do computador e do celular. A demonstração já pode ser explorada por aqui, sem cadastro."],
  ["Como meus dados entram no sistema?", "Após criar sua conta e configurar a propriedade, você pode cadastrar insumos ou importar uma planilha CSV/XLSX. A importação permite conferir e corrigir os dados antes de confirmar. A demonstração pública continua usando uma propriedade fictícia, separada da sua conta."],
  ["O WhatsApp já está conectado?", "Ainda não. A conversa desta página é um exemplo da experiência planejada. A conexão real, as consultas por áudio e a confirmação de movimentações fazem parte de uma etapa posterior."],
  ["A previsão de estoque é uma garantia?", "É uma estimativa baseada no saldo e no consumo registrado. O painel deve mostrar o período e o critério usados. Mudanças na rotina de uso podem alterar a autonomia."],
  ["Uma mensagem pode alterar o estoque sozinha?", "O fluxo previsto exige confirmação explícita antes de registrar uma movimentação pelo WhatsApp. Na demonstração do painel, você pode testar uma retirada temporária e reiniciar os dados quando quiser."],
];
