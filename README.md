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

**Etapas 1 a 5 e 7 implementadas localmente.** A landing/demonstração usa fixtures temporárias. Contas, propriedades, produtos, lotes, custos, movimentações e importações são persistidos no PostgreSQL. A área privada tem cadastro/edição, busca/filtros, histórico, estorno administrativo e importação CSV/XLSX com prévia, correção e confirmação.

Estoque: `http://localhost:3000/app/estoque` · Importação: `http://localhost:3000/app/importar` · Histórico: `http://localhost:3000/app/movimentacoes`.

A análise assistida por IA usa OpenRouter e recomenda inicialmente `google/gemini-3.8-flash`. Para ativar, configure `OPENROUTER_API_KEY` no `.env` privado; `OPENROUTER_MODEL` troca o modelo. Reinicie a API. Somente os cabeçalhos são enviados ao clicar no botão; revisão humana e validação no backend continuam obrigatórias. Sem credencial ou em caso de falha, associe as colunas manualmente. Em 22/10/2026, a chamada real foi validada em três casos sintéticos e em uma jornada pelo navegador até a importação confirmada. O modelo anterior, Gemini 2.5 Flash, foi substituído porque seu endpoint não atendia à política ZDR da conta. O endpoint compatível de Gemini 3.8 Flash funciona sem alterar essa política. A amostra não é uma medida de precisão geral.

Painel: `http://localhost:3000/app` · Alertas: `http://localhost:3000/app/alertas`.

Dashboard, consumo, autonomia, validade e acompanhamento usam dados reais da propriedade. No detalhe do produto, confirme o intervalo de histórico completo antes de obter projeções: uma posição isolada não comprova consumo. Mínimo e validade desconhecidos ficam explícitos. A importação preserva responsável histórico, referência e linha; saídas genéricas podem ser classificadas como uso no histórico com motivo auditável.

A API executa a rotina analítica a cada 10 segundos, reavalia mudanças de data no fuso local e retoma falhas a partir do estado persistido. Precisa permanecer em execução. O núcleo analítico é determinístico e funciona sem OpenRouter. Os testes atuais cobrem 77 testes de API/cálculo/migração e 11 testes de navegador, com dados sintéticos. Registros reais do evento ainda precisam ser recebidos para validação oficial.

Inteligência: `http://localhost:3000/app/inteligencia`. Abas de consumo, finanças, excesso/capital parado e planejamento/simulação. Períodos completos, comparação equivalente, preços por aquisição, custos por lote e critérios administrativos versionados. Os sinais alimentam a fila de alertas existente.

Simulação é somente leitura, inclusive para VIEWER: considera vencimentos e chegada hipotética, informa demanda não atendida antes da chegada e não cria movimentos ou pedidos. Sem histórico suficiente, não apresenta projeção fictícia. Não há entradas futuras agendadas na modelagem atual. Quantidades e valores conhecidos têm suas limitações explícitas.

Relatórios aceitam até 365 dias completos, com paginação de produtos/eventos. Bases acima de 50.000 movimentos exigem ampliar o processamento desta versão; não são truncadas silenciosamente. Hipóteses e limiares não são regras agronômicas garantidas, e não há ajuste sazonal automático.

Piloto publicado na Oracle em https://agromind.ericksaymon.dev. WhatsApp (etapa 6) permanece adiado por decisão do usuário.

Refinamentos das etapas 1 a 5: prévia de importação com conciliação dos registros selecionados, referência externa opcional de conferência, qualidade dos dados no produto, explicações expansíveis e atalho de alerta para planejamento com o produto selecionado. A referência externa da prévia é apenas local à tela; não ajusta saldos nem é persistida.

`pnpm demo:reset` cria ou reinicializa uma demonstração operacional com seis produtos, histórico coerente e duas propriedades. Exige `APP_ENV=local` e banco em loopback. O comando só remove as propriedades identificadas no manifesto privado e bloqueia a operação se perderem a identificação ou receberem outros membros. As sessões da conta de demonstração são revogadas ao reinicializar. O acesso gerado fica em `.private/demo.local.json`, ignorado pelo Git. A demo pública de `/demo` continua separada desses dados persistidos.

`pnpm benchmark:analysis` mede o motor em memória com 1.000, 10.000 e 50.000 movimentos sintéticos e grava o resultado em `tmp/analysis-benchmark.json`. A medição não inclui banco/rede e não certifica capacidade de produção. A busca da amostra de retiradas incomuns considera primeiro os últimos 200 eventos, mantendo a janela e as regras anteriores.

Sete de oito etapas têm implementação disponível (**87,5% da contagem de etapas**); não é uma porcentagem ponderada de esforço ou cobertura do produto. A ativação externa da IA foi validada em 22/10/2026.

## Administração e conta — etapa 7

Configurações: `/app/configuracoes` (propriedade, equipe/convites, categorias e auditoria). Conta: `/conta` (nome, troca de e-mail com duas confirmações, senha, sessões e atividade pessoal). `/conta` entrega uma estrutura pública sem dados pessoais; seus dados vêm exclusivamente da API autenticada. Convites: `/convite`, com aceite explícito pelo destinatário verificado; criar outra propriedade: `/nova-propriedade`.

ADMIN gerencia acessos e catálogo; OPERATOR cadastra/movimenta; VIEWER consulta. O backend revalida sessão e papel dentro da gravação. A última pessoa ADMIN não pode perder o vínculo. Alterações administrativas usam versão, motivo e histórico; mudança de fuso exige confirmação e invalida a cobertura declarada do histórico, sem mudar os movimentos. Categorias arquivadas preservam referências existentes.

A antiga alteração genérica `PATCH /api/properties/:id` foi encerrada. Configurações usam `/api/properties/:id/settings`; primeira propriedade mantém o onboarding e propriedades adicionais usam `/api/account/properties`. APIs de conta não exigem propriedade ativa.

`pnpm categories:preflight` gera relatório local em `outputs/` com categorias legadas e colisões de normalização. Não funde categorias automaticamente. As migrations preservam produtos, movimentos e papéis existentes; colisões precisam ser resolvidas explicitamente antes do corte.

Convites e confirmações de troca de e-mail usam outbox persistente, tentativas limitadas e conteúdo cifrado. `pnpm setup:local` gera `MAIL_ENCRYPTION_KEY` privada se faltar, preservando as demais configurações. Faça backup seguro dessa chave junto da configuração: perdê-la impede recuperar envios pendentes, que precisam ser cancelados/reemitidos. Aceite SMTP não significa entrega na caixa externa. O worker roda dentro da API; localmente, os e-mails chegam ao Mailpit.

Execute testes de API sem outra instância do worker consumindo seus jobs sintéticos. Para testes de navegador, mantenha web/API/worker e Mailpit ativos. O Playwright força resolução IPv4 de localhost para evitar outro aplicativo na mesma porta IPv6. Os testes usam dados sintéticos e não certificam a base oficial ou serviço SMTP externo.


## Produção — piloto público

Publicado em `https://agromind.ericksaymon.dev`, com banco próprio novo, serviços web/API/PostgreSQL no projeto Compose `agromind`, sem portas adicionais publicadas. DNS com proxy Cloudflare, TLS estrito e certificado de origem exclusivo. Envio pelo Resend com domínio `agromind.ericksaymon.dev` verificado; configurações e chaves permanecem em `.private/production.env`, fora do Git.

Contatos públicos: `suporte@ericksaymon.dev` e `privacidade@ericksaymon.dev`, encaminhados pela Cloudflare para o destino verificado do administrador. O aceite registrado em produção usa a versão `2026-10-23-piloto`. A instalação local mantém seus dados e versão próprios.

Arquivos de operação: `deploy/Dockerfile`, `deploy/compose.production.yml`, `deploy/agromind.nginx.conf`, `deploy/backup.sh` e unidades `agromind-backup.service`/`.timer`. A API confia somente no endereço definido em `API_TRUST_PROXY`; atualizar esse endereço se o container do proxy mudar de IP. O proxy elimina cabeçalhos de IP fornecidos pelo visitante e usa as faixas oficiais da Cloudflare. API, banco e worker não possuem portas públicas próprias.

Na Oracle, a release ativa fica em `/home/ubuntu/apps/AgroMind/releases/20261023-pilot`, com alias `current`. A release anterior é `20261023-initial`. A imagem ativa tem digest SHA256 `b3307435d28d585fb2ec2747a31715d8cbc7baaaa6fa7ba8d9d11d8092d006e5`; o digest da release inicial preservada é `21bc4a19c710606eb006d6847d0bf4305dc862115c3c31a189c678504c26b939`. Não sobrescreva tags já publicadas: novas releases precisam de diretório/tag novos, backup prévio, migrations e `docker compose up -d --wait`. A configuração usa `.private` e `backups` compartilhados por symlink entre releases.

O backup roda diariamente às 03:17 UTC, com atraso aleatório de até cinco minutos. A restauração inicial foi validada em banco separado, preservando as sete migrations, e uma cópia inicial foi trazida ao workspace privado. A cópia automática para fora da VM ainda não está configurada; manter um destino externo protegido e uma política de retenção é uma pendência operacional. O script não apaga backups automaticamente. O certificado de origem expira em 23/10/2027 e requer renovação antes dessa data.

Verificações públicas sem criar contas ou gravar estoque:

```powershell
node deploy/smoke.mjs https://agromind.ericksaymon.dev
```

A checagem cobre páginas públicas, saúde do banco/API, acesso privado sem sessão, cookies Secure/SameSite, payload inválido, rejeição de origem externa e ausência de arquivos privados em URLs públicas. SMTP autenticado/TLS e envio ao destinatário técnico de testes do Resend foram validados. Aceite do provedor não comprova chegada em toda caixa pessoal; a primeira conta real deve confirmar o recebimento.

Rollback: apontar `current` e `RELEASE_TAG` para uma imagem anterior compatível e recriar somente serviços AgroMind. Nunca reverter migrations destrutivamente sem análise; restaurar backup em banco separado antes de qualquer decisão. A release inicial foi preservada e usa o mesmo esquema de banco do piloto. Para retirar a publicação inicial, remover somente o registro DNS AgroMind e o include `/data/nginx/custom/agromind.conf` do `http.conf` próprio; executar `nginx -t` antes de recarregar o proxy. Não parar o proxy compartilhado nem remover volumes.
