# Terminal de Opções B3 — Simulador de Payoff, Gregas & Boleta

Plataforma web desenvolvida em **React + TypeScript + Vite + Tailwind CSS + Recharts** para simulação, análise de risco e preparação de ordens de derivativos no mercado brasileiro (**B3**), projetada para o fluxo operacional do **Trader Pessoa Física**.

## Funcionalidades Principais

- **Motor Quantitativo Black-Scholes-Merton (B3):**
  - Suporte à convenção brasileira de dias úteis (`du/252`) ou dias corridos (`dc/365`), taxa Selic/DI editável e `dividend yield (q)`.
  - Precificação teórica, Gregas completas (`Delta`, `Gamma`, `Theta/dia`, `Vega/+1pp IV`, `Rho`), **IV Solver** (Newton-Raphson com fallback bisseção) e **Probabilidade de Lucro (PoP)** via distribuição log-normal.
  - Suporte a estratégias de **múltiplos vencimentos** (Travas Calendário e Diagonais) avaliadas no vencimento mais curto.
- **Curva de Payoff & Simulação What-If (`T+N`):**
  - Curva linear exata no vencimento (com injeção analítica dos strikes e divisão verde/vermelha no zero) sobreposta à curva teórica atual (`T+0` / `T+N`).
  - Três sliders interativos de estresse: **Preço do Ativo**, **Passagem do Tempo (Theta)** e **Choque de Volatilidade (Vega / IV Crush)**.
- **Option Chain B3 (T-Board Completo):**
  - Botões independentes de **Bid (Venda)** e **Ask (Compra)** tanto para **Calls** quanto para **Puts**.
  - Filtros de distância do Spot (`±10%`, `±20%`, `Todos`), liquidez, indicador de spread largo, destaque/centralização no ATM e integração com o Gateway **Google Apps Script (GAS)** com fallback automático para grade teórica B3 offline.
- **Matriz de Cenários (Heatmap Preço × Data):**
  - Projeção tabular 2D de PnL (`R$` ou `% sobre Margem`) ao longo do tempo até o vencimento.
- **Boleta Operacional B3, Custos & Diário:**
  - Resumo executável pronto para copiar com tickers de série B3, lotes de 100, slippage estimado, taxas B3 + IR (`15%` Swing / `20%` Day-Trade) e alertas pré-operacionais.
  - Persistência automática em `localStorage`, Diário de Operações (`Estudo`, `Em Aberto`, `Encerrada`), compartilhamento via URL, exportação CSV e **Tearsheet PNG** (`html2canvas` lazy-loaded).

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

Esta aplicação é uma ferramenta analítica e educacional e **não constitui recomendação de compra ou venda de ativos ou derivativos**. Estimativas de margem de garantia (CORE B3), emolumentos e tributação devem sempre ser confirmadas junto à sua corretora antes do envio de ordens.