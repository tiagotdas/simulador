import React, { useState, useEffect, useMemo } from 'react';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine 
} from 'recharts';
import { 
  Plus, Trash2, Activity, Shield, Zap, LayoutGrid, Check, X, AlertCircle, Info, BookOpen, Lock, Search, ChevronDown, RefreshCw, BarChart3, Target
} from 'lucide-react';

/**
 * CONFIGURAÇÕES E ENDPOINTS
 */
const GAS_URL = "https://script.google.com/macros/s/AKfycbx7kyTKXaQtVYg0WzgzMow9s3elbyDq4Su6TSirn3l3Ppn3_T4xIODahwC9Rt9zWpNJtA/exec"; 

/**
 * TIPAGEM RIGOROSA (COMPLIANCE TYPESCRIPT)
 */
type OptionType = 'Call' | 'Put' | 'Stock';
type ActionType = 'Buy' | 'Sell';

interface Leg {
  id: string;
  type: OptionType;
  action: ActionType;
  strike: number;
  quantity: number;
  price: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
}

interface StrategyTemplate {
  name: string;
  category: 'Bullish' | 'Bearish' | 'Volatility' | 'Income' | 'Hedge';
  description: string;
  details: {
    thesis: string;
    mechanics: string;
    idealScenario: string;
    greeks: string;
  };
  setup: (spot: number) => Leg[];
}

interface MarketOption {
  ticker: string;
  type: OptionType;
  strike: number;
  expirationDate: string;
  daysToMaturity: number;
  bid: number;
  ask: number;
  last: number;
  impliedVolatility: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
}

interface MarketDataResponse {
  baseAsset: string;
  spotPrice: number;
  timestamp: string;
  chain: MarketOption[];
  diagnostics?: string;
}

/**
 * MOTOR QUANTITATIVO: MODELO BLACK-SCHOLES-MERTON E CÁLCULOS DE EXPOSIÇÃO
 * Definidos no topo para evitar ReferenceErrors durante o render do React.
 */

const normPDF = (x: number): number => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

const normCDF = (x: number): number => {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
};

const calculateGreeks = (S: number, K: number, daysToMaturity: number, sigma: number, type: OptionType) => {
  if (type === 'Stock') return { delta: 1, gamma: 0, theta: 0, vega: 0 };
  
  const r = 0.1125; 
  const T = Math.max(daysToMaturity, 1) / 365.0;
  const d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);

  let delta, gamma, theta, vega;
  gamma = normPDF(d1) / (S * sigma * Math.sqrt(T));
  vega = S * normPDF(d1) * Math.sqrt(T) / 100;
  
  if (type === 'Call') {
    delta = normCDF(d1);
    theta = (- (S * sigma * normPDF(d1)) / (2 * Math.sqrt(T)) - r * K * Math.exp(-r * T) * normCDF(d2)) / 365;
  } else {
    delta = normCDF(d1) - 1;
    theta = (- (S * sigma * normPDF(d1)) / (2 * Math.sqrt(T)) + r * K * Math.exp(-r * T) * normCDF(-d2)) / 365;
  }
  return { delta, gamma, theta, vega };
};

const getOptionValueAtExpiry = (type: OptionType, strike: number, spot: number): number => {
  if (type === 'Call') return Math.max(0, spot - strike);
  if (type === 'Put') return Math.max(0, strike - spot);
  if (type === 'Stock') return spot;
  return 0;
};

const calculatePayoff = (legs: Leg[], spotRange: number[]) => {
  return spotRange.map(spot => {
    let totalPnl = 0;
    legs.forEach(leg => {
      const vAtE = getOptionValueAtExpiry(leg.type, leg.strike, spot);
      const cost = leg.quantity * leg.price;
      if (leg.action === 'Buy') totalPnl += (vAtE * leg.quantity) - cost;
      else totalPnl += cost - (vAtE * leg.quantity);
    });
    return { price: spot, value: totalPnl };
  });
};

const calculateMetrics = (legs: Leg[], payoffData: { price: number; value: number }[]) => {
  let cost = 0, deltaAtInfinity = 0, payoffAtZero = 0;
  let tD = 0, tG = 0, tT = 0, tV = 0;

  legs.forEach(l => {
    const isB = l.action === 'Buy', m = isB ? 1 : -1, c = l.quantity * l.price;
    if (isB) cost += c; else cost -= c;
    if (l.type === 'Call' || l.type === 'Stock') deltaAtInfinity += isB ? l.quantity : -l.quantity;
    
    if (l.type === 'Call') payoffAtZero += isB ? -c : c;
    else if (l.type === 'Put') payoffAtZero += isB ? (l.strike * l.quantity) - c : c - (l.strike * l.quantity);
    else payoffAtZero += isB ? -c : c;

    if (l.delta) tD += l.delta * l.quantity * m;
    if (l.gamma) tG += l.gamma * l.quantity * m;
    if (l.theta) tT += l.theta * l.quantity * m;
    if (l.vega) tV += l.vega * l.quantity * m;
  });

  const vals = payoffData.map(p => p.value);
  let mP: number | string = Math.max(...vals, payoffAtZero);
  let mL: number | string = Math.min(...vals, payoffAtZero);
  if (deltaAtInfinity > 0) mP = "Ilimitado"; if (deltaAtInfinity < 0) mL = "Ilimitado";

  const be: number[] = [];
  for (let i = 1; i < payoffData.length; i++) {
    if (payoffData[i-1].value * payoffData[i].value <= 0 && payoffData[i-1].value !== payoffData[i].value) {
      be.push(parseFloat((payoffData[i-1].price - payoffData[i-1].value * (payoffData[i].price - payoffData[i-1].price) / (payoffData[i].value - payoffData[i-1].value)).toFixed(2)));
    }
  }
  return { cost, maxProfit: mP, maxLoss: mL, breakevens: Array.from(new Set(be)), greeks: { delta: tD, gamma: tG, theta: tT, vega: tV } };
};

const generateUUID = () => Math.random().toString(36).substring(2, 9);

/**
 * CATÁLOGO INSTITUCIONAL: 45 ESTRATÉGIAS DE DERIVADOS
 */
const STRATEGIES: StrategyTemplate[] = [
  // ESTRATÉGIAS DE ALTA (BULLISH)
  { name: "1. Compra de Call (Long)", category: "Bullish", description: "Compra de Call a seco.", details: { thesis: "Expectativa de forte valorização.", mechanics: "Aquisição de direito de compra com alavancagem.", idealScenario: "Movimento explosivo de alta no curto prazo.", greeks: "Delta Positivo, Gamma Positivo" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Buy', strike: spot, quantity: 100, price: 2.5 }] },
  { name: "2. Venda de Put (Naked)", category: "Bullish", description: "Venda de Put a seco.", details: { thesis: "Mercado estável ou levemente altista.", mechanics: "Venda de obrigação de compra para coleta de prémio.", idealScenario: "Ativo permanece acima do strike até à maturidade.", greeks: "Theta Positivo (Renda)" }, setup: (spot) => [{ id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.95, quantity: 100, price: 2.0 }] },
  { name: "3. Spread de Alta com Call", category: "Bullish", description: "Bull Call Spread.", details: { thesis: "Valorização moderada com custo reduzido.", mechanics: "Compra Call ATM e Venda Call OTM.", idealScenario: "Ativo atinge o strike da Call vendida.", greeks: "Risco limitado, Retorno definido" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Buy', strike: spot, quantity: 100, price: 5.0 }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.05, quantity: 100, price: 2.0 }] },
  { name: "4. Spread de Alta com Put", category: "Bullish", description: "Bull Put Spread.", details: { thesis: "Rentabilização em mercado lateral/altista.", mechanics: "Venda Put ATM e Compra Put OTM.", idealScenario: "Ativo termina acima do strike vendido.", greeks: "Theta Positivo, Delta Positivo" }, setup: (spot) => [{ id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.95, quantity: 100, price: 3.0 }, { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 0.90, quantity: 100, price: 1.0 }] },
  { name: "5. Call Ratio Spread", category: "Bullish", description: "Compra 1, Venda 2 Calls.", details: { thesis: "Alta moderada com potencial de custo zero.", mechanics: "Financiamento da compra pela venda dupla de OTM.", idealScenario: "Ativo para exatamente no strike vendido.", greeks: "Delta variável, Risco na alta explosiva" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Buy', strike: spot, quantity: 100, price: 5.0 }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.05, quantity: 200, price: 2.0 }] },
  { name: "6. Risk Reversal", category: "Bullish", description: "Financiamento de Call com Put.", details: { thesis: "Simulação de compra de ativo com proteção.", mechanics: "Compra Call OTM financiada pela Venda de Put OTM.", idealScenario: "Subida expressiva do ativo subjacente.", greeks: "Delta aproximado de 0.5 a 1.0" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 1.05, quantity: 100, price: 3.0 }, { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.95, quantity: 100, price: 3.0 }] },
  { name: "7. Call Backspread", category: "Bullish", description: "Venda 1, Compra 2 Calls.", details: { thesis: "Aposta em volatilidade extrema na alta.", mechanics: "Venda Call ATM e Compra de maior volume de OTM.", idealScenario: "Rompimento violento da resistência superior.", greeks: "Gamma Positivo, Vega Positivo" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Sell', strike: spot, quantity: 100, price: 5.0 }, { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 1.05, quantity: 200, price: 2.0 }] },
  { name: "8. Bull Call Ladder", category: "Bullish", description: "Escada de Alta.", details: { thesis: "Alta moderada com intervalo de lucro amplo.", mechanics: "Bull Spread com venda de Call adicional superior.", idealScenario: "Alta gradual até o penúltimo strike.", greeks: "Theta Positivo no intervalo" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Buy', strike: spot, quantity: 100, price: 5.0 }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.05, quantity: 100, price: 2.0 }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.10, quantity: 100, price: 1.0 }] },
  { name: "9. Ativo Sintético", category: "Bullish", description: "Simulação de compra de ação.", details: { thesis: "Exposição ao ativo com baixo capital.", mechanics: "Compra Call ATM e Venda Put ATM.", idealScenario: "Qualquer valorização do ativo.", greeks: "Delta 1.0 (Réplica perfeita)" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Buy', strike: spot, quantity: 100, price: 4.0 }, { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot, quantity: 100, price: 4.0 }] },

  // ESTRATÉGIAS DE BAIXA (BEARISH)
  { name: "10. Compra de Put (Long)", category: "Bearish", description: "Compra de Put a seco.", details: { thesis: "Hedge ou aposta em queda.", mechanics: "Direito de vender o ativo a preço fixo.", idealScenario: "Desvalorização brusca do mercado.", greeks: "Delta Negativo, Gamma Positivo" }, setup: (spot) => [{ id: generateUUID(), type: 'Put', action: 'Buy', strike: spot, quantity: 100, price: 2.5 }] },
  { name: "11. Venda de Call (Naked)", category: "Bearish", description: "Venda de Call a seco.", details: { thesis: "Mercado em queda ou lateral.", mechanics: "Obrigação de venda. Alto risco na alta.", idealScenario: "Ativo termina abaixo do strike.", greeks: "Theta Positivo, Risco Ilimitado" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.05, quantity: 100, price: 2.0 }] },
  { name: "12. Spread de Baixa com Put", category: "Bearish", description: "Bear Put Spread.", details: { thesis: "Queda moderada com custo definido.", mechanics: "Compra Put ATM e Venda Put OTM.", idealScenario: "Ativo cai até ao strike inferior.", greeks: "Risco limitado, Lucro máximo no strike" }, setup: (spot) => [{ id: generateUUID(), type: 'Put', action: 'Buy', strike: spot, quantity: 100, price: 5.0 }, { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.95, quantity: 100, price: 2.0 }] },
  { name: "13. Spread de Baixa com Call", category: "Bearish", description: "Bear Call Spread.", details: { thesis: "Geração de renda em baixa/lateralização.", mechanics: "Venda Call ATM e Compra Call OTM.", idealScenario: "Ativo permanece abaixo do strike vendido.", greeks: "Theta Positivo, Risco Limitado" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.05, quantity: 100, price: 3.0 }, { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 1.10, quantity: 100, price: 1.0 }] },
  { name: "14. Put Ratio Spread", category: "Bearish", description: "Compra 1, Venda 2 Puts.", details: { thesis: "Queda moderada com hedge parcial.", mechanics: "Compra Put e Venda dupla de Puts mais baratas.", idealScenario: "Pin no strike vendido (lucro máximo).", greeks: "Risco em queda catastrófica" }, setup: (spot) => [{ id: generateUUID(), type: 'Put', action: 'Buy', strike: spot, quantity: 100, price: 5.0 }, { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.90, quantity: 200, price: 1.5 }] },
  { name: "15. Put Backspread", category: "Bearish", description: "Venda 1, Compra 2 Puts.", details: { thesis: "Lucro em crash ou pânico financeiro.", mechanics: "Venda Put ITM e Compra Puts OTM.", idealScenario: "Queda livre do preço do ativo.", greeks: "Gamma Positivo na ponta baixa" }, setup: (spot) => [{ id: generateUUID(), type: 'Put', action: 'Sell', strike: spot, quantity: 100, price: 5.0 }, { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 0.90, quantity: 200, price: 2.0 }] },
  { name: "16. Escada de Baixa", category: "Bearish", description: "Bear Put Ladder.", details: { thesis: "Queda suave gerando crédito inicial.", mechanics: "Bear Put Spread com Venda de Put adicional.", idealScenario: "Ativo estabiliza no corpo da escada.", greeks: "Theta Positivo" }, setup: (spot) => [{ id: generateUUID(), type: 'Put', action: 'Buy', strike: spot, quantity: 100, price: 5.0 }, { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.95, quantity: 100, price: 2.0 }, { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.90, quantity: 100, price: 1.0 }] },
  { name: "17. Vendido Sintético", category: "Bearish", description: "Réplica de Short Stock.", details: { thesis: "Exposição à queda sem aluguer de ações.", mechanics: "Venda Call ATM e Compra Put ATM.", idealScenario: "Qualquer desvalorização do ativo.", greeks: "Delta -1.0" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Sell', strike: spot, quantity: 100, price: 4.0 }, { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot, quantity: 100, price: 4.0 }] },
  { name: "18. Put Sintética (Hedged Stock)", category: "Bearish", description: "Proteção de Stock.", details: { thesis: "Manter exposição à alta com limite de perda.", mechanics: "Venda de Stock + Compra de Call.", idealScenario: "Queda imediata após venda do ativo base.", greeks: "Proteção contra Tail Risk" }, setup: (spot) => [{ id: generateUUID(), type: 'Stock', action: 'Sell', strike: spot, quantity: 100, price: spot }, { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot, quantity: 100, price: 2.5 }] },

  // VOLATILIDADE (VOLATILITY)
  { name: "19. Straddle Comprado", category: "Volatility", description: "Compra Call e Put ATM.", details: { thesis: "Aposta em movimento direcional incerto.", mechanics: "Compra de volatilidade pura.", idealScenario: "Rompimento forte de triângulo ou notícia.", greeks: "Vega Positivo, Gamma Alto" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Buy', strike: spot, quantity: 100, price: 4.0 }, { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot, quantity: 100, price: 4.0 }] },
  { name: "20. Strangle Comprado", category: "Volatility", description: "Compra OTM.", details: { thesis: "Explosão de preço com baixo custo.", mechanics: "Opções fora do dinheiro para alavancagem.", idealScenario: "Movimento extremo e violento.", greeks: "Vega Positivo" }, setup: (spot) => [{ id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 0.95, quantity: 100, price: 2.5 }, { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 1.05, quantity: 100, price: 2.5 }] },
  { name: "21. Strip", category: "Volatility", description: "Straddle com viés de baixa.", details: { thesis: "Volatilidade com maior probabilidade de queda.", mechanics: "2 Puts + 1 Call ATM.", idealScenario: "Forte desvalorização.", greeks: "Gamma assimétrico" }, setup: (spot) => [{ id: generateUUID(), type: 'Put', action: 'Buy', strike: spot, quantity: 200, price: 4.0 }, { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot, quantity: 100, price: 4.0 }] },
  { name: "22. Strap", category: "Volatility", description: "Straddle com viés de alta.", details: { thesis: "Volatilidade com maior probabilidade de subida.", mechanics: "2 Calls + 1 Put ATM.", idealScenario: "Forte valorização.", greeks: "Gamma assimétrico" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Buy', strike: spot, quantity: 200, price: 4.0 }, { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot, quantity: 100, price: 4.0 }] },
  { name: "23. Guts", category: "Volatility", description: "Compra ITM dupla.", details: { thesis: "Volatilidade com Delta estável.", mechanics: "Compra Call e Put dentro do dinheiro.", idealScenario: "Movimento amplo e linear.", greeks: "Delta Neutro, Gamma Reduzido" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 0.95, quantity: 100, price: 6.0 }, { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 1.05, quantity: 100, price: 6.0 }] },
  { name: "24. Iron Condor Reverso", category: "Volatility", description: "Saída de intervalo.", details: { thesis: "Ativo parado deve romper barreira lateral.", mechanics: "Compra de asas internas e venda externas.", idealScenario: "Rompimento do suporte ou resistência.", greeks: "Vega Positivo" }, setup: (spot) => [{ id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.90, quantity: 100, price: 1.0 }, { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 0.95, quantity: 100, price: 3.0 }, { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 1.05, quantity: 100, price: 3.0 }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.10, quantity: 100, price: 1.0 }] },
  { name: "25. Borboleta Reversa (Call)", category: "Volatility", description: "Explosão central.", details: { thesis: "Aposta que o ativo sairá do preço atual.", mechanics: "Venda do miolo e compra de asas.", idealScenario: "Afastamento significativo do centro.", greeks: "Vega Positivo" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 0.95, quantity: 100, price: 6.0 }, { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot, quantity: 200, price: 3.5 }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.05, quantity: 100, price: 1.5 }] },
  { name: "26. Borboleta Reversa (Put)", category: "Volatility", description: "Versão Puts.", details: { thesis: "Explosão de volatilidade utilizando Puts.", mechanics: "Simetria de Puts para movimento direcional.", idealScenario: "Ativo longe do strike central.", greeks: "Vega Positivo" }, setup: (spot) => [{ id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.95, quantity: 100, price: 6.0 }, { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot, quantity: 200, price: 3.5 }, { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 1.05, quantity: 100, price: 1.5 }] },
  { name: "27. Double Ratio (Volatility)", category: "Volatility", description: "Backspread total.", details: { thesis: "Grande expansão lateral do ativo.", mechanics: "Venda ATM dupla e compra OTM quádrupla.", idealScenario: "Expansão da volatilidade implícita.", greeks: "Gamma Positivo em ambos os lados" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Sell', strike: spot, quantity: 100, price: 4.0 }, { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 1.05, quantity: 200, price: 1.5 }, { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot, quantity: 100, price: 4.0 }, { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 0.95, quantity: 200, price: 1.5 }] },

  // RENDA (INCOME)
  { name: "28. Straddle Vendido", category: "Income", description: "Venda de Volatilidade ATM.", details: { thesis: "Aposta em mercado totalmente parado.", mechanics: "Recebimento de prémio máximo (Vega-).", idealScenario: "Pin perfeito no strike.", greeks: "Theta Positivo Máximo" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Sell', strike: spot, quantity: 100, price: 4.0 }, { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot, quantity: 100, price: 4.0 }] },
  { name: "29. Strangle Vendido", category: "Income", description: "Venda de Volatilidade OTM.", details: { thesis: "Mercado em intervalo lateral.", mechanics: "Venda de prémio fora do dinheiro.", idealScenario: "Ativo termina entre os strikes.", greeks: "Theta Positivo, Margem Requerida" }, setup: (spot) => [{ id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.90, quantity: 100, price: 2.0 }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.10, quantity: 100, price: 2.0 }] },
  { name: "30. Iron Condor (Renda)", category: "Income", description: "Renda protegida.", details: { thesis: "Lateralização com risco limitado.", mechanics: "Venda de Strangle com compra de proteção externa.", idealScenario: "Ativo termina no miolo do condor.", greeks: "Theta Positivo, Risco Definido" }, setup: (spot) => [{ id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 0.90, quantity: 100, price: 1.0 }, { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.95, quantity: 100, price: 3.0 }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.05, quantity: 100, price: 3.0 }, { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 1.10, quantity: 100, price: 1.0 }] },
  { name: "31. Iron Butterfly (Renda)", category: "Income", description: "Straddle protegido.", details: { thesis: "Mercado sem movimento com baixo risco.", mechanics: "Venda de Straddle + Compra de asas OTM.", idealScenario: "Ativo fecha exatamente no strike central.", greeks: "Theta Positivo" }, setup: (spot) => [{ id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 0.95, quantity: 100, price: 2.0 }, { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot, quantity: 100, price: 5.0 }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot, quantity: 100, price: 5.0 }, { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 1.05, quantity: 100, price: 2.0 }] },
  { name: "32. Borboleta Clássica (Call)", category: "Income", description: "Borboleta de Calls.", details: { thesis: "Precisão cirúrgica de preço.", mechanics: "Simetria 1-2-1 para custo reduzido.", idealScenario: "Ativo no strike das Calls vendidas.", greeks: "Theta Positivo alto" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 0.95, quantity: 100, price: 6.0 }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot, quantity: 200, price: 3.5 }, { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 1.05, quantity: 100, price: 1.5 }] },
  { name: "33. Borboleta Clássica (Put)", category: "Income", description: "Borboleta de Puts.", details: { thesis: "Alvo de queda preciso.", mechanics: "Combinação 1-2-1 com Puts.", idealScenario: "Pin no strike central das Puts.", greeks: "Theta Positivo" }, setup: (spot) => [{ id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 0.95, quantity: 100, price: 1.5 }, { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot, quantity: 200, price: 3.5 }, { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 1.05, quantity: 100, price: 6.0 }] },
  { name: "34. Broken Wing (Call)", category: "Income", description: "Borboleta Assimétrica.", details: { thesis: "Viés de alta sem custo na subida.", mechanics: "Asa superior aberta (strike mais distante).", idealScenario: "Ativo estável ou em valorização.", greeks: "Theta Positivo, Delta Positivo" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 0.95, quantity: 100, price: 6.0 }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot, quantity: 200, price: 3.5 }, { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 1.10, quantity: 100, price: 0.5 }] },
  { name: "35. Broken Wing (Put)", category: "Income", description: "Borboleta Assimétrica P.", details: { thesis: "Viés de baixa sem risco na queda.", mechanics: "Asa inferior aberta.", idealScenario: "Ativo estável ou em desvalorização.", greeks: "Theta Positivo" }, setup: (spot) => [{ id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 0.90, quantity: 100, price: 0.5 }, { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot, quantity: 200, price: 3.5 }, { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 1.05, quantity: 100, price: 6.0 }] },
  { name: "36. Árvore de Natal (Call)", category: "Income", description: "Christmas Tree 1-3-2.", details: { thesis: "Valorização lenta e controlada.", mechanics: "Compra 1, pula strike, venda 3, compra 2.", idealScenario: "Pico de lucro no strike vendido.", greeks: "Theta Positivo, Vega Negativo" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 0.95, quantity: 100, price: 6.0 }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.05, quantity: 300, price: 1.5 }, { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 1.10, quantity: 200, price: 0.5 }] },
  { name: "37. Árvore de Natal (Put)", category: "Income", description: "Christmas Tree Puts.", details: { thesis: "Queda lenta gerando renda.", mechanics: "Estrutura 1-3-2 de Puts.", idealScenario: "Preço no strike de venda tripla.", greeks: "Theta Positivo" }, setup: (spot) => [{ id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 1.05, quantity: 100, price: 6.0 }, { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.95, quantity: 300, price: 1.5 }, { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 0.90, quantity: 200, price: 0.5 }] },
  { name: "38. Condor de Call", category: "Income", description: "Corpo largo.", details: { thesis: "Amplo intervalo de lucro.", mechanics: "Venda de miolo largo com proteções.", idealScenario: "Ativo estabilizado entre os strikes centrais.", greeks: "Theta Positivo" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 0.90, quantity: 100, price: 9.0 }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 0.95, quantity: 100, price: 6.0 }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.05, quantity: 100, price: 2.0 }, { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 1.10, quantity: 100, price: 0.5 }] },

  // PROTEÇÃO (HEDGE)
  { name: "39. Jade Lizard", category: "Hedge", description: "Put + Bear Call.", details: { thesis: "Renda em mercado lateral/altista.", mechanics: "Venda de Put financia Bear Call Spread.", idealScenario: "Acima do strike vendido da Put.", greeks: "Delta Positivo, Vega Negativo" }, setup: (spot) => [{ id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.90, quantity: 100, price: 4.0 }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.05, quantity: 100, price: 2.5 }, { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 1.10, quantity: 100, price: 1.0 }] },
  { name: "40. Twisted Sister", category: "Hedge", description: "Inverso Jade Lizard.", details: { thesis: "Renda em mercado lateral/baixista.", mechanics: "Venda de Call financia Bull Put Spread.", idealScenario: "Abaixo do strike vendido da Call.", greeks: "Delta Negativo" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.10, quantity: 100, price: 2.0 }, { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.95, quantity: 100, price: 3.0 }, { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 0.90, quantity: 100, price: 1.0 }] },
  { name: "41. Seagull Bullish", category: "Hedge", description: "Spread de alta financiado.", details: { thesis: "Hedge parcial com viés de alta.", mechanics: "Bull Call Spread + Venda de Put OTM.", idealScenario: "Valorização expressiva do ativo.", greeks: "Delta Positivo alto" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Buy', strike: spot, quantity: 100, price: 5.0 }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.05, quantity: 100, price: 2.0 }, { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.90, quantity: 100, price: 3.0 }] },
  { name: "42. Box Spread", category: "Hedge", description: "Arbitragem isenta.", details: { thesis: "Renda fixa via derivativos.", mechanics: "Trava de alta Call + Trava de baixa Put ATM.", idealScenario: "Inexistência de risco direcional.", greeks: "Delta Zero, Gamma Zero" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 0.95, quantity: 100, price: 6.0 }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.05, quantity: 100, price: 2.0 }, { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 1.05, quantity: 100, price: 6.0 }, { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.95, quantity: 100, price: 2.0 }] },
  { name: "43. Fence (Collar)", category: "Hedge", description: "Seguro de carteira.", details: { thesis: "Hedge de ativo físico (ações).", mechanics: "Compra de Put financiada por Venda Call OTM.", idealScenario: "Queda acentuada protegendo o valor do ativo.", greeks: "Delta-" }, setup: (spot) => [{ id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 0.95, quantity: 100, price: 3.0 }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.05, quantity: 100, price: 2.5 }] },
  { name: "44. Lançamento Coberto 1x2", category: "Hedge", description: "Venda Coberta Ratio.", details: { thesis: "Potencializar renda em lateralização.", mechanics: "Ativo físico + Venda dupla de Calls OTM.", idealScenario: "Alta leve até o strike vendido.", greeks: "Theta++" }, setup: (spot) => [{ id: generateUUID(), type: 'Stock', action: 'Buy', strike: spot, quantity: 100, price: spot }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.05, quantity: 200, price: 2.0 }] },
  { name: "45. Collar Sintético", category: "Hedge", description: "Seguro Total.", details: { thesis: "Proteção sem capital imobilizado.", mechanics: "Stock Sintético + Compra de Put e Venda Call.", idealScenario: "Alta moderada mantendo o seguro contra quedas.", greeks: "Delta Controlado" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Buy', strike: spot, quantity: 100, price: 4.0 }, { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot, quantity: 100, price: 4.0 }, { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 0.90, quantity: 100, price: 1.5 }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.10, quantity: 100, price: 1.0 }] }
];

/**
 * COMPONENTES DE INTERFACE (UI/UX)
 */
const GlassCard: React.FC<{ children: React.ReactNode; className?: string; title?: string; icon?: React.ReactNode }> = ({ children, className = "", title, icon }) => (
  <div className={`bg-[#0F172A]/80 backdrop-blur-xl border border-white/5 shadow-2xl rounded-2xl overflow-hidden transition-all duration-300 hover:border-white/10 ${className}`}>
    {title && (
      <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
        <h3 className="text-xs font-black uppercase tracking-[0.2em] text-slate-400 flex items-center gap-2">
          {icon} {title}
        </h3>
      </div>
    )}
    {children}
  </div>
);

const MetricCard: React.FC<{ label: string; value: string | number; color?: string; subLabel?: string }> = ({ label, value, color = "text-slate-100", subLabel }) => (
  <div className="bg-white/[0.03] p-4 rounded-xl border border-white/5 flex flex-col gap-1">
    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{label}</span>
    <span className={`text-xl font-black ${color}`}>{value}</span>
    {subLabel && <span className="text-[10px] font-bold text-slate-600 italic">{subLabel}</span>}
  </div>
);

const ToastContainer: React.FC<{ toasts: { id: number; message: string; type: string }[]; removeToast: (id: number) => void }> = ({ toasts, removeToast }) => (
  <div className="fixed top-6 right-6 z-[100] flex flex-col gap-3 w-full max-w-sm pointer-events-none">
    {toasts.map(t => (
      <div key={t.id} className={`pointer-events-auto flex items-center gap-4 p-5 rounded-2xl shadow-2xl border backdrop-blur-2xl transition-all duration-500 transform hover:scale-102 ${t.type === 'success' ? 'bg-emerald-950/80 border-emerald-500/30 text-emerald-100' : 'bg-rose-950/80 border-rose-500/30 text-rose-100'}`}>
        <div className={`p-2 rounded-lg ${t.type === 'success' ? 'bg-emerald-500/20' : 'bg-rose-500/20'}`}>
          {t.type === 'success' ? <Check size={18} /> : t.type === 'error' ? <AlertCircle size={18} /> : <Info size={18} />}
        </div>
        <p className="text-sm font-bold flex-1">{t.message}</p>
        <button onClick={() => removeToast(t.id)} className="opacity-30 hover:opacity-100 transition-opacity"><X size={16} /></button>
      </div>
    ))}
  </div>
);

/**
 * COMPONENTE PRINCIPAL
 */
export default function OptionsStrategyBuilder() {
  const [spotPrice, setSpotPrice] = useState<number>(100);
  const [simulatedSpot, setSimulatedSpot] = useState<number>(100); 
  const [legs, setLegs] = useState<Leg[]>([]);
  const [toasts, setToasts] = useState<{ id: number; message: string; type: string }[]>([]);
  const [strategyName, setStrategyName] = useState<string>("Custom");
  
  const [tickerQuery, setTickerQuery] = useState<string>("PETR4");
  const [isFetchingMarket, setIsFetchingMarket] = useState<boolean>(false);
  const [marketData, setMarketData] = useState<MarketDataResponse | null>(null);
  const [selectedExpiry, setSelectedExpiration] = useState<string>("");

  const addToast = (msg: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message: msg, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000); 
  };

  useEffect(() => { setSimulatedSpot(spotPrice); }, [spotPrice]);

  const fetchMarketData = async () => {
    if (!tickerQuery) return;
    setIsFetchingMarket(true);
    addToast(`A extrair matriz da B3 para ${tickerQuery.toUpperCase()}...`, 'info');
    try {
      const response = await fetch(`${GAS_URL}?ticker=${tickerQuery.toUpperCase()}`);
      const json = await response.json();
      if (json.status === 'success' && json.data.chain.length > 0) {
        const enrichedChain: MarketOption[] = json.data.chain.map((opt: MarketOption) => ({
          ...opt, ...calculateGreeks(json.data.spotPrice, opt.strike, opt.daysToMaturity, opt.impliedVolatility, opt.type)
        }));
        setMarketData({ ...json.data, chain: enrichedChain });
        setSpotPrice(json.data.spotPrice);
        const dates = [...new Set(enrichedChain.map(opt => opt.expirationDate))];
        if (dates.length > 0) setSelectedExpiration(dates[0]);
        addToast(`Cotações sincronizadas para ${tickerQuery.toUpperCase()}`, 'success');
      }
    } catch (e) { addToast("Falha de comunicação com o Gateway.", 'error'); } finally { setIsFetchingMarket(false); }
  };

  const handleStrategyTemplateChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selected = STRATEGIES.find(s => s.name === e.target.value);
    if (selected) {
      setStrategyName(selected.name);
      const newLegs = selected.setup(spotPrice).map(leg => {
        const match = marketData?.chain.find(o => Math.abs(o.strike - leg.strike) < 0.15 && o.type === leg.type);
        return { ...leg, delta: match?.delta || 0, gamma: match?.gamma || 0, theta: match?.theta || 0, vega: match?.vega || 0 };
      });
      setLegs(newLegs);
      addToast(`Modelo "${selected.name}" configurado.`, 'success');
    } else { setStrategyName("Custom"); }
  };

  const addLegFromMarket = (option: MarketOption | undefined, action: ActionType) => {
    if (!option) return;
    setLegs([...legs, { 
      id: generateUUID(), type: option.type, action, strike: option.strike, quantity: 100, 
      price: action === 'Buy' ? option.ask : option.bid, ...option
    }]);
  };

  const updateLeg = (id: string, field: keyof Leg, value: any) => {
    setLegs(prev => prev.map(leg => leg.id === id ? { ...leg, [field]: value } : leg));
  };

  const removeLeg = (id: string) => setLegs(legs.filter(l => l.id !== id));

  // --- CÁLCULOS DERIVADOS ---
  const payoffData = useMemo(() => {
    const range: number[] = [];
    const lower = spotPrice * 0.7, upper = spotPrice * 1.3, step = (upper - lower) / 100;
    for (let p = lower; p <= upper; p += step) range.push(p);
    return calculatePayoff(legs, range);
  }, [legs, spotPrice]);

  const metrics = useMemo(() => calculateMetrics(legs, payoffData), [legs, payoffData]);

  const tBoardData = useMemo(() => {
    if (!marketData || !selectedExpiry) return [];
    const optionsForExpiry = marketData.chain.filter(o => o.expirationDate === selectedExpiry);
    const strikes = [...new Set(optionsForExpiry.map(o => o.strike))].sort((a, b) => a - b);
    return strikes.map(strike => ({
      strike,
      call: optionsForExpiry.find(o => o.strike === strike && o.type === 'Call'),
      put: optionsForExpiry.find(o => o.strike === strike && o.type === 'Put')
    }));
  }, [marketData, selectedExpiry]);

  const currentStratInfo = STRATEGIES.find(s => s.name === strategyName);

  return (
    <div className="min-h-screen font-sans text-slate-100 bg-[#020617] p-6 md:p-10 selection:bg-blue-500/40">
      <ToastContainer toasts={toasts} removeToast={(id) => setToasts(prev => prev.filter(t => t.id !== id))} />

      {/* HEADER INSTITUCIONAL */}
      <header className="flex flex-col lg:flex-row justify-between items-center mb-10 gap-6">
        <div className="flex items-center gap-4">
          <div className="bg-blue-600 p-3 rounded-2xl shadow-2xl shadow-blue-500/20">
            <Activity className="text-white" size={28} />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tighter text-white flex items-center gap-2">
              ARQUITETO DE OPÇÕES <span className="text-[10px] bg-white/10 px-2 py-0.5 rounded-md text-slate-400 font-bold tracking-widest">PRO V2.2</span>
            </h1>
            <p className="text-slate-500 text-xs font-bold uppercase tracking-widest">Controle de Risco & Engenharia Financeira</p>
          </div>
        </div>
        
        <div className="flex flex-wrap gap-4 items-end">
          <div className="flex flex-col gap-2">
            <span className="text-[9px] font-black text-blue-500 uppercase tracking-widest ml-1">Modelo Operacional</span>
            <select onChange={handleStrategyTemplateChange} value={strategyName} className="bg-slate-900 border border-white/10 rounded-xl px-4 py-2.5 text-xs font-bold text-white outline-none hover:bg-slate-800 transition-all cursor-pointer shadow-lg w-56">
              <option value="Custom">Configuração Manual</option>
              {STRATEGIES.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-[9px] font-black text-blue-500 uppercase tracking-widest ml-1">Ticker B3 (Real-Time)</span>
            <div className="flex gap-2 bg-slate-900 p-1.5 rounded-xl border border-white/10 shadow-lg">
              <input type="text" value={tickerQuery} onChange={(e) => setTickerQuery(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === 'Enter' && fetchMarketData()} className="bg-transparent border-none outline-none text-white px-3 w-24 font-black uppercase text-sm placeholder:text-slate-700" placeholder="PETR4" />
              <button onClick={fetchMarketData} disabled={isFetchingMarket} className="bg-blue-600 hover:bg-blue-500 px-5 py-2 rounded-lg text-[10px] font-black flex items-center gap-2 transition-all active:scale-95 disabled:opacity-50">
                {isFetchingMarket ? <RefreshCw className="animate-spin" size={14} /> : <Search size={14} />} SINCRONIZAR
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* DASHBOARD PRINCIPAL */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-8 space-y-8">
          
          <GlassCard title="Projeção Estocástica de Payoff" icon={<BarChart3 size={14} />} className="h-[480px] relative">
             <div className={`absolute top-24 left-1/2 transform -translate-x-1/2 z-20 px-10 py-4 rounded-3xl border backdrop-blur-3xl shadow-2xl transition-all duration-700 ${metrics.cost <= 0 ? 'bg-emerald-950/40 border-emerald-500/20' : 'bg-rose-950/40 border-rose-500/20'}`}>
                <div className="text-[9px] font-black uppercase tracking-[0.3em] text-center text-slate-400 mb-1">Resultado Simulado no Alvo</div>
                <div className="text-4xl font-black text-center tracking-tighter">
                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(calculatePayoff(legs, [simulatedSpot])[0]?.value || 0)}
                </div>
             </div>
             <ResponsiveContainer width="100%" height="85%">
               <AreaChart data={payoffData} margin={{ top: 120, right: 30, left: 10, bottom: 0 }}>
                 <defs>
                   <linearGradient id="profitGradient" x1="0" y1="0" x2="0" y2="1">
                     <stop offset="5%" stopColor="#10B981" stopOpacity={0.3}/>
                     <stop offset="95%" stopColor="#10B981" stopOpacity={0}/>
                   </linearGradient>
                 </defs>
                 <CartesianGrid strokeDasharray="4 4" stroke="#ffffff03" vertical={false} />
                 <XAxis dataKey="price" stroke="#334155" tick={{fontSize: 10, fontWeight: '900'}} />
                 <YAxis stroke="#334155" tick={{fontSize: 10}} tickFormatter={v => `R$${v}`} />
                 <Tooltip labelFormatter={(v) => `Preço do Ativo: R$ ${v}`} formatter={(v: number) => [`R$ ${v.toFixed(2)}`, 'PnL Teórico']} contentStyle={{backgroundColor: '#0F172A', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)'}} />
                 <ReferenceLine y={0} stroke="#475569" strokeWidth={2} />
                 <ReferenceLine x={spotPrice} stroke="#FBBF24" strokeDasharray="8 8" label={{value: 'SPOT ATUAL', fill: '#FBBF24', fontSize: 10, fontWeight: '900', position: 'insideBottomLeft'}} />
                 <ReferenceLine x={simulatedSpot} stroke="#FFF" label={{value: 'SIMULAÇÃO', fill: '#FFF', fontSize: 10, fontWeight: '900', position: 'top'}} />
                 <Area type="monotone" dataKey="value" stroke="#3B82F6" strokeWidth={5} fill="url(#profitGradient)" animationDuration={1000} />
               </AreaChart>
             </ResponsiveContainer>
             <div className="px-10 pb-8 -mt-4">
                <div className="flex justify-between text-[10px] font-black text-slate-600 uppercase tracking-widest mb-3">
                   <span>Stress de Baixa (-30%)</span>
                   <span className="text-white bg-blue-500/20 px-4 py-1 rounded-full border border-blue-500/10">Simulação de Cenários (What-if)</span>
                   <span>Stress de Alta (+30%)</span>
                </div>
                <input type="range" min={spotPrice * 0.7} max={spotPrice * 1.3} step={0.01} value={simulatedSpot} onChange={(e) => setSimulatedSpot(parseFloat(e.target.value))} className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500 hover:accent-blue-400 transition-all shadow-inner" />
             </div>
          </GlassCard>

          {/* CONSOLIDAÇÃO DAS POSIÇÕES COM PRÊMIO EDITÁVEL */}
          <GlassCard title="Consolidação das Posições (Pernas)" icon={<LayoutGrid size={14} />}>
            <div className="overflow-x-auto max-h-[350px] custom-scrollbar">
              <table className="w-full text-xs text-left border-collapse">
                 <thead className="bg-white/[0.02] text-[10px] font-black uppercase text-slate-500 sticky top-0 z-10">
                   <tr className="border-b border-white/5">
                     <th className="p-5">Operação</th>
                     <th className="p-5">Tipo</th>
                     <th className="p-5">Strike</th>
                     <th className="p-5 text-center">Qt. Lotes</th>
                     <th className="p-5 text-center">Prémio (Editável)</th>
                     <th className="p-5 text-center">Delta Unit.</th>
                     <th className="p-5 text-right">Ações</th>
                   </tr>
                 </thead>
                 <tbody className="divide-y divide-white/5">
                   {legs.map(l => (
                     <tr key={l.id} className="hover:bg-white/[0.03] group transition-all duration-200">
                       <td className="p-5">
                         <span className={`px-3 py-1 rounded-lg font-black text-[10px] ${l.action === 'Buy' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                           {l.action === 'Buy' ? 'COMPRA' : 'VENDA'}
                         </span>
                       </td>
                       <td className="p-5 font-black text-slate-300">{l.type}</td>
                       <td className="p-5 text-blue-400 font-mono font-black">{l.type === 'Stock' ? '---' : l.strike.toFixed(2)}</td>
                       <td className="p-5 text-center">
                         <input type="number" value={l.quantity} onChange={(e) => updateLeg(l.id, 'quantity', parseInt(e.target.value) || 0)} className="bg-white/5 w-24 px-3 py-1.5 rounded-lg text-center outline-none border border-white/5 focus:border-blue-500/50 font-mono font-bold text-white transition-all" />
                       </td>
                       <td className="p-5 text-center">
                         <div className="flex items-center justify-center gap-1 bg-white/5 rounded-lg border border-white/5 px-2 focus-within:border-blue-500/50 transition-all">
                            <span className="text-[10px] text-slate-500 font-bold">R$</span>
                            <input 
                              type="number" 
                              step="0.01"
                              value={l.price} 
                              onChange={(e) => {
                                const val = parseFloat(e.target.value);
                                updateLeg(l.id, 'price', isNaN(val) ? 0 : val);
                              }} 
                              className="bg-transparent w-20 py-1.5 rounded-lg text-left outline-none font-mono font-bold text-white transition-all text-xs" 
                            />
                         </div>
                       </td>
                       <td className="p-5 text-center text-slate-500 font-mono">{l.delta ? l.delta.toFixed(3) : '-'}</td>
                       <td className="p-5 text-right">
                         <button onClick={() => removeLeg(l.id)} className="text-slate-600 hover:text-rose-500 transition-colors p-2 rounded-lg hover:bg-rose-500/10">
                           <Trash2 size={16}/>
                         </button>
                       </td>
                     </tr>
                   ))}
                 </tbody>
              </table>
              {legs.length === 0 && (
                <div className="p-20 text-center flex flex-col items-center gap-4 opacity-20">
                  <BookOpen size={48} />
                  <p className="text-sm font-black uppercase tracking-widest">Nenhuma posição ativa no terminal</p>
                </div>
              )}
            </div>
          </GlassCard>
        </div>

        <div className="lg:col-span-4 space-y-8">
          
          <GlassCard title="Controle de Risco & Garantias" icon={<Shield size={14} />} className="bg-gradient-to-br from-slate-900 to-slate-950 border-blue-500/20 shadow-blue-500/5">
            <div className="p-6 space-y-6">
              <div>
                <MetricCard 
                  label="Custo Líquido da Operação" 
                  value={new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Math.abs(metrics.cost))}
                  color={metrics.cost > 0 ? "text-rose-400" : "text-emerald-400"}
                  subLabel={metrics.cost > 0 ? "Fluxo de Caixa: Saída (Débito)" : "Fluxo de Caixa: Entrada (Crédito)"}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <MetricCard label="Lucro Máx." value={typeof metrics.maxProfit === 'number' ? `R$ ${metrics.maxProfit.toLocaleString('pt-BR')}` : "Ilimitado"} color="text-emerald-400" />
                <MetricCard label="Risco Máx." value={typeof metrics.maxLoss === 'number' ? `R$ ${Math.abs(metrics.maxLoss).toLocaleString('pt-BR')}` : "Ilimitado"} color="text-rose-400" />
              </div>

              <div className="bg-white/[0.02] p-5 rounded-2xl border border-white/5 space-y-4">
                <h4 className="text-[10px] font-black text-blue-500 uppercase tracking-widest flex items-center gap-2">
                  <Zap size={12}/> Sensibilidades da Carteira (Gregas)
                </h4>
                <div className="grid grid-cols-2 gap-y-5 gap-x-4">
                  <div className="flex flex-col">
                    <span className="text-[9px] font-black text-slate-600 uppercase">Delta Líquido</span>
                    <span className={`text-sm font-mono font-black ${metrics.greeks.delta > 0 ? 'text-blue-400' : 'text-orange-400'}`}>{metrics.greeks.delta.toFixed(2)}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[9px] font-black text-slate-600 uppercase">Theta (Decaimento/Dia)</span>
                    <span className={`text-sm font-mono font-black ${metrics.greeks.theta > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>R$ {metrics.greeks.theta.toFixed(2)}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[9px] font-black text-slate-600 uppercase">Gamma (Aceleração)</span>
                    <span className="text-sm font-mono font-black text-slate-300">{metrics.greeks.gamma.toFixed(4)}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[9px] font-black text-slate-600 uppercase">Vega (Sens. Volatilidade)</span>
                    <span className="text-sm font-mono font-black text-fuchsia-400">{metrics.greeks.vega.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {metrics.breakevens.length > 0 && (
                <div className="pt-2">
                  <span className="text-[9px] font-black text-slate-600 uppercase mb-3 block tracking-widest">Pontos de Equilíbrio (Breakevens)</span>
                  <div className="flex gap-2 flex-wrap">
                    {metrics.breakevens.map((be, i) => (
                      <span key={i} className="px-3 py-1.5 rounded-lg bg-blue-500/10 text-blue-400 font-mono text-[11px] font-black border border-blue-500/20 shadow-lg shadow-blue-500/5">
                        R$ {be.toFixed(2)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </GlassCard>

          <GlassCard title="Tese de Investimento & Estrutura" icon={<BookOpen size={14} />} className="bg-slate-900/30">
             {currentStratInfo ? (
               <div className="p-6 space-y-5">
                 <div className="bg-blue-600/5 p-4 rounded-xl border-l-4 border-blue-600 text-[11px] leading-relaxed text-slate-300 italic shadow-inner">
                   "{currentStratInfo.details.thesis}"
                 </div>
                 <div className="grid grid-cols-2 gap-4">
                    <div className="bg-white/[0.02] p-3 rounded-xl">
                      <div className="text-[8px] font-black text-slate-600 uppercase mb-1">Cenário Ideal</div>
                      <div className="text-[10px] font-bold text-slate-200 uppercase tracking-tighter leading-tight">{currentStratInfo.details.idealScenario}</div>
                    </div>
                    <div className="bg-white/[0.02] p-3 rounded-xl text-center">
                      <div className="text-[8px] font-black text-slate-600 uppercase mb-1">Assinatura de Gregas</div>
                      <div className="text-[10px] font-mono text-emerald-400 font-black tracking-widest">{currentStratInfo.details.greeks}</div>
                    </div>
                 </div>
               </div>
             ) : (
               <div className="p-10 text-center text-[10px] font-black text-slate-700 uppercase tracking-[0.2em]">Selecione um modelo operacional</div>
             )}
          </GlassCard>

          <GlassCard title="Matriz de Mercado (Option Chain)" icon={<Target size={14} />} className="flex flex-col h-[480px]">
             <div className="p-4 bg-white/[0.02] border-b border-white/5 space-y-4">
                {marketData ? (
                  <div className="relative group">
                    <select value={selectedExpiry} onChange={(e) => setSelectedExpiration(e.target.value)} className="w-full bg-slate-900 border border-white/10 rounded-xl px-4 py-2.5 text-xs font-black text-white outline-none cursor-pointer appearance-none hover:bg-slate-800 transition-all shadow-lg">
                      {[...new Set(marketData.chain.map(o => o.expirationDate))].map(d => (
                        <option key={d} value={d}>{new Date(d).toLocaleDateString('pt-BR')} ({marketData.chain.find(o => o.expirationDate === d)?.daysToMaturity} Dias)</option>
                      ))}
                    </select>
                    <div className="absolute right-4 top-3.5 pointer-events-none text-slate-500"><ChevronDown size={14}/></div>
                  </div>
                ) : (
                  <div className="p-6 text-center border-2 border-dashed border-white/5 rounded-2xl">
                    <div className="text-[10px] font-black text-slate-700 uppercase animate-pulse">Aguardando Ticker...</div>
                  </div>
                )}
             </div>
             <div className="overflow-y-auto flex-1 custom-scrollbar bg-slate-950/20">
                <table className="w-full text-[10px] font-mono text-center">
                  <thead className="sticky top-0 bg-slate-900 shadow-xl z-20">
                    <tr className="border-b border-white/10">
                      <th className="py-3 text-emerald-500 font-black">CALL (VENDA)</th>
                      <th className="bg-slate-800 text-white px-2 font-black">STRIKE</th>
                      <th className="py-3 text-rose-500 font-black">PUT (COMPRA)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {tBoardData.map((row, i) => {
                      const isATM = Math.abs(row.strike - spotPrice) < 0.25;
                      const isITMCall = row.strike < spotPrice;
                      const isITMPut = row.strike > spotPrice;

                      return (
                        <tr key={i} className={`transition-colors duration-150 ${isATM ? 'bg-blue-600/[0.08]' : 'hover:bg-white/[0.03]'}`}>
                          {/* CALL BID (Para Venda) */}
                          <td className={`p-0 ${isITMCall ? 'bg-emerald-500/[0.03]' : ''}`}>
                            <button onClick={() => addLegFromMarket(row.call, 'Sell')} className="w-full py-3 px-1 text-emerald-500/40 hover:text-emerald-400 font-black transition-all">
                              {row.call?.bid.toFixed(2) || '-'}
                            </button>
                          </td>
                          
                          {/* STRIKE CENTRAL */}
                          <td className={`p-0 bg-slate-900/60 font-black border-x border-white/[0.02] ${isATM ? 'text-blue-400' : 'text-slate-600'}`}>
                            {row.strike.toFixed(2)}
                          </td>
                          
                          {/* PUT ASK (Para Compra) */}
                          <td className={`p-0 ${isITMPut ? 'bg-rose-500/[0.03]' : ''}`}>
                            <button onClick={() => addLegFromMarket(row.put, 'Buy')} className="w-full py-3 px-1 text-rose-500/40 hover:text-rose-400 font-black transition-all">
                              {row.put?.ask.toFixed(2) || '-'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
             </div>
             <div className="p-3 bg-white/[0.01] border-t border-white/5 text-[9px] text-slate-600 text-center font-bold uppercase tracking-widest italic">
               Clique nos valores para adicionar pernas dinâmicas
             </div>
          </GlassCard>
        </div>
      </div>

      {/* ESTILIZAÇÃO GLOBAL DE SCROLLBAR E UI */}
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 5px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.05); border-radius: 20px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.15); }
        
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          height: 16px;
          width: 16px;
          border-radius: 50%;
          background: #3B82F6;
          box-shadow: 0 0 15px rgba(59, 130, 246, 0.5);
          cursor: pointer;
        }

        .scale-102:hover { transform: scale(1.02); }
      `}</style>
    </div>
  );
}
