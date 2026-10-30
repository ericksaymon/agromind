# AgroMind

**Gestão inteligente de insumos rurais — equipe Commitou, Brotou**

AGROHACK 2026/2 · IFRO Campus Ariquemes

**[Acessar o aplicativo](https://agromind.ericksaymon.dev) · [Conhecer a demonstração](https://agromind.ericksaymon.dev/demo)**

## Equipe

Todos os integrantes cursam o **6º período de Análise e Desenvolvimento de Sistemas (ADS)** do IFRO Campus Ariquemes.

| Integrante | Função |
| --- | --- |
| Arthur Basseto Trevizan | Apresentador |
| Erick Saymon Contadini Markoviscz | Desenvolvedor |
| Filipe Ribeiro Camargo | Tech lead e responsável pela inscrição |
| Tana de Souza Rocha | Testadora |

A equipe e o link deste repositório estão cadastrados em **Minha equipe** no site do evento.

## Problema e público

Produtores e responsáveis por propriedades rurais registram compras e retiradas, mas podem não perceber falta de insumos, vencimentos, excesso, mudanças de consumo ou dinheiro parado no estoque. O AgroMind transforma esses registros em alertas priorizados, explicações e informações para planejar ações.

O projeto atende produtores, administradores e pessoas responsáveis pelo estoque rural. Os critérios são explícitos; estimativas dependem do histórico disponível e não são recomendações agronômicas garantidas.

## Solução disponível

| Área | Entrega |
| --- | --- |
| Estoque | Produtos, categorias, unidades, lotes, validade, mínimos, custos e fornecedores. |
| Movimentações pelo painel | Abertura, entrada, consumo, descarte, ajustes e estornos, com histórico. |
| Importação | CSV/XLSX, associação de colunas, revisão por linha, prévia e confirmação antes da gravação. |
| Dashboard e alertas | Estoque baixo, risco de falta, vencimentos, prioridades, justificativas e acompanhamento. |
| Inteligência | Histórico e comparação de consumo, retiradas incomuns, tendências, preços, excesso e capital parado. |
| Planejamento | Reposição sugerida e simulação de consumo/chegada hipotética, somente leitura. |
| Acesso | Contas com e-mail e senha (sem etapa de verificação no cadastro), propriedades, convites e papéis de administrador, operador e consulta. |
| WhatsApp | Vínculo do telefone, consultas por texto ou voz (saldo, mínimo, validade e autonomia), registro de saída de estoque e desvinculação, ambos após o usuário digitar SIM. |

As alterações feitas na conta são persistidas no PostgreSQL. A demonstração pública `/demo` usa dados fictícios e interações temporárias, separados das contas operacionais.

## Como avaliar

1. Abra a [demonstração pública](https://agromind.ericksaymon.dev/demo) para conhecer a interface sem criar conta.
2. Para testar persistência, [crie uma conta](https://agromind.ericksaymon.dev/criar-conta) e configure uma propriedade.
3. Cadastre um produto ou importe um dos modelos CSV abaixo. Revise a prévia antes de confirmar.
4. Confira estoque, alertas e o detalhe do produto. Custos, mínimos e validade ausentes são identificados.
5. Registre uma movimentação pelo painel e confira o saldo e o histórico atualizados. A rotina de análise reavalia os dados a cada dez segundos.
6. Na Inteligência, compare períodos e simule uma reposição. A simulação não grava pedidos nem movimentações.
7. Opcionalmente, conecte o telefone em [Assistente](https://agromind.ericksaymon.dev/app/assistant) e pergunte “Quanto diesel temos?” ou “O que está perto de vencer?”.

As contas e os bancos local e publicado são separados. Códigos do localhost não conectam ao bot publicado; a tela local aponta para o ambiente correto.

## Dados utilizados

**Os dados de testes e demonstração são simulados.** A equipe informou que não receberá uma planilha de registros. Os exemplos foram construídos a partir dos campos e categorias descritos no desafio: produto, categoria, unidade, quantidade, mínimo, tipo/data da movimentação, preço, lote, validade, fornecedor, destino e responsável.

- [Modelo de posição de estoque](apps/web/public/modelo-estoque.csv): quantidades disponíveis em uma data.
- [Modelo de histórico](apps/web/public/modelo-movimentacoes.csv): abertura e consumo de exemplo.
- [Fixture operacional](apps/api/src/demo-fixture.ts): seis produtos, histórico e cenários analíticos, usados na demonstração local reinicializável.

Não importar posição final e histórico como duas entradas independentes. Conferir unidades, natureza das saídas e preços unitários. A importação preserva referências e responsável histórico; grafias e possíveis duplicidades são revisadas pelo usuário, sem fusão automática.

Para obter autonomia, é necessário confirmar a cobertura completa do histórico no produto. Uma posição isolada ou os poucos registros do modelo CSV não comprovam consumo suficiente. Caso a organização disponibilize uma base oficial posteriormente, ela deverá ser avaliada conforme suas orientações; os exemplos não serão apresentados como dados oficiais.

## Critérios e limites das análises

| Análise | Critério |
| --- | --- |
| Abaixo do mínimo | Compara o saldo elegível com o mínimo explicitamente informado. Mínimo ausente não equivale a zero confirmado. |
| Consumo e autonomia | Usa retiradas confirmadas como consumo, cobertura declarada e dias completos. A autonomia divide o saldo elegível pela média; sem base suficiente, não há previsão. |
| Validade e risco de sobra | Examina lotes e, quando há histórico suficiente, distribui demanda por validade sem contar o mesmo consumo duas vezes. |
| Retiradas e tendências | Compara eventos e períodos com histórico anterior, amostras e limiares explícitos. Um sinal não é prova de fraude. |
| Finanças e excesso | Usa custos por lote/aquisição, cobertura conhecida dos preços e horizonte configurado. Valor desconhecido não é tratado como gratuito. |
| Prioridade e atualização | Alertas têm gravidade, evidências e acompanhamento humano. Mudanças relevantes invalidam a análise e acionam nova avaliação. |

Unidades incompatíveis não são somadas. Lotes vencidos ou com validade desconhecida não entram no saldo elegível conhecido. Não há ajuste sazonal automático nem pedidos futuros confirmados na modelagem atual. O relatório aceita até 365 dias e recusa bases acima de 50.000 movimentos; a importação tem limite de 1.000 linhas por envio. O WhatsApp consulta até 500 produtos e mostra até oito itens por lista, identificando listas parciais.

### WhatsApp

A tela gera um código curto de uso único, válido por dez minutos. Envie-o pelo telefone que deseja conectar; é possível trocar o vínculo e desconectar. Cada usuário vincula um telefone a uma propriedade por vez. O acesso é revalidado ao consultar e antes de enviar informações.

O assistente classifica a pergunta (por texto ou voz) com o modelo de `OPENROUTER_INTENT_MODEL` (padrão: `OPENROUTER_MODEL`) para entender perguntas livres, como "tenho combustível sobrando?", e as direciona às consultas de saldo, mínimo, validade, autonomia e lista de produtos. A IA só recebe a pergunta e os nomes dos produtos da propriedade (até 200), nunca saldos, e só escolhe a consulta; os números vêm sempre do banco. Sem chave ou em caso de falha, vale a interpretação por palavras-chave. Não há conversa livre. Nomes ambíguos exigem esclarecimento. **Memória de conversa não está disponível.**

**Saída de estoque e desvinculação pelo WhatsApp.** Com a IA configurada, ADMIN e OPERATOR podem pedir por texto ou voz, por exemplo "Retirei 20 litros de diesel para o trator". A IA só extrai produto, quantidade e destino; o bot escolhe o lote utilizável que vence primeiro, mostra o saldo antes e depois e só grava após o usuário digitar SIM em até dez minutos (confirmação por voz não vale). A gravação usa a mesma função de movimentação do painel, com origem WHATSAPP e auditoria. VIEWER só consulta. Entradas, perdas, ajustes e saídas que exigem dividir lotes continuam no painel. Enviar "desvincular" pede SIM e remove o vínculo do número. O botão "Desvincular número" fica em Assistente quando há vínculo.

**Mensagens de voz.** Telefones já vinculados podem enviar a pergunta em áudio. O servidor baixa a mídia da Cloud API, envia-a ao modelo configurado em `OPENROUTER_AUDIO_MODEL` (padrão: `OPENROUTER_MODEL`, via OpenRouter) apenas para transcrever, e a transcrição segue o mesmo fluxo de consulta do texto; a resposta começa com "Entendi: …" para conferência. O áudio fica só em memória e não é gravado. Aceita ogg, mp3, m4a e aac de até 2 MB; áudio maior, formato não suportado, fala ininteligível, IA indisponível ou ambiente sem chaves (`OPENROUTER_API_KEY` e `WHATSAPP_ACCESS_TOKEN`) resultam em mensagem pedindo texto. Telefones não vinculados não têm o áudio enviado à IA. Testes automatizados usam mocks; a chamada real ao modelo com áudio de voz do WhatsApp ainda não foi validada. O app Meta permanece em desenvolvimento, embora recebimento e resposta real entregue já tenham sido validados.

## Testes e validação

Na última alteração funcional, em 27/10/2026:

- **95 testes de API/cálculo/migração aprovados**, incluindo estoque, importação, permissões, análises e WhatsApp.
- Jornada Playwright do assistente aprovada: código curto, webhook assinado, vínculo, troca de propriedade, desconexão e bloqueio do ambiente local; desktop e celular, sem violações Axe no estado testado.
- Typecheck e build de API/web aprovados; build ARM64 e smoke público aprovados na publicação.
- Recebimento real de mensagem e resposta do backend confirmada como entregue pela Meta.

Há também testes de navegador das jornadas de acesso, estoque, administração e inteligência. A lista acima não afirma que toda a suíte de navegador foi reexecutada na última alteração.

Os testes usaram dados criados para simular uma propriedade rural. Eles verificam o funcionamento do sistema, mas ainda não demonstram que a solução foi avaliada com produtores em uma propriedade real. O recebimento e a entrega de mensagens pelo WhatsApp foram testados; ainda não há registro de uma consulta completa feita por um integrante após vincular seu próprio telefone. O roteiro da apresentação será preparado pela equipe.

## Tecnologias e uso de inteligência artificial

Next.js/React no frontend; Fastify/TypeScript na API; PostgreSQL/Prisma no banco. Docker na infraestrutura; Cloudflare na publicação; Resend no envio de e-mails; WhatsApp Cloud API no canal de mensagens. O [lockfile](pnpm-lock.yaml) registra as versões das dependências.

**Codex (OpenAI) e Claude (Anthropic)** foram utilizados como apoio ao desenvolvimento. As revisões informadas pela equipe abrangeram funcionamento e validade dos resultados. O código é acompanhado por testes e limitações explícitas; a equipe deve explicar suas escolhas e resultados à banca.

No produto, o **OpenRouter** roteia a solicitação ao modelo configurado para sugerir a associação das colunas na importação. O usuário inicia essa ação; somente os cabeçalhos são enviados. A sugestão é revisada e validada antes de gravar. Falha na IA permite associação manual. Saldos, alertas, cálculos e simulações são determinísticos e independem do modelo.

## Autoria, referências e condições de uso

O AgroMind é apresentado pela equipe **Commitou, Brotou**. A identidade visual veio do material do projeto fornecido pela equipe. As fontes Inter e Montserrat e as bibliotecas possuem seus próprios créditos e condições de uso, registrados em [Créditos e dependências](THIRD_PARTY_NOTICES.md).

Esta entrega tem finalidade acadêmica e demonstrativa. O código desenvolvido para o AgroMind está disponível sob a [licença MIT](LICENSE), por decisão da equipe. As dependências e outros recursos de terceiros mantêm suas próprias condições de uso, detalhadas em [Créditos e dependências](THIRD_PARTY_NOTICES.md).

Referências do evento: [página do AGROHACK](https://incubadora.cloud/agrohack/) e [regulamento oficial](https://incubadora.cloud/agrohack/assets/regulamento-agrohack.pdf).

## Executar localmente

Requisitos: Node.js 22.22 ou compatível, pnpm 10.26.2 e Docker em execução.

```powershell
pnpm install --frozen-lockfile
pnpm infra:up
pnpm db:generate
pnpm db:migrate
pnpm dev
```

Web: `http://localhost:3000`. API: `http://127.0.0.1:4000`. E-mails locais de confirmação/recuperação: `http://localhost:18025` (Mailpit); não são enviados à caixa externa.

`pnpm infra:up` cria o `.env` privado se ele não existir, preserva valores existentes e inicia o PostgreSQL/Mailpit próprios do projeto. O banco persiste no volume `agromind-local_agromind_db`.

Para preparar somente a demonstração operacional local:

```powershell
pnpm demo:reset
```

O comando exige `APP_ENV=local` e banco em loopback. As credenciais geradas ficam em `.private/demo.local.json`, ignorado pelo Git. Só reinicializa propriedades identificadas como demonstração e bloqueia o reset se houver divergência de titular ou outros membros. Não atua no banco publicado.

Para testar e gerar o build:

```powershell
pnpm typecheck
pnpm test:api
pnpm --filter @agromind/web exec playwright install chromium
pnpm test:web
pnpm build
pnpm start
```

Testes de navegador precisam de web/API e Mailpit ativos. Execute testes de API sem outro worker consumindo os jobs sintéticos. O teste de vínculo WhatsApp requer um ambiente de integração correspondente: para testes locais isolados, configure as variáveis WHATSAPP_* com valores sintéticos e `WHATSAPP_ALLOW_LOCAL_PAIRING=true`, sem apontar para o bot publicado. Os testes de API do assistente usam mocks de envio e não exigem token real da Meta.

## Estrutura e operação

Consulte o [índice da documentação](documentation/README.md) para arquitetura, dados e regras, validação e guia de avaliação funcional.

- `apps/web`: interface, demonstração e testes de navegador.
- `apps/api`: API, regras, workers, migrations e testes.
- `packages/contracts`: contratos compartilhados.
- `deploy`: publicação, backups e [instruções operacionais](deploy/OPERATIONS.md).
- `scripts`: preparação e execução local.

Credenciais, bancos, dados pessoais reais, planejamento e builds ficam fora do Git. Não publique o `.env` nem o diretório `.private`. Backups externos automáticos e sua política de retenção continuam como melhoria operacional pendente.

## Vídeo e versão de entrega

**[Assistir ao vídeo](documentation/video/agromind-final.mp4)** — 40 segundos, 1920 × 1080, horizontal, legendas em português, sem narração. Os 30 segundos centrais mostram a demonstração pública `/demo` com dados simulados: consulta a um Diesel S10, simulação de retirada de 150 litros, saldo atualizado para 270 litros e autonomia de 4,5 dias. Detalhes de gravação, trilha e limitações da captura em [documentation/video/production/REVIEW.md](documentation/video/production/REVIEW.md).

A apresentação ao vivo segue preparada pela equipe. **A versão avaliada está na tag [`entrega-agrohack-2026-2`](https://github.com/ericksaymon/agromind/tree/entrega-agrohack-2026-2)**, que corresponde ao código publicado em produção (release `20261030-final`), com o vídeo da entrega [anexado na release](https://github.com/ericksaymon/agromind/releases/tag/entrega-agrohack-2026-2).
