# Terminal de Opções B3 — Simulador de Payoff, Volatilidade, Margem CORE & Carteira

Plataforma web desenvolvida em **React + TypeScript + Vite + Tailwind CSS + Recharts** para simulação quantitativa, análise de volatilidade, gestão de carteira multi-ativo e preparação de ordens de derivativos no mercado brasileiro (**B3**).

## Funcionalidades Principais

- **Motor Quantitativo B3 (Europeu & Americano):**
  - Conversão exponencial da taxa Selic/DI (`du/252` via $\ln(1 + r)$) com **calendário real B3/ANBIMA** (feriados fixos + móveis: Carnaval, Sexta-Feira Santa, Corpus Christi e ajuste automático da 3ª sexta-feira) e recálculo dinâmico de DTE.
  - Precificação **Black-Scholes-Merton** para opções europeias e **Bjerksund-Stensland (2002)** para opções americanas (com seletor `AM`/`EU` por perna, taxa de aluguel/BTC separada de DY não ajustado e validação cruzada contra árvore CRR).
  - Gregas de **1ª e 2ª ordem** (`Delta`, `Gamma`, `Theta/dia`, `Vega/+1pp IV`, `Rho`, `Vanna`, `Volga`, `Charm`), **IV Solver** (Newton-Raphson com fallback bisseção para europeias e americanas) e **PoP calibrado** pelo vencimento mais curto com seletor de drift (*Neutro ao Risco* vs. *Zero Drift*).
  - **50 estratégias catalogadas**, incluindo estruturas multi-vencimento (**Trava Calendário Call/Put**, **PMCC/PMCP Diagonais** e **Double Calendar**).
- **Curva de Payoff & Estresse What-If (`T+N`):**
  - Curva linear exata no vencimento (com injeção analítica dos strikes) sobreposta à curva teórica `T+N`.
  - Sliders de **Preço do Ativo**, **Passagem do Tempo (Theta)** e **Choque de IV (Paralelo ou Skew/Term-Aware)**.
- **Superfície & Regime de Volatilidade (Nova Aba):**
  - **Curva de Skew (Smile)** por strike para Calls e Puts com sobreposição dos strikes da estratégia atual.
  - **Estrutura a Termo (Term Structure)** ATM por vencimento (*Contango* vs. *Backwardation*), **Skew 25Δ**, **Butterfly 25Δ**, HV de referência e IV Rank/Percentile.
- **Custos B3 Completos & Margem por Cenários (Proxy CORE 2D):**
  - Motor de estresse **Preço × Volatilidade** em janela de *closeout* de 2 dias úteis capturando offsets naturais de portfólio e exibindo o **cenário vinculante** da chamada de margem.
  - Custos de entrada, saída antecipada e **exercício automático sobre o nocional (`strike × qty`)** apenas nas pernas ITM no vencimento, além de **IR (15% Swing / 20% Day-Trade)** com abatimento de **prejuízo acumulado** e IRRF informativo.
- **Carteira Consolidada & Diário (MtM):**
  - Marcação a mercado automática (via chain sincronizada ou teórica com DTE dinâmico), registro de **rolagens/ajustes**, encerramento com PnL realizado, **Beta-Weighted Delta (`BOVA11`)**, matriz de estresse consolidado no IBOV e **Backup/Restore JSON**.
- **Boleta Operacional B3 & Exportação:**
  - Resumo executável pronto para copiar com códigos B3, estilo (`AM`/`EU`), lotes de 100, slippage estimado, compartilhamento via URL, CSV e **Tearsheet PNG**.

## Variáveis de Ambiente

Crie um arquivo `.env.local` (opcional) caso queira apontar para outro endpoint GAS ou alterar o caminho base:

```bash
VITE_MARKET_API_URL=https://script.google.com/macros/s/SEU_SCRIPT_ID/exec
VITE_BASE_PATH=/simulador/
```

## Scripts

```bash
npm install        # Instala dependências
npm run dev        # Servidor de desenvolvimento local
npm run typecheck  # Verificação estrita TypeScript
npm test           # Suíte de testes unitários do motor financeiro (Vitest)
npm run build      # Build de produção otimizado com code-splitting
```

## Aviso Legal

Esta aplicação é uma ferramenta analítica quantitativa e educacional e **não constitui recomendação de compra ou venda de ativos ou derivativos**. Estimativas de margem por cenários (Proxy CORE B3), emolumentos/exercício e tributação devem sempre ser confirmadas junto à sua corretora antes do envio de ordens.