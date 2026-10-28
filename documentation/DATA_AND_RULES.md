# Dados, tratamentos e regras de análise

## Origem e propósito

A equipe informou que não receberá uma planilha de registros. Os testes e exemplos usam dados simulados baseados nos campos e categorias descritos no [desafio e regulamento](https://incubadora.cloud/agrohack/assets/regulamento-agrohack.pdf). Não representam registros reais de produtores nem recomendações agronômicas.

Fontes reproduzíveis no repositório:

- [Posição de estoque em CSV](../apps/web/public/modelo-estoque.csv).
- [Histórico em CSV](../apps/web/public/modelo-movimentacoes.csv).
- [Fixture operacional](../apps/api/src/demo-fixture.ts), com seis produtos e histórico relativo à data de preparação.
- [Testes](../apps/api/test), com cenários sintéticos de cálculo, importação e permissões.

O CSV pequeno explica o formato; sozinho não fornece histórico suficiente para todos os detectores. A demonstração operacional é preparada separadamente por `pnpm demo:reset`, somente no ambiente local.

## Tratamentos

| Situação | Tratamento |
| --- | --- |
| Posição versus histórico | Posição gera abertura. Não somar posição final e histórico como duas entradas. |
| Quantidades e custos | Aritmética decimal; unidades incompatíveis não são somadas. |
| Campos ausentes | Mínimo, custo e validade desconhecidos são sinalizados, sem valores inventados. |
| Datas | Diferenciar data da movimentação, data de registro e fuso da propriedade. |
| Responsável histórico | Preservar separadamente do usuário que importou o arquivo. |
| Duplicidades/grafias | Revisar equivalências e registros na prévia; não há fusão automática geral de produtos. |
| Saída genérica | Não presumir consumo de uso. Classificação posterior exige motivo e registro auditável. |
| Correção | Estornar o movimento original com vínculo, preservando histórico. |

## Saldo, mínimo e autonomia

Saldo físico é a soma dos saldos dos lotes. Saldo elegível conhecido exclui lotes vencidos e de validade desconhecida. Validade “não aplicável” é diferente de validade ausente.

O alerta de mínimo exige mínimo informado e positivo e saldo elegível abaixo dele. Não se presume que um campo ausente represente mínimo zero confirmado.

A média de consumo usa retiradas confirmadas como uso, exclui estornos e considera dias completos corridos. A cobertura do histórico precisa estar confirmada até ontem no fuso da propriedade. A janela recente tem até 30 dias; são necessários ao menos sete dias completos e consumo positivo para calcular a média. Entre sete e 29 dias, a estimativa é preliminar.

`média diária = consumo confirmado na janela / dias completos observados`

`autonomia estimada = saldo elegível conhecido / média diária`

Exemplo sintético coberto pelos testes: 420 L elegíveis e média de 60 L/dia resultam em sete dias. Uma retirada atual que deixe 270 L reduz a estimativa para 4,5 dias; o dia atual incompleto não aumenta a média usada no cálculo.

Sem cobertura, sem amostra mínima ou sem consumo positivo, o resultado é indisponível. Consumo irregular gera limitação adicional. Referências: [motor](../apps/api/src/analysis-engine.ts) e [teste do exemplo](../apps/api/test/analysis-engine.test.ts).

## Validade, falta e exposição financeira

Lotes com saldo e data passada são sinalizados como vencidos. Lotes próximos da validade usam a janela configurada. Quando existe demanda estimável, a projeção distribui o consumo pela ordem de validade (FEFO), sem atribuir a mesma demanda a vários lotes.

O risco de falta compara a autonomia com o horizonte de reposição aplicável. Custos são considerados por lote; custos desconhecidos têm cobertura separada. A exposição por validade não soma duas vezes o mesmo saldo de lote.

## Consumo incomum, preços e excesso

Os critérios são parâmetros do aplicativo, sujeitos a configuração administrativa e versionamento. Não são limites agronômicos universais.

Os padrões de inteligência declarados em [contracts](../packages/contracts/src/index.ts) são: comparação de 30 dias, mudança de consumo de 50%, tendência de 20%, multiplicador de retirada 3, amostra mínima de dez retiradas, excesso em horizonte de 90 dias, variação de preço de 20%, participação financeira de 20% e piso de mudança de quantidade 1. Cada detector também exige suas condições de cobertura e comparabilidade.

Retirada incomum usa registros anteriores ao próprio evento, mediana e desvio absoluto mediano. Preços comparam aquisições com preço conhecido da mesma unidade. Comparação com consumo anterior zero não produz porcentagem infinita. Alto valor parado e excesso estimado não significam perda financeira confirmada.

Referência completa dos cálculos: [intelligence-engine](../apps/api/src/intelligence-engine.ts).

## Prioridades, acompanhamento e limites

As ocorrências distinguem prioridades críticas, altas e moderadas. São acompanhadas por estados humanos como pendente, em análise, resolvida e descartada. Encerrar o acompanhamento não muda a aritmética do estoque.

Cada resultado identifica revisão, data de referência, política e versão das regras (`inventory-5.3` no estado conferido). Mudanças relevantes invalidam a análise; resultados pendentes ou desatualizados não devem ser apresentados como atuais.

Relatórios: até 365 dias, com recusa explícita acima de 50.000 movimentos. Importação: até 1.000 linhas por envio. WhatsApp: até 500 produtos por consulta e oito itens por lista, avisando listas parciais. Não há sazonalidade automática, agenda de pedidos confirmados ou garantia de previsão. Simulação é somente leitura.
