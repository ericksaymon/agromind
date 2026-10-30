# Operação do piloto AgroMind

Estado revisado em 30/10/2026. Evidências históricas estão identificadas por data. Segredos permanecem fora do repositório.

## Produção — piloto público

Publicado em `https://agromind.ericksaymon.dev`, com banco próprio novo, serviços web/API/PostgreSQL no projeto Compose `agromind`, sem portas adicionais publicadas. DNS com proxy Cloudflare, TLS estrito e certificado de origem exclusivo. Envio pelo Resend com domínio `agromind.ericksaymon.dev` verificado; configurações e chaves permanecem em `.private/production.env`, fora do Git.

Contatos públicos: `suporte@ericksaymon.dev` e `privacidade@ericksaymon.dev`, encaminhados pela Cloudflare para o destino verificado do administrador. O aceite registrado em produção usa a versão `2026-10-23-piloto`. A instalação local mantém seus dados e versão próprios.

Arquivos de operação: `deploy/Dockerfile`, `deploy/compose.production.yml`, `deploy/agromind.nginx.conf`, `deploy/backup.sh` e unidades `agromind-backup.service`/`.timer`. A API confia somente no endereço definido em `API_TRUST_PROXY`; atualizar esse endereço se o container do proxy mudar de IP. O proxy elimina cabeçalhos de IP fornecidos pelo visitante e usa as faixas oficiais da Cloudflare. API, banco e worker não possuem portas públicas próprias.

Release ativa verificada: `20261030-final`, imagem `agromind:20261030-final`. Migration `20261030000000_whatsapp_pending_actions` aplicada; backup prévio feito pelo script de deploy. Smoke público aprovado. Releases anteriores preservadas. Não sobrescrever tags publicadas.

O backup roda diariamente às 03:17 UTC, com atraso aleatório de até cinco minutos. A restauração inicial foi validada em banco separado, preservando as sete migrations, e uma cópia inicial foi trazida ao workspace privado. A cópia automática para fora da VM ainda não está configurada; manter um destino externo protegido e uma política de retenção é uma pendência operacional. O script não apaga backups automaticamente. O certificado de origem expira em 23/10/2027 e requer renovação antes dessa data.

Verificações públicas sem criar contas ou gravar estoque:

```powershell
node deploy/smoke.mjs https://agromind.ericksaymon.dev
```

A checagem cobre páginas públicas, saúde do banco/API, acesso privado sem sessão, cookies Secure/SameSite, payload inválido, rejeição de origem externa e ausência de arquivos privados em URLs públicas. SMTP autenticado/TLS e envio ao destinatário técnico de testes do Resend foram validados. O primeiro cadastro real confirmou chegada na caixa de entrada do Gmail do titular, às 22h55 de 22/10/2026 (Cuiabá), e verificação do endereço. Isso valida esse envio, sem garantir entrega de todos os futuros e-mails. A confirmação encaminha diretamente à configuração, ao painel ou ao convite pendente. O telefone da propriedade recebe máscara brasileira para fixo e celular, com suporte à colagem de +55; o campo continua opcional. Build e 11 testes de navegador aprovados para essa alteração, seguidos de smoke público e conferência visual da máscara em produção.

Rollback: apontar `current` e `RELEASE_TAG` para uma imagem anterior compatível e recriar somente serviços AgroMind. Nunca reverter migrations destrutivamente sem análise; restaurar backup em banco separado antes de qualquer decisão. A release inicial foi preservada; conferir compatibilidade com as migrations atuais antes de qualquer retorno. Para retirar a publicação inicial, remover somente o registro DNS AgroMind e o include `/data/nginx/custom/agromind.conf` do `http.conf` próprio; executar `nginx -t` antes de recarregar o proxy. Não parar o proxy compartilhado nem remover volumes.
