# AgroMind

Aplicação de gestão de insumos rurais. Monorepo com frontend Next.js/React, API Fastify/TypeScript e PostgreSQL/Prisma.

## Estrutura

- `apps/web`: landing, demonstração, acesso e área operacional.
- `apps/api`: autenticação, propriedades, estoque, importação e testes da API.
- `packages/contracts`: contratos TypeScript compartilhados.
- `deploy`: infraestrutura local com PostgreSQL e Mailpit.
- `scripts`: preparação e execução do ambiente.

PDFs, documentos de planejamento, referências originais, credenciais e builds ficam fora do Git. O README e os modelos CSV necessários ao uso do software acompanham o código.

## Executar localmente

Requisitos: Node.js 22.22 ou compatível, pnpm 10.26.2 e Docker em execução.

```powershell
pnpm install --frozen-lockfile
pnpm infra:up
pnpm db:generate
pnpm db:migrate
pnpm dev
```

Landing: `http://localhost:3000` · Demonstração: `http://localhost:3000/demo`.

Cadastro: `http://localhost:3000/criar-conta` · Acesso: `http://localhost:3000/entrar`.

E-mails de confirmação e recuperação: **`http://localhost:18025`** (Mailpit local). Nesta instalação, as mensagens ficam nessa caixa de testes; não são enviadas à caixa de entrada externa do endereço informado.

`pnpm infra:up` cria um `.env` privado com valores aleatórios caso ele ainda não exista, preserva configurações existentes e inicia somente PostgreSQL/Mailpit do projeto `agromind-local`. Os registros persistem no volume `agromind-local_agromind_db`. A API escuta em `127.0.0.1:4000`; o navegador usa `/api` pelo proxy do Next.js.

```powershell
pnpm typecheck
pnpm build
pnpm start
pnpm test:api
pnpm test:web
```

## Estado da execução

Antes do primeiro teste de navegador, instale o Chromium com `pnpm --filter @agromind/web exec playwright install chromium`. Se já tiver um executável compatível, use `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` para apontá-lo. Os testes de API precisam do PostgreSQL/Mailpit; os testes de navegador também precisam da API/web em execução. As contas e propriedades criadas pelos testes são removidas ao final; não são contas de uso do produto.

**Etapas 1 a 5 implementadas localmente.** A landing/demonstração usa fixtures temporárias. Contas, propriedades, produtos, lotes, custos, movimentações e importações são persistidos no PostgreSQL. A área privada tem cadastro/edição, busca/filtros, histórico, estorno administrativo e importação CSV/XLSX com prévia, correção e confirmação.

Estoque: `http://localhost:3000/app/estoque` · Importação: `http://localhost:3000/app/importar` · Histórico: `http://localhost:3000/app/movimentacoes`.

A análise assistida por IA usa OpenRouter e recomenda inicialmente `google/gemini-3.8-flash`. Para ativar, configure `OPENROUTER_API_KEY` no `.env` privado; `OPENROUTER_MODEL` troca o modelo. Reinicie a API. Somente os cabeçalhos são enviados ao clicar no botão; revisão humana e validação no backend continuam obrigatórias. Sem credencial ou em caso de falha, associe as colunas manualmente. Em 22/10/2026, a chamada real foi validada em três casos sintéticos e em uma jornada pelo navegador até a importação confirmada. O modelo anterior, Gemini 2.5 Flash, foi substituído porque seu endpoint não atendia à política ZDR da conta. O endpoint compatível de Gemini 3.8 Flash funciona sem alterar essa política. A amostra não é uma medida de precisão geral.

Painel: `http://localhost:3000/app` · Alertas: `http://localhost:3000/app/alertas`.

Dashboard, consumo, autonomia, validade e acompanhamento usam dados reais da propriedade. No detalhe do produto, confirme o intervalo de histórico completo antes de obter projeções: uma posição isolada não comprova consumo. Mínimo e validade desconhecidos ficam explícitos. A importação preserva responsável histórico, referência e linha; saídas genéricas podem ser classificadas como uso no histórico com motivo auditável.

A API executa a rotina analítica a cada 10 segundos, reavalia mudanças de data no fuso local e retoma falhas a partir do estado persistido. Precisa permanecer em execução. O núcleo analítico é determinístico e funciona sem OpenRouter. Os testes atuais cobrem 38 casos de API/cálculo e 5 jornadas de navegador, com dados sintéticos. Registros reais do evento ainda precisam ser recebidos para validação oficial.

Inteligência: `http://localhost:3000/app/inteligencia`. Abas de consumo, finanças, excesso/capital parado e planejamento/simulação. Períodos completos, comparação equivalente, preços por aquisição, custos por lote e critérios administrativos versionados. Os sinais alimentam a fila de alertas existente.

Simulação é somente leitura, inclusive para VIEWER: considera vencimentos e chegada hipotética, informa demanda não atendida antes da chegada e não cria movimentos ou pedidos. Sem histórico suficiente, não apresenta projeção fictícia. Não há entradas futuras agendadas na modelagem atual. Quantidades e valores conhecidos têm suas limitações explícitas.

Relatórios aceitam até 365 dias completos, com paginação de produtos/eventos. Bases acima de 50.000 movimentos exigem ampliar o processamento desta versão; não são truncadas silenciosamente. Hipóteses e limiares não são regras agronômicas garantidas, e não há ajuste sazonal automático.

Próxima entrega: WhatsApp oficial (etapa 6); publicação na Oracle permanece na etapa 8.

Refinamentos das etapas 1 a 5: prévia de importação com conciliação dos registros selecionados, referência externa opcional de conferência, qualidade dos dados no produto, explicações expansíveis e atalho de alerta para planejamento com o produto selecionado. A referência externa da prévia é apenas local à tela; não ajusta saldos nem é persistida.

`pnpm demo:reset` cria ou reinicializa uma demonstração operacional com seis produtos, histórico coerente e duas propriedades. Exige `APP_ENV=local` e banco em loopback. O comando só remove as propriedades identificadas no manifesto privado e bloqueia a operação se perderem a identificação ou receberem outros membros. As sessões da conta de demonstração são revogadas ao reinicializar. O acesso gerado fica em `.private/demo.local.json`, ignorado pelo Git. A demo pública de `/demo` continua separada desses dados persistidos.

`pnpm benchmark:analysis` mede o motor em memória com 1.000, 10.000 e 50.000 movimentos sintéticos e grava o resultado em `tmp/analysis-benchmark.json`. A medição não inclui banco/rede e não certifica capacidade de produção. A busca da amostra de retiradas incomuns considera primeiro os últimos 200 eventos, mantendo a janela e as regras anteriores.

Cinco de oito etapas correspondem a **62,5% da contagem de etapas**; não é uma porcentagem ponderada de esforço ou cobertura do produto. A ativação externa da IA foi validada em 22/10/2026.
