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

Piloto publicado na Oracle em https://agromind.ericksaymon.dev. Etapa 6 em andamento: receptor autenticado e assistente por texto publicados, com recebimento e resposta entregue pela Meta validados em 27/10/2026. Em `/app/assistant`, gere um código temporário e envie-o pelo telefone que deseja vincular à conta e à propriedade. É possível trocar o vínculo e desconectar. Consultas de saldo, mínimos, validade e autonomia usam o banco e as regras existentes; sem histórico suficiente, não há estimativa fictícia. A interpretação desta versão é por comandos e palavras-chave, sem LLM. Movimentações por WhatsApp e áudio ainda não implementados; app Meta permanece em desenvolvimento.

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

Na Oracle, a release ativa fica em `/home/ubuntu/apps/AgroMind/releases/20261023-import-file-card`, com alias `current`, código `540d11f`. A release anterior é `20261023-confirmation-flow`; a inicial também foi preservada. A imagem ativa tem digest SHA256 `31c70f5f28165ae18ae377b9280a0a0bf1718be413cea910b292a25ffe7eb165`; o digest da release inicial preservada é `21bc4a19c710606eb006d6847d0bf4305dc862115c3c31a189c678504c26b939`. Não sobrescreva tags já publicadas: novas releases precisam de diretório/tag novos, backup prévio, migrations e `docker compose up -d --wait`. A configuração usa `.private` e `backups` compartilhados por symlink entre releases.

O backup roda diariamente às 03:17 UTC, com atraso aleatório de até cinco minutos. A restauração inicial foi validada em banco separado, preservando as sete migrations, e uma cópia inicial foi trazida ao workspace privado. A cópia automática para fora da VM ainda não está configurada; manter um destino externo protegido e uma política de retenção é uma pendência operacional. O script não apaga backups automaticamente. O certificado de origem expira em 23/10/2027 e requer renovação antes dessa data.

Verificações públicas sem criar contas ou gravar estoque:

```powershell
node deploy/smoke.mjs https://agromind.ericksaymon.dev
```

A checagem cobre páginas públicas, saúde do banco/API, acesso privado sem sessão, cookies Secure/SameSite, payload inválido, rejeição de origem externa e ausência de arquivos privados em URLs públicas. SMTP autenticado/TLS e envio ao destinatário técnico de testes do Resend foram validados. O primeiro cadastro real confirmou chegada na caixa de entrada do Gmail do titular, às 22h55 de 22/10/2026 (Cuiabá), e verificação do endereço. Isso valida esse envio, sem garantir entrega de todos os futuros e-mails. A confirmação encaminha diretamente à configuração, ao painel ou ao convite pendente. O telefone da propriedade recebe máscara brasileira para fixo e celular, com suporte à colagem de +55; o campo continua opcional. Build e 11 testes de navegador aprovados para essa alteração, seguidos de smoke público e conferência visual da máscara em produção.

Rollback: apontar `current` e `RELEASE_TAG` para uma imagem anterior compatível e recriar somente serviços AgroMind. Nunca reverter migrations destrutivamente sem análise; restaurar backup em banco separado antes de qualquer decisão. A release inicial foi preservada e usa o mesmo esquema de banco do piloto. Para retirar a publicação inicial, remover somente o registro DNS AgroMind e o include `/data/nginx/custom/agromind.conf` do `http.conf` próprio; executar `nginx -t` antes de recarregar o proxy. Não parar o proxy compartilhado nem remover volumes.

## Assistente WhatsApp — consultas por texto

`/app/assistant` permite gerar código de oito caracteres de uso único, válido por dez minutos, abrir a conversa com a mensagem pronta, acompanhar o vínculo e desconectar. Cada usuário vincula um telefone a uma propriedade por vez. Gerar outro código invalida os anteriores; vínculo anterior só muda após confirmação. A vinculação exige sessão e e-mail verificados e participação na propriedade. A mesma checagem de acesso ocorre ao processar uma pergunta e imediatamente antes de enviar dados. VIEWER pode consultar; nenhuma mensagem desta versão altera o estoque.

Exemplos: “Quanto diesel temos?”, “O que está abaixo do mínimo?”, “O que está perto de vencer?” e “Qual a autonomia do diesel?”. Produtos ambíguos exigem o nome completo. Respostas mostram a propriedade vinculada, que pode ser diferente da propriedade selecionada no painel. Limite de 500 produtos por consulta e oito itens por lista, com aviso de lista parcial. Consultas de autonomia/mínimos exigem análise atualizada.

Credenciais privadas: WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCOUNT_IDS, WHATSAPP_INBOX_KEY, WHATSAPP_PUBLIC_NUMBER, WHATSAPP_ACCESS_TOKEN e WHATSAPP_GRAPH_VERSION. Ative o worker com WHATSAPP_WORKER_ENABLED=true. O token deve permitir mensagens no número empresarial; manter no servidor. Código gerado pelo painel é guardado apenas em hash. Telefone e conteúdo da caixa de entrada/saída são cifrados. Backups devem preservar a chave WHATSAPP_INBOX_KEY.

O worker da API processa a caixa persistida a cada dois segundos. Respostas expiram em até cinco minutos e ficam dentro de 23 horas da mensagem recebida. Há limites de dez respostas por minuto por remetente e 120 globais por minuto. Falha ambígua de envio fica UNKNOWN, sem reenvio automático; uma nova pergunta cria nova solicitação. ACCEPTED não comprova entrega; estados DELIVERED/READ dependem de eventos da Meta. O painel exibe o estado da última resposta.

Conteúdo processado é limpo após sete dias, conservando chaves de deduplicação. Conteúdo ainda não processado ou com falha exige acompanhamento operacional. A limpeza de entrada ocorre no próximo webhook válido; a de saída, no worker. Isso não remove cópias de backups. A política de retenção externa continua pendente.

Em produção, API/web usam agromind:20261027-whatsapp-assistant, digest sha256:169210180975db91b78cdaafd9c5dea5c005e7896f075e6595f3344ff3ae2d1c. Dez migrations aplicadas; backup prévio agromind-20261027T160648Z.dump. A release anterior permanece preservada. O menu do assistente foi acrescentado à navegação já publicada; alterações locais de interface não relacionadas não foram publicadas.

Atualização de 27/10/2026: vínculo usa código curto, como K7PM-4RXT, aceitando minúsculas e envio sem o prefixo AGROMIND. Há limite de cinco tentativas por remetente em dez minutos e mil tentativas globais na mesma janela. O ambiente local bloqueia a geração de códigos para o bot publicado e aponta para https://agromind.ericksaymon.dev/app/assistant; contas e bancos são separados. WHATSAPP_ALLOW_LOCAL_PAIRING=true libera apenas testes de integração com um receptor correspondente. Essa opção não sincroniza ambientes. Onze migrations; release 20261027-whatsapp-short-code, digest sha256:1de62488e6e038c500cc51a36af17ed0cd08993be8f7ce6ebedd9fd82642b72d. Backup prévio agromind-20261027T162512Z.dump. 95 testes de API e jornada Playwright aprovados, incluindo bloqueio local e código curto.
