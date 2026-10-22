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

**Etapas 1, 2 e 3 implementadas localmente.** A landing/demonstração usa fixtures temporárias. Contas, propriedades, produtos, lotes, custos, movimentações e importações são persistidos no PostgreSQL. A área privada tem cadastro/edição, busca/filtros, histórico, estorno administrativo e importação CSV/XLSX com prévia, correção e confirmação.

Estoque: `http://localhost:3000/app/estoque` · Importação: `http://localhost:3000/app/importar` · Histórico: `http://localhost:3000/app/movimentacoes`.

A análise assistida por IA usa OpenRouter e recomenda inicialmente `google/gemini-3.8-flash`. Para ativar, configure `OPENROUTER_API_KEY` no `.env` privado; `OPENROUTER_MODEL` troca o modelo. Reinicie a API. Somente os cabeçalhos são enviados ao clicar no botão; revisão humana e validação no backend continuam obrigatórias. Sem credencial ou em caso de falha, associe as colunas manualmente. Em 22/10/2026, a chamada real foi validada em três casos sintéticos e em uma jornada pelo navegador até a importação confirmada. O modelo anterior, Gemini 2.5 Flash, foi substituído porque seu endpoint não atendia à política ZDR da conta. O endpoint compatível de Gemini 3.8 Flash funciona sem alterar essa política. A amostra não é uma medida de precisão geral.

Próxima entrega: dashboard e alertas analíticos reais (etapa 4). WhatsApp permanece na etapa 6; publicação na Oracle na etapa 8.

Três de oito etapas correspondem a **37,5% da contagem de etapas**; não é uma porcentagem ponderada de esforço ou cobertura do produto. A ativação externa da IA foi validada em 22/10/2026.
