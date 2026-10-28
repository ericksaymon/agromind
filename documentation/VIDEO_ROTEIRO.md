# Roteiro do vídeo demonstrativo — AgroMind

**Status:** planejamento; quadros, gravação e edição pendentes. A produção do vídeo será a última etapa definida pela equipe.

## Objetivo e formato

Apresentar o problema de controle de estoque rural e demonstrar uma sequência real no AgroMind: identificar um insumo que precisa de atenção, registrar uma saída e mostrar a atualização do saldo e da análise para apoiar uma decisão de reposição.

- **Duração planejada:** 45 segundos.
- **Formato:** horizontal, 16:9; preferencialmente 1920 × 1080.
- **Idioma:** português; sem narração. Os textos na tela devem permitir compreender o vídeo sem som.
- **Dados:** simulados, com a indicação “Dados simulados” durante a demonstração.
- **Estilo:** interface real como protagonista; animação simples na abertura e efeitos discretos que ajudem a acompanhar a ação.
- **Entrega:** vídeo final e materiais de apresentação no repositório, após revisão da equipe.

## Exemplo da demonstração

Usar o Diesel S10 da base operacional de demonstração, com os seguintes valores **previstos**:

| Momento | Saldo | Estoque mínimo | Autonomia estimada |
| --- | --- | --- | --- |
| Antes da saída | 420 L | 500 L | 7 dias |
| Após saída de 150 L | 270 L | 500 L | 4,5 dias |

Antes da gravação, conferir os números e o fluxo na conta operacional de demonstração. A movimentação precisa ser realmente salva e a análise recalculada. Se os resultados forem diferentes, ajustar o roteiro e as legendas ao que o sistema efetivamente mostrar. A demonstração pública `/demo` usa interações temporárias e não comprova persistência.

## Direção visual e áudio

- **Abertura:** ilustração simples de propriedade rural e reservatório; o nível baixa e um sinal de atenção conduz à interface. Deve ser claramente uma ilustração, sem simular uma funcionalidade do aplicativo.
- **Telas:** capturas reais, legíveis, com cursor visível e movimentos tranquilos. Fazer aproximações suaves nos indicadores e usar contornos discretos para orientar o olhar, sem encobrir valores ou alertas.
- **Transições:** cortes diretos e, na abertura e encerramento, transições suaves. Evitar efeitos que atrapalhem a leitura.
- **Legendas:** texto grande, alto contraste e frases curtas; evitar cobrir botões ou dados importantes. Cada texto deve permanecer tempo suficiente para leitura: a tabela indica quando entra ou muda, e não exige que desapareça após um segundo.
- **Áudio:** trilha instrumental discreta, opcional, com direito de uso confirmado; cliques ou sinais leves podem acompanhar ações. A música não é necessária para entender o vídeo. Evitar sons altos ou efeitos sobre cada movimento.
- **Identificação:** manter “Dados simulados” durante a demonstração e evitar exposição de credenciais, números de telefone ou informações pessoais.

## Sequência segundo a segundo

Os tempos são referências de montagem. Os trechos da interface devem corresponder à gravação e aos resultados reais; ajustar o tempo de uma ação se for necessário para manter a leitura clara.

| Tempo | Imagem e movimento | Texto na tela |
| --- | --- | --- |
| 0–1 s | Fundo com identidade AgroMind; surge silhueta simples de propriedade rural. | **Seu estoque pode acabar antes do esperado.** |
| 1–2 s | Aproximação de um reservatório ilustrado; o nível baixa. | A frase continua. |
| 2–3 s | Surge um sinal de atenção junto ao reservatório. | **Como saber a hora de repor?** |
| 3–4 s | O sinal conduz à interface do AgroMind. | A pergunta continua. |
| 4–5 s | Abre o painel real do aplicativo. | **AgroMind**. |
| 5–6 s | Painel parado para leitura; entra o rótulo no canto. | **Dados simulados**. |
| 6–7 s | Aproximação suave da área de alertas ou do Diesel S10. | **Acompanhe o que precisa de atenção.** |
| 7–8 s | Contorno discreto destaca o produto. | A frase continua. |
| 8–9 s | Corte para detalhes ou estoque do Diesel S10. | **Diesel S10**. |
| 9–10 s | Aproximação sobre o saldo atual. | **Estoque atual: 420 L**. |
| 10–11 s | Destaque se desloca ao estoque mínimo. | **Estoque mínimo: 500 L**. |
| 11–12 s | Contorno suave destaca o alerta real. | **Abaixo do mínimo**. |
| 12–13 s | A câmera vai até a autonomia estimada. | **Autonomia estimada: 7 dias**. |
| 13–14 s | Saldo, alerta e autonomia permanecem visíveis. | Os indicadores continuam na tela. |
| 14–15 s | Cursor se dirige à opção real de movimentação. | **Uma nova saída muda essa previsão.** |
| 15–16 s | Cursor abre a tela de movimentação. | A frase continua. |
| 16–17 s | Tela de registro aparece; campo do produto é destacado. | **Registrar saída**. |
| 17–18 s | Selecionar Diesel S10. | O título continua. |
| 18–19 s | Selecionar o tipo saída conforme o fluxo real. | **Saída de 150 L**. |
| 19–20 s | Preencher 150 no campo de quantidade. | O texto continua. |
| 20–21 s | Mostrar os demais campos obrigatórios preenchidos com dados de demonstração. | **Dados simulados** permanece visível. |
| 21–22 s | Cursor se aproxima do botão de confirmação. | **Registrar movimentação**. |
| 22–23 s | Clique real para registrar. | O texto continua. |
| 23–24 s | Mostrar a confirmação real de que a movimentação foi salva. | **Saída registrada**. |
| 24–25 s | Voltar às informações atualizadas do produto. | **O que mudou?** |
| 25–26 s | Quadro simples destaca o saldo anterior. | **Antes: 420 L**. |
| 26–27 s | Seta aponta para o novo saldo apresentado pelo aplicativo. | **Agora: 270 L**. |
| 27–28 s | Novo saldo permanece destacado. | **150 L foram retirados.** |
| 28–29 s | Destaque passa para a autonomia estimada. | **Antes: 7 dias**. |
| 29–30 s | Mostrar o novo resultado real ao lado. | **Agora: 4,5 dias**. |
| 30–31 s | Saldo e autonomia visíveis juntos. | **O estoque e a estimativa foram atualizados.** |
| 31–32 s | Destaque no alerta de estoque abaixo do mínimo. | **270 L disponíveis · mínimo de 500 L**. |
| 32–33 s | Aproximação do alerta. | **Atenção à reposição.** |
| 33–34 s | Interface real ao fundo; entra um cartão simples ao lado. | **Decisão: planejar a compra.** |
| 34–35 s | Seta discreta liga o alerta à decisão. | **Considere o consumo e o prazo do fornecedor.** |
| 35–36 s | Cartão e interface ficam parados para leitura. | A frase continua. |
| 36–37 s | Câmera se afasta para mostrar o painel. | **Mais clareza para decidir no campo.** |
| 37–38 s | Painel diminui suavemente para a tela final. | A frase continua. |
| 38–39 s | Marca AgroMind surge no centro. | **AgroMind**. |
| 39–40 s | Nome da equipe aparece abaixo. | **Equipe Commitou, Brotou**. |
| 40–41 s | Nomes completos entram em duas colunas ou quatro linhas legíveis. | Arthur Basseto Trevizan; Erick Saymon Contadini Markoviscz; Filipe Ribeiro Camargo; Tana de Souza Rocha. |
| 41–42 s | Tela final permanece estável. | Nomes completos continuam visíveis. |
| 42–43 s | Endereço do repositório aparece abaixo. | **github.com/ericksaymon/agromind**. |
| 43–44 s | Tela final parada para leitura. | Marca, equipe e endereço continuam. |
| 44–45 s | Fechamento suave. | **AgroMind · Commitou, Brotou**. |

## Preparação e revisão

1. Conferir a base operacional, os números, o fluxo de saída e o resultado da reanálise. Não reinicializar dados de usuários reais.
2. Preparar quadros parados de cada cena e revisar com a equipe antes de animar.
3. Na etapa final, gravar a interface real e montar o vídeo com as legendas e os efeitos escolhidos.
4. Conferir legibilidade, tempo de leitura, indicação de dados simulados, nomes, endereço e funcionamento sem áudio.
5. Revisar a versão final e incluir o vídeo e os materiais da apresentação no repositório.

O regulamento também prevê que a apresentação explique os critérios dos alertas, o uso das informações pelo responsável e as limitações. O vídeo complementa essa apresentação e não substitui a documentação ou a demonstração da equipe.
