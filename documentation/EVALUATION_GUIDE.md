# Guia de avaliação funcional

Este é um roteiro de conferência do aplicativo, não o roteiro do vídeo. A produção do vídeo permanece como última etapa, após o planejamento com a equipe.

## Escolher o ambiente

- **Demonstração pública:** [abrir](https://agromind.ericksaymon.dev/demo). Serve para explorar a interface com exemplos fictícios e temporários; não comprova persistência.
- **Conta operacional publicada:** criar conta, confirmar e-mail e configurar propriedade. Usa banco persistido; não recebe automaticamente os dados da instalação local.
- **Demonstração operacional local:** seguir a instalação e usar `pnpm demo:reset`. As credenciais próprias da demonstração ficam em `.private/demo.local.json`. Não publicar esse arquivo.

Não reinicialize dados de usuários para fazer uma apresentação. A rotina de reset só aceita propriedades identificadas como demonstração e sem outros membros.

## Percurso de conferência

| Passo | Ação | O que observar |
| --- | --- | --- |
| 1 | Explicar o problema e o público. | Decisões sobre falta, validade, consumo e excesso, além do simples cadastro. |
| 2 | Identificar a origem dos exemplos. | Dados simulados, sem alegação de serem registros de produtores. |
| 3 | Importar ou abrir os dados preparados. | Associação de colunas, revisão e confirmação; posição e histórico não são duplicados. |
| 4 | Abrir Dashboard e Alertas. | Prioridades e justificativas, com data/revisão do resultado. |
| 5 | Abrir Diesel S10 na base operacional local. | Saldo físico, lotes, mínimo e cobertura do histórico. Conferir os números atuais antes de anunciar uma estimativa. |
| 6 | Registrar uma saída pelo painel. | Quantidade, lote elegível, destino, autoria, saldo e histórico atualizados. |
| 7 | Aguardar a reanálise. | Nova revisão e estimativa compatível; estado pendente não deve ser apresentado como resultado final. |
| 8 | Abrir Inteligência. | Consumo, finanças, excesso, preços e simulação com condições e limites explícitos. |
| 9 | Mostrar um caso sem dados suficientes. | Autonomia indisponível ou campos desconhecidos, sem números inventados. |

Exemplo calculável na fixture: saldo elegível inicial de 420 L e média de 60 L/dia correspondem a sete dias. Uma saída de 150 L hoje, se mantidas essas condições e o histórico completo, deixa 270 L e autonomia estimada de 4,5 dias. Use esse exemplo apenas após conferir que a base, o lote selecionado e a cobertura correspondem ao cenário. Não aplicar os números à demo visual ou a uma conta com dados diferentes.

O CSV de histórico contém poucos registros e não substitui a fixture com cobertura suficiente para esse cálculo.

## WhatsApp como demonstração opcional

1. No **site publicado**, abrir Assistente, escolher a propriedade e gerar o código curto.
2. Pelo telefone que será vinculado, enviar a mensagem pronta.
3. Conferir no painel a propriedade vinculada.
4. Perguntar pelo saldo de um produto dessa propriedade e comparar com o painel.

O bot publicado não lê propriedades locais. A versão atual consulta por texto; pedidos de retirada não gravam movimentos. Se o vínculo pessoal ainda não tiver sido testado, não depender dele como único caminho da apresentação.

## Checklist de encerramento

- Conferir equipe, cursos, funções e responsável no [README](../README.md).
- Conferir critérios, dados simulados e limitações nos [documentos de regras](DATA_AND_RULES.md) e [validação](VALIDATION.md).
- Definir as condições de uso do código da equipe.
- Planejar e produzir o vídeo de até 90 segundos com legendas, somente na última etapa; incluir o link e os materiais no README.
- Registrar o commit ou tag final que será avaliado e conferir o acesso do GitHub cadastrado em Minha equipe.
- Não incluir credenciais, dados pessoais de terceiros, arquivos privados ou recursos ainda planejados como se estivessem entregues.
