import {
  Leg,
  MarketDataResponse,
  MarketOption,
  MarketParams,
  StrategyTemplate,
} from '../types/options';
import { greeksOption, priceOption } from './americanPricing';
import { getContinuousMarketRates, inferDefaultB3ExerciseStyle } from './blackScholes';
import {
  generateB3OptionTicker,
  getTimeToMaturityYears,
  getUpcomingB3Expiries,
} from './calendar';

export const generateLegId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).substring(2, 10);

/**
 * Rounds a raw strike to standard B3 strike increments (R$ 0.25 / R$ 0.50 / R$ 1.00).
 */
export function roundToB3Strike(rawStrike: number): number {
  if (rawStrike < 15) return Math.round(rawStrike * 4) / 4;
  if (rawStrike < 60) return Math.round(rawStrike * 2) / 2;
  return Math.round(rawStrike);
}

/**
 * Institutional Catalog: 45 Derivatives Strategies (with corrected Collar & Synthetic Put)
 */
export const STRATEGIES: StrategyTemplate[] = [
  // BULLISH (1-9)
  {
    id: 'long-call',
    code: 1,
    name: 'Compra de Call (Long)',
    category: 'Bullish',
    riskProfile: 'Definido',
    complexity: 'Iniciante',
    description: 'Compra de Call a seco com risco limitado ao prêmio.',
    details: {
      thesis: 'Expectativa de forte valorização do ativo-objeto.',
      mechanics: 'Aquisição do direito de compra com alavancagem e perda máxima travada.',
      idealScenario: 'Movimento explosivo de alta acima do breakeven no curto prazo.',
      greeks: 'Delta +, Gamma +, Theta -, Vega +',
    },
    legSpecs: [{ type: 'Call', action: 'Buy', moneyness: 1.0, quantity: 100 }],
  },
  {
    id: 'short-put',
    code: 2,
    name: 'Venda de Put (Cash-Secured)',
    category: 'Bullish',
    riskProfile: 'Definido',
    complexity: 'Iniciante',
    description: 'Venda de Put para geração de renda ou compra descontada.',
    details: {
      thesis: 'Mercado estável ou altista; disposição para comprar o ativo no strike.',
      mechanics: 'Venda de obrigação de compra recebendo prêmio adiantado.',
      idealScenario: 'Ativo permanece acima do strike até o vencimento (opção vira pó).',
      greeks: 'Delta +, Gamma -, Theta +, Vega -',
    },
    legSpecs: [{ type: 'Put', action: 'Sell', moneyness: 0.95, quantity: 100 }],
  },
  {
    id: 'bull-call-spread',
    code: 3,
    name: 'Trava de Alta com Call (Bull Call)',
    category: 'Bullish',
    riskProfile: 'Definido',
    complexity: 'Iniciante',
    description: 'Compra Call ATM e vende Call OTM para reduzir custo.',
    details: {
      thesis: 'Valorização moderada com custo e impacto de Theta reduzidos.',
      mechanics: 'Compra Call mais baixa e vende Call mais alta no mesmo vencimento.',
      idealScenario: 'Ativo fecha acima do strike da Call vendida no vencimento.',
      greeks: 'Delta +, Risco e Retorno Definidos',
    },
    legSpecs: [
      { type: 'Call', action: 'Buy', moneyness: 1.0, quantity: 100 },
      { type: 'Call', action: 'Sell', moneyness: 1.05, quantity: 100 },
    ],
  },
  {
    id: 'bull-put-spread',
    code: 4,
    name: 'Trava de Alta com Put (Bull Put)',
    category: 'Bullish',
    riskProfile: 'Definido',
    complexity: 'Iniciante',
    description: 'Trava de crédito em mercado lateral ou altista.',
    details: {
      thesis: 'Rentabilização por decaimento temporal (Theta) acima de um suporte.',
      mechanics: 'Vende Put mais alta e compra Put mais baixa como proteção.',
      idealScenario: 'Ativo permanece acima do strike vendido até o vencimento.',
      greeks: 'Delta +, Theta +, Risco Definido',
    },
    legSpecs: [
      { type: 'Put', action: 'Sell', moneyness: 0.96, quantity: 100 },
      { type: 'Put', action: 'Buy', moneyness: 0.91, quantity: 100 },
    ],
  },
  {
    id: 'call-ratio-spread',
    code: 5,
    name: 'Call Ratio Spread (1x2)',
    category: 'Bullish',
    riskProfile: 'Ilimitado',
    complexity: 'Avançado',
    description: 'Compra 1 Call e vende 2 Calls OTM (trava financiada).',
    details: {
      thesis: 'Alta moderada até um alvo específico com desembolso mínimo ou crédito.',
      mechanics: 'A venda dupla OTM financia a compra ATM, criando risco acima do breakeven superior.',
      idealScenario: 'Ativo encerra exatamente no strike das Calls vendidas (pin).',
      greeks: 'Theta +, Risco Ilimitado na Alta Explosiva',
    },
    legSpecs: [
      { type: 'Call', action: 'Buy', moneyness: 1.0, quantity: 100 },
      { type: 'Call', action: 'Sell', moneyness: 1.05, quantity: 200 },
    ],
  },
  {
    id: 'risk-reversal-bull',
    code: 6,
    name: 'Risk Reversal (Alta)',
    category: 'Bullish',
    riskProfile: 'Definido',
    complexity: 'Intermediário',
    description: 'Compra Call OTM financiada pela venda de Put OTM.',
    details: {
      thesis: 'Exposição direcional altista aproveitando o skew de volatilidade.',
      mechanics: 'Compra Call OTM e vende Put OTM com custo próximo de zero.',
      idealScenario: 'Subida expressiva acima do strike da Call comprada.',
      greeks: 'Delta + (~0.5 a 0.8), Baixo Theta',
    },
    legSpecs: [
      { type: 'Call', action: 'Buy', moneyness: 1.05, quantity: 100 },
      { type: 'Put', action: 'Sell', moneyness: 0.95, quantity: 100 },
    ],
  },
  {
    id: 'call-backspread',
    code: 7,
    name: 'Call Ratio Backspread',
    category: 'Bullish',
    riskProfile: 'Definido',
    complexity: 'Avançado',
    description: 'Vende 1 Call ATM e compra 2 Calls OTM.',
    details: {
      thesis: 'Aposta em explosão de alta e aumento de volatilidade implícita.',
      mechanics: 'Venda da Call ATM financia a compra em dobro de Calls OTM.',
      idealScenario: 'Rompimento violento acima da resistência superior.',
      greeks: 'Gamma +, Vega +, Lucro Ilimitado',
    },
    legSpecs: [
      { type: 'Call', action: 'Sell', moneyness: 1.0, quantity: 100 },
      { type: 'Call', action: 'Buy', moneyness: 1.05, quantity: 200 },
    ],
  },
  {
    id: 'bull-call-ladder',
    code: 8,
    name: 'Bull Call Ladder (Escada de Alta)',
    category: 'Bullish',
    riskProfile: 'Ilimitado',
    complexity: 'Avançado',
    description: 'Trava de alta com venda adicional de Call superior.',
    details: {
      thesis: 'Alta moderada com redução adicional de custo (ou crédito).',
      mechanics: 'Compra Call ATM, vende Call OTM e vende outra Call mais OTM.',
      idealScenario: 'Ativo termina entre os dois strikes vendidos.',
      greeks: 'Theta + no miolo, Risco na alta extrema',
    },
    legSpecs: [
      { type: 'Call', action: 'Buy', moneyness: 1.0, quantity: 100 },
      { type: 'Call', action: 'Sell', moneyness: 1.05, quantity: 100 },
      { type: 'Call', action: 'Sell', moneyness: 1.1, quantity: 100 },
    ],
  },
  {
    id: 'synthetic-long-stock',
    code: 9,
    name: 'Ativo Sintético Comprado',
    category: 'Bullish',
    riskProfile: 'Definido',
    complexity: 'Intermediário',
    description: 'Réplica sintética da ação via Call comprada + Put vendida ATM.',
    details: {
      thesis: 'Replicar exposição direcional de 100% no ativo com menor caixa inicial.',
      mechanics: 'Compra Call ATM e vende Put no mesmo strike e vencimento.',
      idealScenario: 'Qualquer valorização do ativo-objeto.',
      greeks: 'Delta ≈ +1.0 por lote, Gamma ≈ 0',
    },
    legSpecs: [
      { type: 'Call', action: 'Buy', moneyness: 1.0, quantity: 100 },
      { type: 'Put', action: 'Sell', moneyness: 1.0, quantity: 100 },
    ],
  },

  // BEARISH (10-18)
  {
    id: 'long-put',
    code: 10,
    name: 'Compra de Put (Long)',
    category: 'Bearish',
    riskProfile: 'Definido',
    complexity: 'Iniciante',
    description: 'Compra de Put a seco para lucrar na queda ou proteger carteira.',
    details: {
      thesis: 'Expectativa de queda acentuada ou seguro contra crash.',
      mechanics: 'Direito de vender o ativo a preço fixo com risco limitado ao prêmio.',
      idealScenario: 'Desvalorização brusca abaixo do breakeven.',
      greeks: 'Delta -, Gamma +, Theta -, Vega +',
    },
    legSpecs: [{ type: 'Put', action: 'Buy', moneyness: 1.0, quantity: 100 }],
  },
  {
    id: 'short-call',
    code: 11,
    name: 'Venda de Call Descoberta (Naked)',
    category: 'Bearish',
    riskProfile: 'Ilimitado',
    complexity: 'Avançado',
    description: 'Venda de Call a seco com risco ilimitado na alta.',
    details: {
      thesis: 'Mercado lateral ou em queda abaixo de forte resistência.',
      mechanics: 'Coleta de prêmio vendendo obrigação de entrega sem possuir a ação.',
      idealScenario: 'Ativo encerra abaixo do strike vendido.',
      greeks: 'Delta -, Theta +, Risco Ilimitado',
    },
    legSpecs: [{ type: 'Call', action: 'Sell', moneyness: 1.05, quantity: 100 }],
  },
  {
    id: 'bear-put-spread',
    code: 12,
    name: 'Trava de Baixa com Put (Bear Put)',
    category: 'Bearish',
    riskProfile: 'Definido',
    complexity: 'Iniciante',
    description: 'Compra Put ATM e vende Put OTM para queda moderada.',
    details: {
      thesis: 'Queda direcional moderada com desembolso reduzido.',
      mechanics: 'Compra Put de strike maior e vende Put de strike menor.',
      idealScenario: 'Ativo cai até ou abaixo do strike da Put vendida.',
      greeks: 'Delta -, Risco e Lucro Definidos',
    },
    legSpecs: [
      { type: 'Put', action: 'Buy', moneyness: 1.0, quantity: 100 },
      { type: 'Put', action: 'Sell', moneyness: 0.95, quantity: 100 },
    ],
  },
  {
    id: 'bear-call-spread',
    code: 13,
    name: 'Trava de Baixa com Call (Bear Call)',
    category: 'Bearish',
    riskProfile: 'Definido',
    complexity: 'Iniciante',
    description: 'Trava de crédito apostando que o ativo não rompe resistência.',
    details: {
      thesis: 'Geração de renda com risco limitado em mercado lateral/baixista.',
      mechanics: 'Vende Call OTM e compra Call mais OTM como trava de proteção.',
      idealScenario: 'Ativo permanece abaixo do strike vendido no vencimento.',
      greeks: 'Delta -, Theta +, Risco Definido',
    },
    legSpecs: [
      { type: 'Call', action: 'Sell', moneyness: 1.04, quantity: 100 },
      { type: 'Call', action: 'Buy', moneyness: 1.09, quantity: 100 },
    ],
  },
  {
    id: 'put-ratio-spread',
    code: 14,
    name: 'Put Ratio Spread (1x2)',
    category: 'Bearish',
    riskProfile: 'Definido',
    complexity: 'Avançado',
    description: 'Compra 1 Put e vende 2 Puts OTM.',
    details: {
      thesis: 'Queda moderada até um suporte com baixo custo inicial.',
      mechanics: 'Venda dupla OTM financia a compra ATM; risco aumenta abaixo do breakeven inferior.',
      idealScenario: 'Pin exatamente no strike das Puts vendidas.',
      greeks: 'Theta +, Risco Elevado em Crash',
    },
    legSpecs: [
      { type: 'Put', action: 'Buy', moneyness: 1.0, quantity: 100 },
      { type: 'Put', action: 'Sell', moneyness: 0.92, quantity: 200 },
    ],
  },
  {
    id: 'put-backspread',
    code: 15,
    name: 'Put Ratio Backspread',
    category: 'Bearish',
    riskProfile: 'Definido',
    complexity: 'Avançado',
    description: 'Vende 1 Put ATM e compra 2 Puts OTM para lucrar em crash.',
    details: {
      thesis: 'Proteção de cauda (Tail Risk) ou aposta em pânico financeiro.',
      mechanics: 'Venda da Put ATM financia compra dupla de Puts OTM.',
      idealScenario: 'Queda forte acompanhada de explosão de volatilidade.',
      greeks: 'Delta -, Gamma +, Vega +',
    },
    legSpecs: [
      { type: 'Put', action: 'Sell', moneyness: 1.0, quantity: 100 },
      { type: 'Put', action: 'Buy', moneyness: 0.93, quantity: 200 },
    ],
  },
  {
    id: 'bear-put-ladder',
    code: 16,
    name: 'Bear Put Ladder (Escada de Baixa)',
    category: 'Bearish',
    riskProfile: 'Definido',
    complexity: 'Avançado',
    description: 'Bear Put Spread com venda de Put OTM adicional.',
    details: {
      thesis: 'Queda controlada com custo reduzido ou crédito inicial.',
      mechanics: 'Compra Put ATM e vende duas Puts em strikes descendentes.',
      idealScenario: 'Ativo estabiliza entre os dois strikes vendidos.',
      greeks: 'Theta + no intervalo central',
    },
    legSpecs: [
      { type: 'Put', action: 'Buy', moneyness: 1.0, quantity: 100 },
      { type: 'Put', action: 'Sell', moneyness: 0.95, quantity: 100 },
      { type: 'Put', action: 'Sell', moneyness: 0.9, quantity: 100 },
    ],
  },
  {
    id: 'synthetic-short-stock',
    code: 17,
    name: 'Ativo Sintético Vendido',
    category: 'Bearish',
    riskProfile: 'Ilimitado',
    complexity: 'Intermediário',
    description: 'Réplica de venda a descoberto sem aluguel de ações.',
    details: {
      thesis: 'Exposição integral à queda do ativo-objeto via derivativos.',
      mechanics: 'Venda Call ATM e compra Put ATM no mesmo strike.',
      idealScenario: 'Desvalorização consistente do ativo.',
      greeks: 'Delta ≈ -1.0 por lote, Risco Ilimitado na Alta',
    },
    legSpecs: [
      { type: 'Call', action: 'Sell', moneyness: 1.0, quantity: 100 },
      { type: 'Put', action: 'Buy', moneyness: 1.0, quantity: 100 },
    ],
  },
  {
    id: 'synthetic-long-put',
    code: 18,
    name: 'Put Sintética (Short Stock + Call)',
    category: 'Bearish',
    riskProfile: 'Definido',
    complexity: 'Intermediário',
    description: 'Venda da ação protegida por compra de Call (equivale a Long Put).',
    details: {
      thesis: 'Apostar na queda do ativo mantendo trava de perda máxima na alta.',
      mechanics: 'Venda do ativo-objeto combinada com compra de Call ATM como stop estrutural.',
      idealScenario: 'Queda acentuada do ativo após a montagem.',
      greeks: 'Delta -, Gamma +, Perda Máxima Travada',
    },
    legSpecs: [
      { type: 'Stock', action: 'Sell', moneyness: 1.0, quantity: 100 },
      { type: 'Call', action: 'Buy', moneyness: 1.0, quantity: 100 },
    ],
  },

  // VOLATILITY (19-27)
  {
    id: 'long-straddle',
    code: 19,
    name: 'Straddle Comprado',
    category: 'Volatility',
    riskProfile: 'Definido',
    complexity: 'Intermediário',
    description: 'Compra simultânea de Call e Put ATM (aposta em explosão).',
    details: {
      thesis: 'Movimento forte esperado (balanço, COPOM, evento) sem viés direcional.',
      mechanics: 'Compra de volatilidade pura no strike ATM.',
      idealScenario: 'Rompimento violento para qualquer direção além dos breakevens.',
      greeks: 'Delta Neutro, Gamma ++, Vega ++, Theta --',
    },
    legSpecs: [
      { type: 'Call', action: 'Buy', moneyness: 1.0, quantity: 100 },
      { type: 'Put', action: 'Buy', moneyness: 1.0, quantity: 100 },
    ],
  },
  {
    id: 'long-strangle',
    code: 20,
    name: 'Strangle Comprado',
    category: 'Volatility',
    riskProfile: 'Definido',
    complexity: 'Intermediário',
    description: 'Compra de Call OTM e Put OTM com custo menor que o Straddle.',
    details: {
      thesis: 'Explosão de preço com menor desembolso inicial.',
      mechanics: 'Aquisição de opções fora do dinheiro em ambos os lados.',
      idealScenario: 'Movimento amplo e rápido com expansão de IV.',
      greeks: 'Delta Neutro, Vega +, Gamma +',
    },
    legSpecs: [
      { type: 'Put', action: 'Buy', moneyness: 0.95, quantity: 100 },
      { type: 'Call', action: 'Buy', moneyness: 1.05, quantity: 100 },
    ],
  },
  {
    id: 'strip',
    code: 21,
    name: 'Strip (Volatilidade Baixista)',
    category: 'Volatility',
    riskProfile: 'Definido',
    complexity: 'Intermediário',
    description: 'Compra de 2 Puts e 1 Call ATM.',
    details: {
      thesis: 'Forte movimento esperado com maior probabilidade de queda.',
      mechanics: 'Straddle assimétrico com peso duplo na ponta de Put.',
      idealScenario: 'Queda abrupta do ativo-objeto.',
      greeks: 'Delta -, Gamma ++, Vega ++',
    },
    legSpecs: [
      { type: 'Put', action: 'Buy', moneyness: 1.0, quantity: 200 },
      { type: 'Call', action: 'Buy', moneyness: 1.0, quantity: 100 },
    ],
  },
  {
    id: 'strap',
    code: 22,
    name: 'Strap (Volatilidade Altista)',
    category: 'Volatility',
    riskProfile: 'Definido',
    complexity: 'Intermediário',
    description: 'Compra de 2 Calls e 1 Put ATM.',
    details: {
      thesis: 'Forte movimento esperado com maior probabilidade de alta.',
      mechanics: 'Straddle assimétrico com peso duplo na ponta de Call.',
      idealScenario: 'Valorização explosiva do ativo-objeto.',
      greeks: 'Delta +, Gamma ++, Vega ++',
    },
    legSpecs: [
      { type: 'Call', action: 'Buy', moneyness: 1.0, quantity: 200 },
      { type: 'Put', action: 'Buy', moneyness: 1.0, quantity: 100 },
    ],
  },
  {
    id: 'long-guts',
    code: 23,
    name: 'Guts Comprado',
    category: 'Volatility',
    riskProfile: 'Definido',
    complexity: 'Avançado',
    description: 'Compra simultânea de Call ITM e Put ITM.',
    details: {
      thesis: 'Aposta em movimento extremo utilizando opções dentro do dinheiro.',
      mechanics: 'Custo inicial alto compensado por valor intrínseco elevado.',
      idealScenario: 'Rompimento amplo fora da faixa entre os dois strikes.',
      greeks: 'Delta Neutro, Vega +',
    },
    legSpecs: [
      { type: 'Call', action: 'Buy', moneyness: 0.95, quantity: 100 },
      { type: 'Put', action: 'Buy', moneyness: 1.05, quantity: 100 },
    ],
  },
  {
    id: 'reverse-iron-condor',
    code: 24,
    name: 'Iron Condor Reverso',
    category: 'Volatility',
    riskProfile: 'Definido',
    complexity: 'Intermediário',
    description: 'Compra de volatilidade com risco e retorno travados.',
    details: {
      thesis: 'Ativo em compressão lateral prestes a romper suporte ou resistência.',
      mechanics: 'Compra travas direcionais (Bull Call + Bear Put) fora do dinheiro.',
      idealScenario: 'Ativo fecha fora das asas externas.',
      greeks: 'Vega +, Risco Definido',
    },
    legSpecs: [
      { type: 'Put', action: 'Sell', moneyness: 0.9, quantity: 100 },
      { type: 'Put', action: 'Buy', moneyness: 0.95, quantity: 100 },
      { type: 'Call', action: 'Buy', moneyness: 1.05, quantity: 100 },
      { type: 'Call', action: 'Sell', moneyness: 1.1, quantity: 100 },
    ],
  },
  {
    id: 'short-call-butterfly',
    code: 25,
    name: 'Borboleta Reversa (Call)',
    category: 'Volatility',
    riskProfile: 'Definido',
    complexity: 'Avançado',
    description: 'Venda das asas e compra dupla do miolo com Calls.',
    details: {
      thesis: 'Aposta de que o ativo se afastará do preço atual até o vencimento.',
      mechanics: 'Vende 1 Call baixa, compra 2 Calls ATM, vende 1 Call alta.',
      idealScenario: 'Ativo encerra abaixo da asa inferior ou acima da superior.',
      greeks: 'Vega +, Gamma +, Risco Definido',
    },
    legSpecs: [
      { type: 'Call', action: 'Sell', moneyness: 0.95, quantity: 100 },
      { type: 'Call', action: 'Buy', moneyness: 1.0, quantity: 200 },
      { type: 'Call', action: 'Sell', moneyness: 1.05, quantity: 100 },
    ],
  },
  {
    id: 'short-put-butterfly',
    code: 26,
    name: 'Borboleta Reversa (Put)',
    category: 'Volatility',
    riskProfile: 'Definido',
    complexity: 'Avançado',
    description: 'Borboleta reversa estruturada com Puts.',
    details: {
      thesis: 'Afastamento do preço central utilizando Puts com risco travado.',
      mechanics: 'Vende 1 Put baixa, compra 2 Puts ATM, vende 1 Put alta.',
      idealScenario: 'Ativo encerra fora das asas.',
      greeks: 'Vega +, Gamma +',
    },
    legSpecs: [
      { type: 'Put', action: 'Sell', moneyness: 0.95, quantity: 100 },
      { type: 'Put', action: 'Buy', moneyness: 1.0, quantity: 200 },
      { type: 'Put', action: 'Sell', moneyness: 1.05, quantity: 100 },
    ],
  },
  {
    id: 'double-backspread',
    code: 27,
    name: 'Double Backspread (Volatilidade)',
    category: 'Volatility',
    riskProfile: 'Definido',
    complexity: 'Avançado',
    description: 'Backspread simultâneo em Calls e Puts para expansão extrema.',
    details: {
      thesis: 'Grande expansão de volatilidade bilateral.',
      mechanics: 'Vende Straddle ATM e compra Strangle OTM em dobro.',
      idealScenario: 'Movimento violento em qualquer direção.',
      greeks: 'Gamma ++, Vega ++',
    },
    legSpecs: [
      { type: 'Call', action: 'Sell', moneyness: 1.0, quantity: 100 },
      { type: 'Call', action: 'Buy', moneyness: 1.06, quantity: 200 },
      { type: 'Put', action: 'Sell', moneyness: 1.0, quantity: 100 },
      { type: 'Put', action: 'Buy', moneyness: 0.94, quantity: 200 },
    ],
  },

  // INCOME (28-38)
  {
    id: 'short-straddle',
    code: 28,
    name: 'Straddle Vendido',
    category: 'Income',
    riskProfile: 'Ilimitado',
    complexity: 'Avançado',
    description: 'Venda de Call e Put ATM para máxima coleta de Theta.',
    details: {
      thesis: 'Mercado lateralizado com volatilidade implícita elevada (IV Rank alto).',
      mechanics: 'Recebe prêmio máximo vendendo ambas as pontas no dinheiro.',
      idealScenario: 'Ativo encerra próximo ao strike central com queda de IV.',
      greeks: 'Theta ++, Vega --, Risco Ilimitado',
    },
    legSpecs: [
      { type: 'Call', action: 'Sell', moneyness: 1.0, quantity: 100 },
      { type: 'Put', action: 'Sell', moneyness: 1.0, quantity: 100 },
    ],
  },
  {
    id: 'short-strangle',
    code: 29,
    name: 'Strangle Vendido',
    category: 'Income',
    riskProfile: 'Ilimitado',
    complexity: 'Avançado',
    description: 'Venda de Put OTM e Call OTM com faixa larga de lucro.',
    details: {
      thesis: 'Mercado dentro de canal lateral com alta probabilidade de lucro (PoP).',
      mechanics: 'Venda de opções OTM exigindo margem de garantia na B3.',
      idealScenario: 'Ativo permanece entre os dois strikes vendidos.',
      greeks: 'Theta +, Vega -, Risco Ilimitado na Alta',
    },
    legSpecs: [
      { type: 'Put', action: 'Sell', moneyness: 0.92, quantity: 100 },
      { type: 'Call', action: 'Sell', moneyness: 1.08, quantity: 100 },
    ],
  },
  {
    id: 'iron-condor',
    code: 30,
    name: 'Iron Condor (Renda Travada)',
    category: 'Income',
    riskProfile: 'Definido',
    complexity: 'Intermediário',
    description: 'Strangle vendido protegido por asas OTM (risco definido).',
    details: {
      thesis: 'Coleta de Theta em mercado lateral com perda máxima controlada.',
      mechanics: 'Bull Put Spread + Bear Call Spread no mesmo vencimento.',
      idealScenario: 'Ativo encerra dentro do miolo entre os strikes vendidos.',
      greeks: 'Theta +, Vega -, Risco Definido',
    },
    legSpecs: [
      { type: 'Put', action: 'Buy', moneyness: 0.9, quantity: 100 },
      { type: 'Put', action: 'Sell', moneyness: 0.95, quantity: 100 },
      { type: 'Call', action: 'Sell', moneyness: 1.05, quantity: 100 },
      { type: 'Call', action: 'Buy', moneyness: 1.1, quantity: 100 },
    ],
  },
  {
    id: 'iron-butterfly',
    code: 31,
    name: 'Iron Butterfly (Mesa / Renda)',
    category: 'Income',
    riskProfile: 'Definido',
    complexity: 'Intermediário',
    description: 'Straddle vendido travado com asas OTM.',
    details: {
      thesis: 'Estabilidade de preço com alto crédito inicial e risco limitado.',
      mechanics: 'Vende Call e Put ATM, compra Call e Put OTM como proteção.',
      idealScenario: 'Ativo fecha exatamente no strike central.',
      greeks: 'Theta ++, Vega -, Risco Definido',
    },
    legSpecs: [
      { type: 'Put', action: 'Buy', moneyness: 0.94, quantity: 100 },
      { type: 'Put', action: 'Sell', moneyness: 1.0, quantity: 100 },
      { type: 'Call', action: 'Sell', moneyness: 1.0, quantity: 100 },
      { type: 'Call', action: 'Buy', moneyness: 1.06, quantity: 100 },
    ],
  },
  {
    id: 'long-call-butterfly',
    code: 32,
    name: 'Borboleta Clássica (Call)',
    category: 'Income',
    riskProfile: 'Definido',
    complexity: 'Intermediário',
    description: 'Estrutura 1-2-1 com Calls de baixo custo e alto payoff no alvo.',
    details: {
      thesis: 'Alvo preciso de preço no vencimento com risco muito reduzido.',
      mechanics: 'Compra 1 Call ITM, vende 2 Calls ATM, compra 1 Call OTM.',
      idealScenario: 'Pin exato no strike central das Calls vendidas.',
      greeks: 'Theta + perto do alvo, Risco Baixo',
    },
    legSpecs: [
      { type: 'Call', action: 'Buy', moneyness: 0.95, quantity: 100 },
      { type: 'Call', action: 'Sell', moneyness: 1.0, quantity: 200 },
      { type: 'Call', action: 'Buy', moneyness: 1.05, quantity: 100 },
    ],
  },
  {
    id: 'long-put-butterfly',
    code: 33,
    name: 'Borboleta Clássica (Put)',
    category: 'Income',
    riskProfile: 'Definido',
    complexity: 'Intermediário',
    description: 'Estrutura 1-2-1 com Puts.',
    details: {
      thesis: 'Alvo preciso de preço com risco estritamente limitado.',
      mechanics: 'Compra 1 Put OTM, vende 2 Puts ATM, compra 1 Put ITM.',
      idealScenario: 'Pin no strike central.',
      greeks: 'Theta +, Risco Definido',
    },
    legSpecs: [
      { type: 'Put', action: 'Buy', moneyness: 0.95, quantity: 100 },
      { type: 'Put', action: 'Sell', moneyness: 1.0, quantity: 200 },
      { type: 'Put', action: 'Buy', moneyness: 1.05, quantity: 100 },
    ],
  },
  {
    id: 'broken-wing-call',
    code: 34,
    name: 'Broken Wing Butterfly (Call)',
    category: 'Income',
    riskProfile: 'Definido',
    complexity: 'Avançado',
    description: 'Borboleta assimétrica com asa superior deslocada.',
    details: {
      thesis: 'Montagem com crédito ou custo zero eliminando risco na queda.',
      mechanics: 'Compra Call baixa, vende 2 Calls ATM, compra Call mais distante.',
      idealScenario: 'Ativo fica parado ou cai abaixo da asa inferior.',
      greeks: 'Theta +, Assimetria Controlada',
    },
    legSpecs: [
      { type: 'Call', action: 'Buy', moneyness: 0.95, quantity: 100 },
      { type: 'Call', action: 'Sell', moneyness: 1.0, quantity: 200 },
      { type: 'Call', action: 'Buy', moneyness: 1.1, quantity: 100 },
    ],
  },
  {
    id: 'broken-wing-put',
    code: 35,
    name: 'Broken Wing Butterfly (Put)',
    category: 'Income',
    riskProfile: 'Definido',
    complexity: 'Avançado',
    description: 'Borboleta assimétrica de Puts com risco concentrado na queda.',
    details: {
      thesis: 'Viés neutro/altista buscando crédito na montagem sem risco na alta.',
      mechanics: 'Asa inferior mais distante gera crédito líquido.',
      idealScenario: 'Ativo sobe ou termina no strike central.',
      greeks: 'Theta +, Delta +',
    },
    legSpecs: [
      { type: 'Put', action: 'Buy', moneyness: 0.9, quantity: 100 },
      { type: 'Put', action: 'Sell', moneyness: 1.0, quantity: 200 },
      { type: 'Put', action: 'Buy', moneyness: 1.05, quantity: 100 },
    ],
  },
  {
    id: 'christmas-tree-call',
    code: 36,
    name: 'Árvore de Natal (Call 1-3-2)',
    category: 'Income',
    riskProfile: 'Definido',
    complexity: 'Avançado',
    description: 'Borboleta assimétrica 1-3-2 para alta moderada.',
    details: {
      thesis: 'Valorização lenta até um teto com baixo custo inicial.',
      mechanics: 'Compra 1 Call baixa, vende 3 Calls médias, compra 2 Calls altas.',
      idealScenario: 'Pico de lucro exatamente no strike da venda tripla.',
      greeks: 'Theta +, Vega -',
    },
    legSpecs: [
      { type: 'Call', action: 'Buy', moneyness: 0.96, quantity: 100 },
      { type: 'Call', action: 'Sell', moneyness: 1.04, quantity: 300 },
      { type: 'Call', action: 'Buy', moneyness: 1.09, quantity: 200 },
    ],
  },
  {
    id: 'christmas-tree-put',
    code: 37,
    name: 'Árvore de Natal (Put 1-3-2)',
    category: 'Income',
    riskProfile: 'Definido',
    complexity: 'Avançado',
    description: 'Estrutura 1-3-2 com Puts para queda controlada.',
    details: {
      thesis: 'Queda lenta até um suporte sem pagar caro pelo prêmio.',
      mechanics: 'Compra 1 Put alta, vende 3 Puts médias, compra 2 Puts baixas.',
      idealScenario: 'Ativo fecha no strike de venda tripla.',
      greeks: 'Theta +, Vega -',
    },
    legSpecs: [
      { type: 'Put', action: 'Buy', moneyness: 1.04, quantity: 100 },
      { type: 'Put', action: 'Sell', moneyness: 0.96, quantity: 300 },
      { type: 'Put', action: 'Buy', moneyness: 0.91, quantity: 200 },
    ],
  },
  {
    id: 'call-condor',
    code: 38,
    name: 'Condor de Call',
    category: 'Income',
    riskProfile: 'Definido',
    complexity: 'Intermediário',
    description: 'Borboleta de corpo largo com 4 strikes distintos.',
    details: {
      thesis: 'Amplo platô de lucro máximo em mercado lateral.',
      mechanics: 'Compra Call baixa, vende 2 Calls centrais distintas, compra Call alta.',
      idealScenario: 'Ativo estabilizado entre os dois strikes centrais.',
      greeks: 'Theta +, Risco Definido',
    },
    legSpecs: [
      { type: 'Call', action: 'Buy', moneyness: 0.92, quantity: 100 },
      { type: 'Call', action: 'Sell', moneyness: 0.97, quantity: 100 },
      { type: 'Call', action: 'Sell', moneyness: 1.03, quantity: 100 },
      { type: 'Call', action: 'Buy', moneyness: 1.08, quantity: 100 },
    ],
  },

  // HEDGE & STRUCTURED (39-45)
  {
    id: 'jade-lizard',
    code: 39,
    name: 'Jade Lizard',
    category: 'Hedge',
    riskProfile: 'Definido',
    complexity: 'Avançado',
    description: 'Venda de Put + Bear Call Spread (sem risco na alta se bem montada).',
    details: {
      thesis: 'Geração de renda em ativo lateral/altista eliminando risco de alta.',
      mechanics: 'Crédito total supera a largura do Bear Call Spread.',
      idealScenario: 'Ativo encerra acima da Put vendida e abaixo da Call vendida.',
      greeks: 'Delta +, Theta +, Vega -',
    },
    legSpecs: [
      { type: 'Put', action: 'Sell', moneyness: 0.92, quantity: 100 },
      { type: 'Call', action: 'Sell', moneyness: 1.05, quantity: 100 },
      { type: 'Call', action: 'Buy', moneyness: 1.1, quantity: 100 },
    ],
  },
  {
    id: 'twisted-sister',
    code: 40,
    name: 'Twisted Sister',
    category: 'Hedge',
    riskProfile: 'Ilimitado',
    complexity: 'Avançado',
    description: 'Inverso do Jade Lizard: Venda de Call + Bull Put Spread.',
    details: {
      thesis: 'Renda em mercado lateral/baixista com proteção na ponta inferior.',
      mechanics: 'Venda de Call OTM financiada com Bull Put Spread.',
      idealScenario: 'Ativo encerra abaixo da Call vendida e acima da Put vendida.',
      greeks: 'Delta -, Theta +, Risco na Alta Extrema',
    },
    legSpecs: [
      { type: 'Call', action: 'Sell', moneyness: 1.08, quantity: 100 },
      { type: 'Put', action: 'Sell', moneyness: 0.95, quantity: 100 },
      { type: 'Put', action: 'Buy', moneyness: 0.9, quantity: 100 },
    ],
  },
  {
    id: 'seagull-bullish',
    code: 41,
    name: 'Seagull Bullish (Gaivota)',
    category: 'Hedge',
    riskProfile: 'Definido',
    complexity: 'Intermediário',
    description: 'Trava de alta financiada pela venda de Put OTM.',
    details: {
      thesis: 'Participar da alta com desembolso próximo a zero aceitando compra no suporte.',
      mechanics: 'Bull Call Spread + Venda de Put OTM.',
      idealScenario: 'Valorização do ativo até o strike da Call vendida.',
      greeks: 'Delta +, Baixo Custo Inicial',
    },
    legSpecs: [
      { type: 'Call', action: 'Buy', moneyness: 1.0, quantity: 100 },
      { type: 'Call', action: 'Sell', moneyness: 1.06, quantity: 100 },
      { type: 'Put', action: 'Sell', moneyness: 0.92, quantity: 100 },
    ],
  },
  {
    id: 'box-spread',
    code: 42,
    name: 'Box de 4 Pontas (Box Spread)',
    category: 'Hedge',
    riskProfile: 'Definido',
    complexity: 'Avançado',
    description: 'Estrutura de taxa fixa (arbitragem / financiamento sintético).',
    details: {
      thesis: 'Travar taxa de juros fixa via derivativos (sem risco direcional).',
      mechanics: 'Bull Call Spread + Bear Put Spread nos mesmos strikes.',
      idealScenario: 'Payoff fixo no vencimento independente do preço do ativo.',
      greeks: 'Delta 0, Gamma 0, Sensível apenas a Juros (Rho)',
    },
    legSpecs: [
      { type: 'Call', action: 'Buy', moneyness: 0.95, quantity: 100 },
      { type: 'Call', action: 'Sell', moneyness: 1.05, quantity: 100 },
      { type: 'Put', action: 'Buy', moneyness: 1.05, quantity: 100 },
      { type: 'Put', action: 'Sell', moneyness: 0.95, quantity: 100 },
    ],
  },
  {
    id: 'collar-fence',
    code: 43,
    name: 'Collar / Fence (Seguro de Carteira)',
    category: 'Hedge',
    riskProfile: 'Definido',
    complexity: 'Iniciante',
    description: 'Ação em carteira protegida por Put comprada e financiada por Call vendida.',
    details: {
      thesis: 'Proteger ações em carteira contra quedas limitando o ganho máximo na alta.',
      mechanics: 'Posição comprada na Ação + Compra de Put OTM + Venda de Call OTM.',
      idealScenario: 'Queda forte (Put protege) ou alta moderada até o strike da Call.',
      greeks: 'Delta Controlado, Piso e Teto Definidos',
    },
    legSpecs: [
      { type: 'Stock', action: 'Buy', moneyness: 1.0, quantity: 100 },
      { type: 'Put', action: 'Buy', moneyness: 0.95, quantity: 100 },
      { type: 'Call', action: 'Sell', moneyness: 1.06, quantity: 100 },
    ],
  },
  {
    id: 'covered-call-ratio',
    code: 44,
    name: 'Lançamento Coberto / Booster 1x2',
    category: 'Hedge',
    riskProfile: 'Ilimitado',
    complexity: 'Intermediário',
    description: 'Ação em carteira + venda de 2 Calls OTM para turbinar taxa.',
    details: {
      thesis: 'Potencializar geração de renda em ativo lateralizado.',
      mechanics: '100 ações cobrem 100 Calls; as 100 Calls extras geram risco acima do breakeven superior.',
      idealScenario: 'Alta moderada até o strike vendido.',
      greeks: 'Theta ++, Atenção à 2ª perna descoberta',
    },
    legSpecs: [
      { type: 'Stock', action: 'Buy', moneyness: 1.0, quantity: 100 },
      { type: 'Call', action: 'Sell', moneyness: 1.05, quantity: 200 },
    ],
  },
  {
    id: 'covered-call-classic',
    code: 45,
    name: 'Lançamento Coberto (Financiamento)',
    category: 'Income',
    riskProfile: 'Definido',
    complexity: 'Iniciante',
    description: 'Ação comprada + venda de Call OTM na mesma quantidade (1x1).',
    details: {
      thesis: 'Estratégia clássica de renda recorrente na B3 (remunerar carteira de ações).',
      mechanics: 'Compra da ação + venda de Call OTM 1x1 recebendo prêmio.',
      idealScenario: 'Ação sobe até o strike da Call vendida (lucro na ação + prêmio).',
      greeks: 'Delta +, Theta +, Risco na Queda do Papel',
    },
    legSpecs: [
      { type: 'Stock', action: 'Buy', moneyness: 1.0, quantity: 100 },
      { type: 'Call', action: 'Sell', moneyness: 1.05, quantity: 100 },
    ],
  },
  // MULTI-EXPIRY: CALENDAR & DIAGONAL (46-50)
  {
    id: 'call-calendar-spread',
    code: 46,
    name: 'Trava Calendário com Call (Horizontal)',
    category: 'Income',
    riskProfile: 'Definido',
    complexity: 'Intermediário',
    description: 'Venda de Call no vencimento curto + compra de Call no mesmo strike no vencimento longo.',
    details: {
      thesis: 'Capturar o decaimento mais acelerado do Theta no vencimento curto e eventual alta de IV na ponta longa.',
      mechanics: 'Vende Call ATM do mês atual e compra Call ATM do mês seguinte com risco travado ao débito.',
      idealScenario: 'Ativo encerra próximo ao strike central no vencimento mais curto.',
      greeks: 'Delta Neutro, Theta +, Vega + (curva longa)',
    },
    legSpecs: [
      { type: 'Call', action: 'Sell', moneyness: 1.0, quantity: 100, expiryOffsetMonths: 0 },
      { type: 'Call', action: 'Buy', moneyness: 1.0, quantity: 100, expiryOffsetMonths: 1 },
    ],
  },
  {
    id: 'put-calendar-spread',
    code: 47,
    name: 'Trava Calendário com Put (Horizontal)',
    category: 'Income',
    riskProfile: 'Definido',
    complexity: 'Intermediário',
    description: 'Venda de Put no vencimento curto + compra de Put no mesmo strike no vencimento seguinte.',
    details: {
      thesis: 'Coletar diferencial de Theta em região de suporte aproveitando o skew de Puts.',
      mechanics: 'Vende Put levemente OTM/ATM curta e compra Put no mesmo strike no vencimento posterior.',
      idealScenario: 'Ativo estabiliza próximo ao strike escolhido até o primeiro vencimento.',
      greeks: 'Theta +, Vega +, Risco Definido ao Débito',
    },
    legSpecs: [
      { type: 'Put', action: 'Sell', moneyness: 0.98, quantity: 100, expiryOffsetMonths: 0 },
      { type: 'Put', action: 'Buy', moneyness: 0.98, quantity: 100, expiryOffsetMonths: 1 },
    ],
  },
  {
    id: 'pmcc-diagonal-bull',
    code: 48,
    name: 'Trava Diagonal de Alta (PMCC)',
    category: 'Bullish',
    riskProfile: 'Definido',
    complexity: 'Intermediário',
    description: 'Compra de Call longa ITM financiada por venda de Call curta OTM (Lançamento Coberto Sintético).',
    details: {
      thesis: 'Replicar um financiamento/lançamento coberto utilizando muito menos capital que comprar o ativo.',
      mechanics: 'Compra Call ITM no vencimento longo (Delta alto) e vende Call OTM no vencimento curto.',
      idealScenario: 'Alta moderada até o strike da Call vendida no primeiro vencimento, permitindo rolagens.',
      greeks: 'Delta +, Theta +, Vega +, Baixo Desembolso',
    },
    legSpecs: [
      { type: 'Call', action: 'Buy', moneyness: 0.92, quantity: 100, expiryOffsetMonths: 1 },
      { type: 'Call', action: 'Sell', moneyness: 1.04, quantity: 100, expiryOffsetMonths: 0 },
    ],
  },
  {
    id: 'pmcp-diagonal-bear',
    code: 49,
    name: 'Trava Diagonal de Baixa (PMCP)',
    category: 'Bearish',
    riskProfile: 'Definido',
    complexity: 'Intermediário',
    description: 'Compra de Put longa ITM financiada por venda de Put curta OTM.',
    details: {
      thesis: 'Exposição baixista com financiamento via Theta e menor sensibilidade ao tempo que Put a seco.',
      mechanics: 'Compra Put ITM no vencimento seguinte e vende Put OTM no vencimento atual.',
      idealScenario: 'Queda gradual do ativo até o strike da Put curta no primeiro vencimento.',
      greeks: 'Delta -, Theta +, Vega +, Risco Definido',
    },
    legSpecs: [
      { type: 'Put', action: 'Buy', moneyness: 1.08, quantity: 100, expiryOffsetMonths: 1 },
      { type: 'Put', action: 'Sell', moneyness: 0.96, quantity: 100, expiryOffsetMonths: 0 },
    ],
  },
  {
    id: 'double-calendar',
    code: 50,
    name: 'Double Calendar (Calendário Duplo)',
    category: 'Volatility',
    riskProfile: 'Definido',
    complexity: 'Avançado',
    description: 'Calendário simultâneo de Put OTM e Call OTM criando ampla faixa de lucro lateral.',
    details: {
      thesis: 'Mercado lateralizado em faixa ampla com expectativa de expansão de volatilidade implícita.',
      mechanics: 'Vende Strangle OTM no vencimento curto e compra Strangle nos mesmos strikes no vencimento longo.',
      idealScenario: 'Ativo permanece entre os dois strikes até o vencimento curto.',
      greeks: 'Delta Neutro, Theta +, Vega ++, Risco Definido',
    },
    legSpecs: [
      { type: 'Put', action: 'Sell', moneyness: 0.95, quantity: 100, expiryOffsetMonths: 0 },
      { type: 'Put', action: 'Buy', moneyness: 0.95, quantity: 100, expiryOffsetMonths: 1 },
      { type: 'Call', action: 'Sell', moneyness: 1.05, quantity: 100, expiryOffsetMonths: 0 },
      { type: 'Call', action: 'Buy', moneyness: 1.05, quantity: 100, expiryOffsetMonths: 1 },
    ],
  },
];

/**
 * Finds the closest option in the market chain for a target strike and type.
 */
function findClosestMarketOption(
  chain: MarketOption[],
  type: 'Call' | 'Put',
  targetStrike: number,
  preferredExpiry?: string
): MarketOption | undefined {
  const pool = preferredExpiry
    ? chain.filter((o) => o.type === type && o.expirationDate === preferredExpiry)
    : chain.filter((o) => o.type === type);

  const candidates = pool.length > 0 ? pool : chain.filter((o) => o.type === type);
  if (candidates.length === 0) return undefined;

  return candidates.reduce((best, curr) => {
    const distCurr = Math.abs(curr.strike - targetStrike);
    const distBest = Math.abs(best.strike - targetStrike);
    return distCurr < distBest ? curr : best;
  });
}

/**
 * Resolves the target expiration date and DTE for a given `expiryOffsetMonths` (0 = near, 1 = next, etc.).
 */
function resolveExpiryForOffset(
  offsetMonths: number,
  selectedExpiry: string,
  marketData: MarketDataResponse | null,
  fallbackExpiries: { date: string; calendarDays: number }[]
): { expirationDate: string; dte: number } {
  const safeOffset = Math.max(0, offsetMonths);

  if (marketData && marketData.chain.length > 0) {
    const uniqueExps = Array.from(
      new Map(marketData.chain.map((o) => [o.expirationDate, o.daysToMaturity])).entries()
    )
      .map(([date, dte]) => ({ date, dte }))
      .sort((a, b) => a.date.localeCompare(b.date));

    if (uniqueExps.length > 0) {
      const baseIdx = selectedExpiry
        ? Math.max(0, uniqueExps.findIndex((e) => e.date === selectedExpiry))
        : 0;
      const targetIdx = Math.min(uniqueExps.length - 1, baseIdx + safeOffset);
      if (targetIdx > baseIdx || safeOffset === 0) {
        return {
          expirationDate: uniqueExps[targetIdx].date,
          dte: uniqueExps[targetIdx].dte,
        };
      }
    }
  }

  // Fallback to generated B3 upcoming expiries
  const baseIdx = selectedExpiry
    ? Math.max(0, fallbackExpiries.findIndex((e) => e.date === selectedExpiry))
    : 0;
  const target = fallbackExpiries[Math.min(fallbackExpiries.length - 1, baseIdx + safeOffset)];
  return {
    expirationDate: target.date,
    dte: target.calendarDays,
  };
}

/**
 * Instantiates a strategy template into real, dynamically priced Legs.
 * - Resolves multi-expiry offsets (Calendar / Diagonal) cleanly from chain or B3 schedule.
 * - Applies continuous B3 rates (ln(1+r)) and default B3 American/European exercise styles.
 */
export function instantiateStrategy(
  template: StrategyTemplate,
  ticker: string,
  marketParams: MarketParams,
  marketData: MarketDataResponse | null,
  selectedExpiry: string
): Leg[] {
  const fallbackExpiries = getUpcomingB3Expiries(4);
  const nearResolved = resolveExpiryForOffset(0, selectedExpiry, marketData, fallbackExpiries);
  const defaultIv = 0.34;
  const { rCont, qCont } = getContinuousMarketRates(marketParams);

  return template.legSpecs.map((spec) => {
    if (spec.type === 'Stock') {
      return {
        id: generateLegId(),
        ticker: ticker.toUpperCase() || 'ATIVO',
        type: 'Stock',
        action: spec.action,
        strike: Number(marketParams.spotPrice.toFixed(2)),
        quantity: spec.quantity,
        price: Number(marketParams.spotPrice.toFixed(2)),
        expirationDate: nearResolved.expirationDate,
        daysToMaturity: nearResolved.dte,
        impliedVolatility: 0,
        enabled: true,
        delta: 1,
        gamma: 0,
        theta: 0,
        vega: 0,
        rho: 0,
      };
    }

    const offset = spec.expiryOffsetMonths ?? 0;
    const legExp = resolveExpiryForOffset(offset, selectedExpiry, marketData, fallbackExpiries);
    const targetStrike = marketParams.spotPrice * spec.moneyness;
    const exerciseStyle = inferDefaultB3ExerciseStyle(spec.type, ticker);

    const match = marketData
      ? findClosestMarketOption(marketData.chain, spec.type, targetStrike, legExp.expirationDate)
      : undefined;

    if (match && (offset === 0 || match.expirationDate === legExp.expirationDate)) {
      const marketPrice =
        spec.action === 'Buy'
          ? match.ask > 0
            ? match.ask
            : match.last || match.bid
          : match.bid > 0
          ? match.bid
          : match.last || match.ask;

      const legStyle = match.exerciseStyle ?? exerciseStyle;
      const T = getTimeToMaturityYears(
        match.daysToMaturity,
        marketParams.dayCountConvention,
        match.expirationDate
      );
      const iv = match.impliedVolatility > 0 ? match.impliedVolatility : defaultIv;
      const safePrice =
        marketPrice > 0
          ? marketPrice
          : priceOption({
              S: marketParams.spotPrice,
              K: match.strike,
              T,
              r: rCont,
              q: qCont,
              sigma: iv,
              type: spec.type,
              exerciseStyle: legStyle,
            });
      const greeks = greeksOption(
        {
          S: marketParams.spotPrice,
          K: match.strike,
          T,
          r: rCont,
          q: qCont,
          sigma: iv,
          type: spec.type,
          exerciseStyle: legStyle,
        },
        marketParams.dayCountConvention
      );

      return {
        id: generateLegId(),
        ticker: match.ticker,
        type: spec.type,
        action: spec.action,
        exerciseStyle: legStyle,
        strike: match.strike,
        quantity: spec.quantity,
        price: Number(safePrice.toFixed(2)),
        expirationDate: match.expirationDate,
        daysToMaturity: match.daysToMaturity,
        impliedVolatility: iv,
        enabled: true,
        bid: match.bid,
        ask: match.ask,
        last: match.last,
        ...greeks,
      };
    }

    // Offline / synthetic pricing (also handles far-month calendar legs when chain only has 1 expiry)
    const strike = roundToB3Strike(targetStrike);
    const T = getTimeToMaturityYears(
      legExp.dte,
      marketParams.dayCountConvention,
      legExp.expirationDate
    );
    const theoPrice = priceOption({
      S: marketParams.spotPrice,
      K: strike,
      T,
      r: rCont,
      q: qCont,
      sigma: defaultIv,
      type: spec.type,
      exerciseStyle,
    });
    const greeks = greeksOption(
      {
        S: marketParams.spotPrice,
        K: strike,
        T,
        r: rCont,
        q: qCont,
        sigma: defaultIv,
        type: spec.type,
        exerciseStyle,
      },
      marketParams.dayCountConvention
    );

    return {
      id: generateLegId(),
      ticker: generateB3OptionTicker(ticker || 'PETR4', spec.type, legExp.expirationDate, strike),
      type: spec.type,
      action: spec.action,
      exerciseStyle,
      strike,
      quantity: spec.quantity,
      price: Number(Math.max(0.02, theoPrice).toFixed(2)),
      expirationDate: legExp.expirationDate,
      daysToMaturity: legExp.dte,
      impliedVolatility: defaultIv,
      enabled: true,
      ...greeks,
    };
  });
}
