import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine 
} from 'recharts';
import { 
  Plus, Trash2, Save, Download, TrendingUp, TrendingDown, 
  Activity, DollarSign, Shield, Zap, LayoutGrid, ChevronDown, Check
} from 'lucide-react';

/**
 * CONFIGURAÇÃO E TYPES
 */

// SUBSTITUA PELA SUA URL DE DEPLOY DO GOOGLE APPS SCRIPT
const GAS_URL = "[https://script.google.com/macros/s/AKfycbzqSFOMVRsyxcAQi8MOu0QXonTr96IgiT0d1qASaNi2_ShmaBJlWkIxfenML2GbmB0k/exec](https://script.google.com/macros/s/AKfycbzqSFOMVRsyxcAQi8MOu0QXonTr96IgiT0d1qASaNi2_ShmaBJlWkIxfenML2GbmB0k/exec)"; 

type OptionType = 'Call' | 'Put';
type ActionType = 'Buy' | 'Sell';

interface Leg {
  id: string;
  type: OptionType;
  action: ActionType;
  strike: number;
  quantity: number;
  price: number; // Premium
  iv?: number;
}

interface StrategyTemplate {
  name: string;
  category: 'Bullish' | 'Bearish' | 'Volatility' | 'Income' | 'Hedge';
  description: string;
  setup: (spot: number) => Leg[];
}

interface PayoffPoint {
  price: number;
  value: number;
}

interface Metrics {
  cost: number;
  maxProfit: number | string;
  maxLoss: number | string;
  breakevens: number[];
}

/**
 * ENGINE MATEMÁTICA (Financial Engineering Core)
 */

const generateUUID = () => Math.random().toString(36).substr(2, 9);

// Cálculo do valor intrínseco de uma opção no vencimento
const getOptionValueAtExpiry = (type: OptionType, strike: number, spot: number) => {
  if (type === 'Call') return Math.max(0, spot - strike);
  return Math.max(0, strike - spot);
};

// Cálculo do Payoff total da estrutura
const calculatePayoff = (legs: Leg[], spotRange: number[]) => {
  return spotRange.map(spot => {
    let totalPnl = 0;
    legs.forEach(leg => {
      const valueAtExpiry = getOptionValueAtExpiry(leg.type, leg.strike, spot);
      const cost = leg.quantity * leg.price;
      
      // Se comprou (Long), PnL = Valor no Vencimento - Custo Inicial
      // Se vendeu (Short), PnL = Custo Inicial (Prêmio Recebido) - Valor no Vencimento
      if (leg.action === 'Buy') {
        totalPnl += (valueAtExpiry * leg.quantity) - cost;
      } else {
        totalPnl += cost - (valueAtExpiry * leg.quantity);
      }
    });
    return { price: spot, value: totalPnl };
  });
};

const calculateMetrics = (legs: Leg[], payoffData: PayoffPoint[]): Metrics => {
  // Custo Inicial (Net Debit/Credit)
  let cost = 0;
  legs.forEach(leg => {
    const legCost = leg.quantity * leg.price;
    if (leg.action === 'Buy') cost += legCost;
    else cost -= legCost;
  });

  // Max Profit/Loss
  const values = payoffData.map(p => p.value);
  const maxVal = Math.max(...values);
  const minVal = Math.min(...values);
  
  // Breakevens (Cruzamentos do zero)
  const breakevens: number[] = [];
  for (let i = 1; i < payoffData.length; i++) {
    const prev = payoffData[i-1];
    const curr = payoffData[i];
    if ((prev.value < 0 && curr.value >= 0) || (prev.value > 0 && curr.value <= 0)) {
      breakevens.push(parseFloat(curr.price.toFixed(2)));
    }
  }

  return {
    cost, // Se positivo, é débito (pagou). Se negativo, é crédito (recebeu).
    maxProfit: maxVal > 100000 ? "Ilimitado" : maxVal,
    maxLoss: minVal < -100000 ? "Ilimitado" : minVal,
    breakevens
  };
};

/**
 * STRATEGY FACTORY (45 ESTRATÉGIAS - COMPLETO)
 */
const STRATEGIES: StrategyTemplate[] = [
  // --- 1. BULLISH (ALTA) [1-9] ---
  {
    name: "1. Long Call",
    category: "Bullish",
    description: "Compra de Call a seco. Aposta direcional simples na alta com risco limitado.",
    setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Buy', strike: spot, quantity: 1, price: 2.5 }]
  },
  {
    name: "2. Short Put (Naked Put)",
    category: "Bullish",
    description: "Venda de Put a seco. Assume obrigação de comprar o ativo. Theta positivo.",
    setup: (spot) => [{ id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.95, quantity: 1, price: 2.0 }]
  },
  {
    name: "3. Bull Call Spread",
    category: "Bullish",
    description: "Trava de Alta com Calls: Compra ATM, Vende OTM. Reduz custo, limita lucro.",
    setup: (spot) => [
      { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot, quantity: 1, price: 5.0 },
      { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.05, quantity: 1, price: 2.0 }
    ]
  },
  {
    name: "4. Bull Put Spread",
    category: "Bullish",
    description: "Trava de Alta com Puts (Credit Spread): Vende Put ATM/OTM, Compra Put OTM inferior.",
    setup: (spot) => [
      { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.95, quantity: 1, price: 3.0 },
      { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 0.90, quantity: 1, price: 1.0 }
    ]
  },
  {
    name: "5. Call Ratio Spread (1x2)",
    category: "Bullish",
    description: "Compra 1 Call ATM e vende 2 Calls OTM. Lucro na alta moderada, risco na alta explosiva.",
    setup: (spot) => [
      { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot, quantity: 1, price: 5.0 },
      { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.05, quantity: 2, price: 2.0 }
    ]
  },
  {
    name: "6. Risk Reversal (Collar)",
    category: "Bullish",
    description: "Financia compra de Call OTM com venda de Put OTM. Estrutura de custo zero (Zero Cost Collar).",
    setup: (spot) => [
      { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 1.05, quantity: 1, price: 3.0 },
      { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.95, quantity: 1, price: 3.0 }
    ]
  },
  {
    name: "7. Call Backspread",
    category: "Bullish",
    description: "Vende 1 Call ATM, Compra 2 Calls OTM. Lucra com alta forte ou queda forte (Volatilidade).",
    setup: (spot) => [
      { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot, quantity: 1, price: 5.0 },
      { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 1.05, quantity: 2, price: 2.0 }
    ]
  },
  {
    name: "8. Bull Call Ladder",
    category: "Bullish",
    description: "Variação do Ratio: Compra 1 Call ATM, Vende 1 Call OTM e Vende 1 Call OTM+.",
    setup: (spot) => [
      { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot, quantity: 1, price: 5.0 },
      { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.05, quantity: 1, price: 2.0 },
      { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.10, quantity: 1, price: 1.0 }
    ]
  },
  {
    name: "9. Synthetic Long Stock",
    category: "Bullish",
    description: "Compra Call ATM e Vende Put ATM. Replica o comportamento do ativo objeto.",
    setup: (spot) => [
      { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot, quantity: 1, price: 4.0 },
      { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot, quantity: 1, price: 4.0 }
    ]
  },

  // --- 2. BEARISH (BAIXA) [10-18] ---
  {
    name: "10. Long Put",
    category: "Bearish",
    description: "Compra de Put a seco. Aposta direcional na baixa ou seguro de carteira.",
    setup: (spot) => [{ id: generateUUID(), type: 'Put', action: 'Buy', strike: spot, quantity: 1, price: 2.5 }]
  },
  {
    name: "11. Short Call (Naked Call)",
    category: "Bearish",
    description: "Venda de Call a seco. Risco ilimitado na alta. Theta positivo.",
    setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.05, quantity: 1, price: 2.0 }]
  },
  {
    name: "12. Bear Put Spread",
    category: "Bearish",
    description: "Trava de Baixa com Puts: Compra Put ATM, Vende Put OTM.",
    setup: (spot) => [
      { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot, quantity: 1, price: 5.0 },
      { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.95, quantity: 1, price: 2.0 }
    ]
  },
  {
    name: "13. Bear Call Spread",
    category: "Bearish",
    description: "Trava de Baixa com Calls (Credit Spread): Vende Call ATM/OTM, Compra Call OTM superior.",
    setup: (spot) => [
      { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.05, quantity: 1, price: 3.0 },
      { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 1.10, quantity: 1, price: 1.0 }
    ]
  },
  {
    name: "14. Put Ratio Spread (1x2)",
    category: "Bearish",
    description: "Compra 1 Put ATM, Vende 2 Puts OTM. Lucra na baixa moderada.",
    setup: (spot) => [
      { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot, quantity: 1, price: 5.0 },
      { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.90, quantity: 2, price: 1.5 }
    ]
  },
  {
    name: "15. Put Backspread",
    category: "Bearish",
    description: "Vende 1 Put ATM, Compra 2 Puts OTM. Hedge contra crash severo.",
    setup: (spot) => [
      { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot, quantity: 1, price: 5.0 },
      { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 0.90, quantity: 2, price: 2.0 }
    ]
  },
  {
    name: "16. Bear Put Ladder",
    category: "Bearish",
    description: "Escada de Baixa: Compra 1 Put ATM, Vende 1 Put OTM, Vende 1 Put OTM-.",
    setup: (spot) => [
      { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot, quantity: 1, price: 5.0 },
      { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.95, quantity: 1, price: 2.0 },
      { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.90, quantity: 1, price: 1.0 }
    ]
  },
  {
    name: "17. Synthetic Short Stock",
    category: "Bearish",
    description: "Vende Call ATM e Compra Put ATM. Replica venda a descoberto do ativo.",
    setup: (spot) => [
      { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot, quantity: 1, price: 4.0 },
      { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot, quantity: 1, price: 4.0 }
    ]
  },
  {
    name: "18. Synthetic Put",
    category: "Bearish",
    description: "Sintético de Put usando Call e Ações (simuladas via Call ATM/Put ATM).",
    // Simulation: Long Call OTM + Short Stock (Synth) -> Long Call OTM + (Short Call ATM + Long Put ATM)
    setup: (spot) => [
      { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 1.05, quantity: 1, price: 2.0 },
      { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot, quantity: 1, price: 4.0 },
      { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot, quantity: 1, price: 4.0 }
    ]
  },


  // --- 3. VOLATILITY (VEGA LONG) [19-27] ---
  {
    name: "19. Long Straddle",
    category: "Volatility",
    description: "Compra Call e Put no mesmo strike. Aposta na explosão para qualquer lado.",
    setup: (spot) => [
      { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot, quantity: 1, price: 4.0 },
      { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot, quantity: 1, price: 4.0 }
    ]
  },
  {
    name: "20. Long Strangle",
    category: "Volatility",
    description: "Compra Put OTM e Call OTM. Mais barato que Straddle, exige movimento maior.",
    setup: (spot) => [
      { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 0.95, quantity: 1, price: 2.5 },
      { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 1.05, quantity: 1, price: 2.5 }
    ]
  },
  {
    name: "21. Strip",
    category: "Volatility",
    description: "Variação do Straddle Bearish: 2 Long Puts + 1 Long Call. Aposta em vol com viés de baixa.",
    setup: (spot) => [
      { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot, quantity: 2, price: 4.0 },
      { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot, quantity: 1, price: 4.0 }
    ]
  },
  {
    name: "22. Strap",
    category: "Volatility",
    description: "Variação do Straddle Bullish: 2 Long Calls + 1 Long Put. Aposta em vol com viés de alta.",
    setup: (spot) => [
      { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot, quantity: 2, price: 4.0 },
      { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot, quantity: 1, price: 4.0 }
    ]
  },
  {
    name: "23. Guts",
    category: "Volatility",
    description: "Compra Call ITM e Put ITM. Caro, mas com delta alto imediato.",
    setup: (spot) => [
      { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 0.95, quantity: 1, price: 6.0 },
      { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 1.05, quantity: 1, price: 6.0 }
    ]
  },
  {
    name: "24. Short Iron Condor (Reverse)",
    category: "Volatility",
    description: "Débito. Aposta na saída do intervalo. Compra miolo, vende pontas.",
    setup: (spot) => [
      { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.90, quantity: 1, price: 1.0 },
      { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 0.95, quantity: 1, price: 3.0 },
      { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 1.05, quantity: 1, price: 3.0 },
      { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.10, quantity: 1, price: 1.0 },
    ]
  },
  {
    name: "25. Short Butterfly (Call)",
    category: "Volatility",
    description: "Vende miolo, compra pontas. Lucra se o preço explodir para longe do centro.",
    setup: (spot) => [
      { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 0.95, quantity: 1, price: 6.0 },
      { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot, quantity: 2, price: 3.5 },
      { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.05, quantity: 1, price: 1.5 }
    ]
  },
  {
    name: "26. Short Butterfly (Put)",
    category: "Volatility",
    description: "Versão com Puts. Vende miolo, compra pontas.",
    setup: (spot) => [
      { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.95, quantity: 1, price: 6.0 },
      { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot, quantity: 2, price: 3.5 },
      { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 1.05, quantity: 1, price: 1.5 }
    ]
  },
  {
    name: "27. Double Ratio",
    category: "Volatility",
    description: "Compra 1 Call, Vende 2 Calls OTM. Compra 1 Put, Vende 2 Puts OTM. Aposta em estabilidade mas com pontas soltas.",
    setup: (spot) => [
      { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 1.02, quantity: 1, price: 3.0 },
      { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.05, quantity: 2, price: 1.5 },
      { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 0.98, quantity: 1, price: 3.0 },
      { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.95, quantity: 2, price: 1.5 }
    ]
  },

  // --- 4. INCOME / THETA (VEGA SHORT) [28-38] ---
  {
    name: "28. Short Straddle",
    category: "Income",
    description: "Venda de Call e Put no mesmo strike. Lucra máxima na estabilidade.",
    setup: (spot) => [
      { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot, quantity: 1, price: 4.0 },
      { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot, quantity: 1, price: 4.0 }
    ]
  },
  {
    name: "29. Short Strangle",
    category: "Income",
    description: "Venda de Put OTM e Call OTM. Alta probabilidade de lucro, risco ilimitado nas pontas.",
    setup: (spot) => [
      { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.90, quantity: 1, price: 2.0 },
      { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.10, quantity: 1, price: 2.0 }
    ]
  },
  {
    name: "30. Iron Condor",
    category: "Income",
    description: "Strangle vendido com 'asas' compradas para travar o risco (Bull Put + Bear Call).",
    setup: (spot) => [
      { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 0.90, quantity: 1, price: 1.0 },
      { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.95, quantity: 1, price: 3.0 },
      { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.05, quantity: 1, price: 3.0 },
      { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 1.10, quantity: 1, price: 1.0 },
    ]
  },
  {
    name: "31. Iron Butterfly",
    category: "Income",
    description: "Straddle vendido com 'asas' compradas para travar risco. Corpo ATM.",
    setup: (spot) => [
      { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 0.95, quantity: 1, price: 2.0 },
      { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot, quantity: 1, price: 5.0 },
      { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot, quantity: 1, price: 5.0 },
      { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 1.05, quantity: 1, price: 2.0 },
    ]
  },
  {
    name: "32. Butterfly (Call)",
    category: "Income",
    description: "Borboleta clássica. Lucro máximo no miolo. Risco limitado.",
    setup: (spot) => [
      { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 0.95, quantity: 1, price: 6.0 },
      { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot, quantity: 2, price: 3.5 },
      { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 1.05, quantity: 1, price: 1.5 }
    ]
  },
  {
    name: "33. Butterfly (Put)",
    category: "Income",
    description: "Borboleta usando Puts. Mesmo perfil de payoff da Call Butterfly, mas usando Puts.",
    setup: (spot) => [
      { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 0.95, quantity: 1, price: 1.5 },
      { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot, quantity: 2, price: 3.5 },
      { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 1.05, quantity: 1, price: 6.0 }
    ]
  },
  {
    name: "34. Broken Wing Butterfly (Call)",
    category: "Income",
    description: "Borboleta assimétrica. Uma asa é mais distante para gerar crédito na montagem.",
    setup: (spot) => [
      { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 0.95, quantity: 1, price: 6.0 },
      { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot, quantity: 2, price: 3.5 },
      { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 1.10, quantity: 1, price: 0.5 } // Asa quebrada
    ]
  },
  {
    name: "35. Broken Wing Butterfly (Put)",
    category: "Income",
    description: "Borboleta assimétrica com Puts. Geralmente montada para crédito.",
    setup: (spot) => [
      { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 0.90, quantity: 1, price: 0.5 },
      { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot, quantity: 2, price: 3.5 },
      { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 1.05, quantity: 1, price: 6.0 }
    ]
  },
  {
    name: "36. Christmas Tree (Call)",
    category: "Income",
    description: "Variação da Butterfly com strikes progressivos (1-1-1 ao invés de 1-2-1).",
    setup: (spot) => [
      { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 0.95, quantity: 1, price: 6.0 },
      { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot, quantity: 1, price: 3.5 },
      { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.05, quantity: 1, price: 1.5 }
    ]
  },
  {
    name: "37. Christmas Tree (Put)",
    category: "Income",
    description: "Variação da Butterfly com Puts e strikes progressivos.",
    setup: (spot) => [
      { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.95, quantity: 1, price: 1.5 },
      { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot, quantity: 1, price: 3.5 },
      { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 1.05, quantity: 1, price: 6.0 }
    ]
  },
  {
    name: "38. Condor",
    category: "Income",
    description: "Similar ao Iron Condor, mas usando apenas Calls (ou apenas Puts).",
    setup: (spot) => [
      { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 0.90, quantity: 1, price: 9.0 },
      { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 0.95, quantity: 1, price: 6.0 },
      { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.05, quantity: 1, price: 2.0 },
      { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 1.10, quantity: 1, price: 0.5 }
    ]
  },

  // --- 5. HEDGE / EXOTIC [39-45] ---
  {
    name: "39. Jade Lizard",
    category: "Hedge",
    description: "Venda de Put OTM + Bear Call Spread. Busca crédito alto sem risco na alta.",
    setup: (spot) => [
      { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.90, quantity: 1, price: 4.0 },
      { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.05, quantity: 1, price: 2.5 },
      { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 1.10, quantity: 1, price: 1.0 }
    ]
  },
  {
    name: "40. Twisted Sister (Call Lizard)",
    category: "Hedge",
    description: "Inverso do Jade Lizard: Venda de Call OTM + Bull Put Spread.",
    setup: (spot) => [
      { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.10, quantity: 1, price: 2.0 },
      { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.95, quantity: 1, price: 3.0 },
      { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 0.90, quantity: 1, price: 1.0 }
    ]
  },
  {
    name: "41. Seagull",
    category: "Hedge",
    description: "Bull Spread financiado por venda de Put (ou vice-versa).",
    setup: (spot) => [
      { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 1.00, quantity: 1, price: 5.0 },
      { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.05, quantity: 1, price: 2.0 },
      { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.90, quantity: 1, price: 3.0 }
    ]
  },
  {
    name: "42. Box Spread",
    category: "Hedge",
    description: "Arbitragem: Bull Call Spread + Bear Put Spread. Payoff plano (Bond sintético).",
    setup: (spot) => [
      { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 0.95, quantity: 1, price: 6.0 },
      { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.05, quantity: 1, price: 2.0 },
      { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 1.05, quantity: 1, price: 6.0 },
      { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.95, quantity: 1, price: 2.0 }
    ]
  },
  {
    name: "43. Fence",
    category: "Hedge",
    description: "Estrutura de range (cerca): Vende Put OTM, Compra Call ATM, Vende Call OTM.",
    setup: (spot) => [
      { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.90, quantity: 1, price: 3.0 },
      { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot, quantity: 1, price: 5.0 },
      { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.10, quantity: 1, price: 1.0 }
    ]
  },
  {
    name: "44. Ratio Call Write",
    category: "Hedge",
    description: "Compra Sintética de Ação + Venda de 2 Calls OTM (Covered Call alavancada).",
    setup: (spot) => [
      // Synthetic Stock
      { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot, quantity: 1, price: 4.0 },
      { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot, quantity: 1, price: 4.0 },
      // Write 2 Calls
      { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.05, quantity: 2, price: 2.0 }
    ]
  },
  {
    name: "45. Synthetic Collar",
    category: "Hedge",
    description: "Collar usando Ativo Sintético (Long Call ATM + Short Put ATM) + Long Put + Short Call.",
    setup: (spot) => [
      // Synthetic Stock
      { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot, quantity: 1, price: 4.0 },
      { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot, quantity: 1, price: 4.0 },
      // Collar legs
      { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 0.90, quantity: 1, price: 1.5 },
      { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.10, quantity: 1, price: 1.0 }
    ]
  }
];

// Helper para tradução das categorias
const CategoryTranslation: Record<string, string> = {
  'Bullish': 'Alta (Bull)',
  'Bearish': 'Baixa (Bear)',
  'Volatility': 'Volatilidade (Vega+)',
  'Income': 'Renda (Theta+)',
  'Hedge': 'Proteção/Exótica'
};


/**
 * COMPONENTES UI
 */

const Card = ({ children, className = "" }: { children: React.ReactNode, className?: string }) => (
  <div className={`bg-[#9CB0CE]/20 backdrop-blur-md border border-[#E5F9FF]/10 shadow-lg rounded-xl overflow-hidden ${className}`}>
    {children}
  </div>
);

const Input = ({ label, value, onChange, type = "number", step = "0.01" }: any) => (
  <div className="flex flex-col gap-1">
    <label className="text-xs text-blue-200/70 font-medium uppercase tracking-wider">{label}</label>
    <input 
      type={type} 
      step={step}
      value={value} 
      onChange={onChange}
      className="bg-black/30 border border-white/10 rounded-md px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-400 transition-colors"
    />
  </div>
);

const Select = ({ label, value, onChange, options }: any) => (
  <div className="flex flex-col gap-1">
    <label className="text-xs text-blue-200/70 font-medium uppercase tracking-wider">{label}</label>
    <select 
      value={value} 
      onChange={onChange}
      className="bg-black/30 border border-white/10 rounded-md px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-400 transition-colors appearance-none cursor-pointer"
    >
      {options.map((opt: any) => (
        <option key={opt.value} value={opt.value} className="bg-slate-900 text-white">
          {opt.label}
        </option>
      ))}
    </select>
  </div>
);

/**
 * MAIN APP
 */
export default function OptionsStrategyBuilder() {
  // --- STATE ---
  const [spotPrice, setSpotPrice] = useState<number>(100);
  const [strategyName, setStrategyName] = useState<string>("Estratégia Personalizada");
  const [legs, setLegs] = useState<Leg[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [savedSimulations, setSavedSimulations] = useState<any[]>([]);

  // Initialize with a simple strategy
  useEffect(() => {
    const defaultStrat = STRATEGIES.find(s => s.name.includes("Long Call"));
    if(defaultStrat) setLegs(defaultStrat.setup(100));
  }, []);

  // --- ACTIONS ---
  
  const handleStrategyChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selected = STRATEGIES.find(s => s.name === e.target.value);
    if (selected) {
      setStrategyName(selected.name);
      setLegs(selected.setup(spotPrice));
    } else {
      setStrategyName("Estratégia Personalizada");
    }
  };

  const updateLeg = (id: string, field: keyof Leg, value: any) => {
    setLegs(prev => prev.map(leg => 
      leg.id === id ? { ...leg, [field]: value } : leg
    ));
  };

  const addLeg = () => {
    setLegs([...legs, { 
      id: generateUUID(), 
      type: 'Call', 
      action: 'Buy', 
      strike: spotPrice, 
      quantity: 1, 
      price: 1.0 
    }]);
  };

  const removeLeg = (id: string) => {
    setLegs(legs.filter(l => l.id !== id));
  };

  // --- GOOGLE SHEETS INTEGRATION ---

  const saveToSheets = async () => {
    setIsSaving(true);
    const payload = {
      strategyName,
      spotPrice,
      legsData: legs,
      metrics: calculatedMetrics
    };

    try {
      // Usando no-cors para evitar bloqueio, embora a resposta seja opaca.
      // Em produção real, usariamos JSONP ou proxy, mas para GAS simples, isso funciona para disparar o POST.
      await fetch(GAS_URL, {
        method: 'POST',
        mode: 'no-cors', 
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      alert("Simulação salva no Google Sheets com sucesso!");
    } catch (error) {
      console.error(error);
      alert("Erro ao salvar. Verifique o console.");
    } finally {
      setIsSaving(false);
    }
  };

  const loadFromSheets = async () => {
    try {
      const response = await fetch(GAS_URL);
      const data = await response.json();
      setSavedSimulations(data);
      setShowLoadModal(true);
    } catch (error) {
      alert("Erro ao carregar histórico. Verifique se o WebApp GAS está publicado como 'Anyone'.");
    }
  };

  const loadSimulation = (sim: any) => {
    setStrategyName(sim.name);
    setSpotPrice(parseFloat(sim.spot));
    setLegs(sim.legs);
    setShowLoadModal(false);
  };

  // --- CALCULATIONS ---

  const payoffData = useMemo(() => {
    // Generate range: +/- 20% of spot
    const range: number[] = [];
    const lower = spotPrice * 0.7;
    const upper = spotPrice * 1.3;
    const step = (upper - lower) / 100;
    
    for (let p = lower; p <= upper; p += step) {
      range.push(p);
    }
    return calculatePayoff(legs, range);
  }, [spotPrice, legs]);

  const calculatedMetrics = useMemo(() => calculateMetrics(legs, payoffData), [legs, payoffData]);

  // --- RENDER HELPERS ---

  const formatCurrency = (val: number | string) => {
    if (typeof val === 'string') return val;
    return `$${val.toFixed(2)}`;
  };

  const getPnlColor = (val: number) => val >= 0 ? '#10B981' : '#EF4444';

  return (
    <div className="min-h-screen font-sans text-slate-100 bg-[linear-gradient(85.3deg,#111C2C_2.23%,#395D92_232.74%)] p-4 md:p-8 overflow-x-hidden selection:bg-blue-500/30">
      
      {/* HEADER */}
      <header className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-200 to-white flex items-center gap-3">
            <Activity className="text-blue-400" />
            Arquiteto de Opções
          </h1>
          <p className="text-blue-200/60 text-sm mt-1">Simulador e Analisador Avançado de Estratégias</p>
        </div>
        
        <div className="flex gap-3">
          <button 
            onClick={loadFromSheets}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 transition-all text-sm font-medium"
          >
            <Download size={16} /> Carregar Histórico
          </button>
          <button 
            onClick={saveToSheets}
            disabled={isSaving}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 shadow-lg shadow-blue-500/20 transition-all text-sm font-bold text-white"
          >
            {isSaving ? <span className="animate-spin">⌛</span> : <Save size={16} />} 
            Salvar Estratégia
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* LEFT COLUMN: CONTROLS & CHART */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          
          {/* TOP CONTROLS */}
          <Card className="p-5">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-1">
                <Input 
                  label="Preço do Ativo (Spot)" 
                  value={spotPrice} 
                  onChange={(e: any) => setSpotPrice(parseFloat(e.target.value))} 
                />
              </div>
              <div className="md:col-span-2">
                <Select 
                  label="Modelo de Estratégia"
                  value={strategyName}
                  onChange={handleStrategyChange}
                  options={[
                    { value: "Estratégia Personalizada", label: "Estratégia Personalizada" },
                    ...STRATEGIES.map(s => ({ value: s.name, label: `${CategoryTranslation[s.category]}: ${s.name}` }))
                  ]}
                />
              </div>
            </div>
          </Card>

          {/* PAYOFF CHART */}
          <Card className="p-1 h-[400px] relative group">
            <div className="absolute top-4 left-4 z-10 bg-black/40 backdrop-blur px-3 py-1 rounded text-xs border border-white/10">
              Diagrama de Payoff no Vencimento
            </div>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={payoffData} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10B981" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#10B981" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorLoss" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#EF4444" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#EF4444" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                <XAxis 
                  dataKey="price" 
                  stroke="#94a3b8" 
                  tickFormatter={(val) => val.toFixed(0)} 
                  tick={{fontSize: 12}}
                />
                <YAxis 
                  stroke="#94a3b8" 
                  tickFormatter={(val) => `$${val}`}
                  tick={{fontSize: 12}} 
                />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', color: '#fff' }}
                  itemStyle={{ color: '#fff' }}
                  formatter={(value: number) => [`$${value.toFixed(2)}`, 'Resultado']}
                  labelFormatter={(label) => `Spot: $${parseFloat(label).toFixed(2)}`}
                />
                <ReferenceLine y={0} stroke="#64748b" strokeDasharray="3 3" />
                <ReferenceLine x={spotPrice} stroke="#fbbf24" strokeDasharray="3 3" label={{ position: 'top', value: 'Spot', fill: '#fbbf24', fontSize: 10 }} />
                
                {/* Trick to color areas differently based on value */}
                <Area 
                  type="monotone" 
                  dataKey="value" 
                  stroke="#519CFF" 
                  strokeWidth={2}
                  fill="url(#colorProfit)" 
                />
              </AreaChart>
            </ResponsiveContainer>
          </Card>

          {/* LEGS EDITOR */}
          <Card className="p-0 overflow-hidden">
            <div className="p-4 border-b border-white/5 flex justify-between items-center bg-white/5">
              <h3 className="text-sm font-semibold text-blue-200 uppercase tracking-wide flex items-center gap-2">
                <LayoutGrid size={16} /> Pernas da Estratégia
              </h3>
              <button onClick={addLeg} className="text-xs bg-blue-500/20 hover:bg-blue-500/40 text-blue-300 px-2 py-1 rounded border border-blue-500/30 transition-colors flex items-center gap-1">
                <Plus size={14} /> Adicionar Perna
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-blue-200/50 uppercase bg-black/20">
                  <tr>
                    <th className="px-4 py-3">Ação</th>
                    <th className="px-4 py-3">Tipo</th>
                    <th className="px-4 py-3">Strike ($)</th>
                    <th className="px-4 py-3">Qtd</th>
                    <th className="px-4 py-3">Prêmio ($)</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {legs.map((leg) => (
                    <tr key={leg.id} className="hover:bg-white/5 transition-colors">
                      <td className="px-4 py-2">
                         <select 
                            value={leg.action}
                            onChange={(e) => updateLeg(leg.id, 'action', e.target.value)}
                            className={`bg-transparent font-bold cursor-pointer outline-none ${leg.action === 'Buy' ? 'text-green-400' : 'text-red-400'}`}
                         >
                           <option value="Buy" className="bg-slate-800 text-green-400">Compra (Titular)</option>
                           <option value="Sell" className="bg-slate-800 text-red-400">Venda (Lançador)</option>
                         </select>
                      </td>
                      <td className="px-4 py-2">
                        <select 
                            value={leg.type}
                            onChange={(e) => updateLeg(leg.id, 'type', e.target.value)}
                            className="bg-transparent text-white cursor-pointer outline-none"
                         >
                           <option value="Call" className="bg-slate-800">Call</option>
                           <option value="Put" className="bg-slate-800">Put</option>
                         </select>
                      </td>
                      <td className="px-4 py-2">
                        <input 
                          type="number" 
                          value={leg.strike}
                          onChange={(e) => updateLeg(leg.id, 'strike', parseFloat(e.target.value))}
                          className="bg-black/20 w-24 px-2 py-1 rounded text-white border border-transparent focus:border-blue-500/50 outline-none"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input 
                          type="number" 
                          value={leg.quantity}
                          onChange={(e) => updateLeg(leg.id, 'quantity', parseFloat(e.target.value))}
                          className="bg-black/20 w-16 px-2 py-1 rounded text-white border border-transparent focus:border-blue-500/50 outline-none"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input 
                          type="number" 
                          step="0.01"
                          value={leg.price}
                          onChange={(e) => updateLeg(leg.id, 'price', parseFloat(e.target.value))}
                          className="bg-black/20 w-20 px-2 py-1 rounded text-white border border-transparent focus:border-blue-500/50 outline-none"
                        />
                      </td>
                      <td className="px-4 py-2 text-right">
                        <button onClick={() => removeLeg(leg.id)} className="text-white/20 hover:text-red-400 transition-colors">
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {legs.length === 0 && (
              <div className="p-8 text-center text-white/30 italic">Nenhuma perna definida. Adicione uma perna ou selecione uma estratégia.</div>
            )}
          </Card>
        </div>

        {/* RIGHT COLUMN: METRICS */}
        <div className="flex flex-col gap-6">
          
          <Card className="p-6 bg-gradient-to-br from-[#9CB0CE]/20 to-[#395D92]/30">
            <h3 className="text-xs font-bold text-blue-200 uppercase tracking-widest mb-6 border-b border-white/10 pb-2">Análise da Estrutura</h3>
            
            <div className="space-y-6">
              {/* Cost/Credit */}
              <div className="flex justify-between items-end">
                <div>
                  <div className="text-white/50 text-xs mb-1">Custo de Entrada</div>
                  <div className={`text-2xl font-bold flex items-center gap-2 ${calculatedMetrics.cost > 0 ? 'text-red-300' : 'text-green-300'}`}>
                    {calculatedMetrics.cost > 0 ? <TrendingDown size={20} /> : <TrendingUp size={20} />}
                    {formatCurrency(Math.abs(calculatedMetrics.cost))}
                  </div>
                  <div className="text-xs mt-1 text-white/40">
                    {calculatedMetrics.cost > 0 ? "Débito Líquido (Você Paga)" : "Crédito Líquido (Você Recebe)"}
                  </div>
                </div>
                <div className="p-3 rounded-full bg-white/5">
                  <DollarSign className="text-white/60" size={24} />
                </div>
              </div>

              <div className="h-px bg-white/10 w-full" />

              {/* Max Profit */}
              <div className="flex flex-col gap-1">
                <span className="text-xs text-white/50 uppercase">Lucro Máximo</span>
                <span className="text-xl font-medium text-green-400">
                  {typeof calculatedMetrics.maxProfit === 'number' ? formatCurrency(calculatedMetrics.maxProfit) : 'Ilimitado'}
                </span>
              </div>

              {/* Max Loss */}
              <div className="flex flex-col gap-1">
                <span className="text-xs text-white/50 uppercase">Risco Máximo</span>
                <span className="text-xl font-medium text-red-400">
                   {typeof calculatedMetrics.maxLoss === 'number' ? formatCurrency(Math.abs(calculatedMetrics.maxLoss)) : 'Ilimitado'}
                </span>
              </div>

              {/* Breakeven */}
              <div className="flex flex-col gap-1">
                <span className="text-xs text-white/50 uppercase">Pontos de Breakeven (0x0)</span>
                <div className="flex gap-2 flex-wrap">
                  {calculatedMetrics.breakevens.length > 0 ? (
                    calculatedMetrics.breakevens.map((be, i) => (
                      <span key={i} className="px-2 py-1 rounded bg-white/10 text-white font-mono text-sm border border-white/10">
                        ${be}
                      </span>
                    ))
                  ) : (
                    <span className="text-sm text-white/30 italic">Nenhum no intervalo</span>
                  )}
                </div>
              </div>

            </div>
          </Card>

          {/* Educational Note */}
          <Card className="p-5">
             <div className="flex items-start gap-3">
               <Zap className="text-yellow-400 shrink-0 mt-1" size={18} />
               <div>
                 <h4 className="text-sm font-bold text-white mb-1">Insight da Estratégia</h4>
                 <p className="text-xs text-white/60 leading-relaxed">
                   {STRATEGIES.find(s => s.name === strategyName)?.description || "Configuração personalizada manual."}
                 </p>
               </div>
             </div>
          </Card>

          <Card className="p-5 flex-1 flex flex-col justify-end min-h-[150px] relative overflow-hidden">
             <Shield className="absolute -right-4 -bottom-4 text-white/5 w-32 h-32 rotate-12" />
             <div className="relative z-10">
               <h4 className="text-sm font-bold text-white mb-2">Controle de Risco</h4>
               <div className="flex items-center gap-2 text-xs text-white/70">
                 {typeof calculatedMetrics.maxLoss === 'number' && Math.abs(calculatedMetrics.maxLoss) > 5000 ? (
                   <span className="text-red-300 flex items-center gap-1">Alerta: Risco Elevado Detectado</span>
                 ) : (
                   <span className="text-green-300 flex items-center gap-1"><Check size={12}/> Dentro dos limites padrão</span>
                 )}
               </div>
             </div>
          </Card>

        </div>
      </div>

      {/* LOAD MODAL */}
      {showLoadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <Card className="w-full max-w-2xl max-h-[80vh] flex flex-col bg-[#111C2C]">
            <div className="p-6 border-b border-white/10 flex justify-between items-center">
              <h2 className="text-xl font-bold text-white">Simulações Salvas (Google Sheets)</h2>
              <button onClick={() => setShowLoadModal(false)} className="text-white/50 hover:text-white"><Plus className="rotate-45" /></button>
            </div>
            <div className="overflow-y-auto p-6 space-y-3">
              {savedSimulations.length === 0 ? (
                <div className="text-center text-white/40 py-8">Carregando ou nenhum histórico encontrado...</div>
              ) : (
                savedSimulations.map((sim, idx) => (
                  <div key={idx} onClick={() => loadSimulation(sim)} className="group flex justify-between items-center p-4 bg-white/5 hover:bg-white/10 rounded-lg cursor-pointer border border-transparent hover:border-blue-500/30 transition-all">
                    <div>
                      <h3 className="font-bold text-blue-200 group-hover:text-white transition-colors">{sim.name}</h3>
                      <div className="text-xs text-white/50 mt-1 flex gap-3">
                        <span>{new Date(sim.timestamp).toLocaleDateString('pt-BR')}</span>
                        <span>Spot: ${parseFloat(sim.spot).toFixed(2)}</span>
                        <span>Lucro: <span className="text-green-400">${parseFloat(sim.metrics.maxProfit).toFixed(0)}</span></span>
                      </div>
                    </div>
                    <ChevronDown className="-rotate-90 text-white/20 group-hover:text-white transition-colors" />
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      )}

    </div>
  );
}
