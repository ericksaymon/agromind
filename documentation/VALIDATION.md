# Testes, evidências e limites de validação

## Resultado observado

Última rodada funcional registrada em 27/10/2026, na base de código `1d487b0`:

| Verificação | Resultado |
| --- | --- |
| API, cálculos e migrations | 95 testes aprovados. |
| Playwright do assistente | Geração de código curto, webhook assinado, vínculo, troca de propriedade, desconexão e aviso/bloqueio local aprovados. |
| Interface testada | Desktop e 390 px, sem overflow horizontal e sem violações Axe no estado auditado. |
| TypeScript e build | Aprovados; build ARM64 executado na publicação. |
| Smoke público | Páginas, saúde, validação, origem e proteção de acesso aprovadas, sem criar contas pelo smoke. |
| Transporte WhatsApp | Mensagem real recebida e resposta enviada pelo backend confirmada como entregue pela Meta. |

Esses são resultados observados, não uma promessa de cobertura completa. Alterações posteriores na documentação não representam nova execução da suíte. A suíte completa de navegador tem outros fluxos, mas não foi integralmente reexecutada nessa última rodada.

## Evidências no código

- [Autenticação](../apps/api/test/auth.test.ts): sessões, verificação, recuperação, isolamento e revogação.
- [Estoque](../apps/api/test/stock.test.ts): movimentações, importação e regras de saldo.
- [Motor analítico](../apps/api/test/analysis-engine.test.ts): cobertura, consumo, autonomia, validade e limites.
- [Inteligência](../apps/api/test/intelligence-engine.test.ts): comparações e detectores avançados.
- [Administração](../apps/api/test/administration.test.ts): papéis, convites, conta e concorrência.
- [Receptor WhatsApp](../apps/api/test/whatsapp.test.ts): desafio, assinatura, cifra, duplicação e limites.
- [Assistente WhatsApp](../apps/api/test/whatsapp-assistant.test.ts): código curto, expiração, concorrência, autorização, consultas, limites de tentativas e falhas de envio.
- [Jornada no navegador](../apps/web/e2e/whatsapp.spec.ts): vínculo e estados da interface, com eventos sintéticos autenticados.

## Reproduzir

Prepare o ambiente conforme o [README](../README.md). PostgreSQL e Mailpit devem estar ativos. Para a suíte da API, evite outra instância consumindo os mesmos jobs sintéticos.

```powershell
pnpm typecheck
pnpm test:api
```

Para testar o assistente localmente com eventos sintéticos, aplique este bloco tanto no terminal da API quanto no terminal do Playwright:

```powershell
$env:WHATSAPP_INBOX_KEY = '1' * 64
$env:WHATSAPP_VERIFY_TOKEN = '2' * 64
$env:WHATSAPP_APP_SECRET = 'synthetic-e2e-secret'
$env:WHATSAPP_PUBLIC_NUMBER = '556900000000'
$env:WHATSAPP_PHONE_NUMBER_ID = 'synthetic-e2e-phone'
$env:WHATSAPP_ACCOUNT_IDS = 'synthetic-e2e-account'
$env:WHATSAPP_ALLOW_LOCAL_PAIRING = 'true'
$env:WHATSAPP_WORKER_ENABLED = 'false'
```

Esses valores são exemplos de teste, não credenciais de produção. No primeiro terminal, execute `pnpm dev`. No segundo:

```powershell
pnpm --filter @agromind/web exec playwright install chromium
pnpm --filter @agromind/web exec playwright test e2e/whatsapp.spec.ts
```

Os testes dessa jornada processam a mensagem sintética diretamente e não enviam mensagens para pessoas. Ao terminar, encerre esses terminais e inicie o ambiente normalmente, sem o override local de vínculo. O override não conecta o banco local ao WhatsApp publicado.

Smoke do piloto:

```powershell
node deploy/smoke.mjs https://agromind.ericksaymon.dev
```

## O que não foi comprovado

- Precisão geral com dados de produtores, adoção em campo ou benefício econômico medido.
- Conclusão do vínculo pessoal real da equipe e do roteiro definitivo de avaliação.
- Entrega de todos os e-mails ou mensagens futuras; aceite do provedor e entrega são estados distintos.
- Operação definitiva do app Meta fora do modo de desenvolvimento.
- Áudio, memória conversacional, interpretação por LLM e retiradas confirmadas no WhatsApp: ainda não implementados.
- Disponibilidade contratual, monitoramento contínuo e cópia automática de backups para fora da VM.

Dados simulados devem continuar identificados como exemplos em qualquer demonstração ou vídeo.
