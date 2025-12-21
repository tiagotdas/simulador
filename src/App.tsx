import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine 
} from 'recharts';
import { 
  Plus, Trash2, Save, Download, TrendingUp, TrendingDown, 
  Activity, DollarSign, Shield, Zap, LayoutGrid, ChevronDown, Check, X, AlertCircle, Info, BookOpen, Lock, Unlock, AlertTriangle, Edit2, RefreshCw
} from 'lucide-react';

/**
 * CONFIGURAÇÃO E TYPES
 */

// URL do Google Apps Script (Backend)
const GAS_URL = "https://script.google.com/macros/s/AKfycbzqSFOMVRsyxcAQi8MOu0QXonTr96IgiT0d1qASaNi2_ShmaBJlWkIxfenML2GbmB0k/exec"; 

type OptionType = 'Call' | 'Put';
type ActionType = 'Buy' | 'Sell';

interface Leg {
  id: string;
  type: OptionType;
  action: ActionType;
  strike: number;
  quantity: number;
  price: number; 
  iv?: number;
}

// Interface enriquecida com detalhes técnicos para auditoria da operação
interface StrategyTemplate {
  name: string;
  category: 'Bullish' | 'Bearish' | 'Volatility' | 'Income' | 'Hedge';
  description: string; // Resumo curto
  details: {
    thesis: string;       // Visão de mercado
    mechanics: string;    // Explicação estrutural
    idealScenario: string;// Cenário ideal
    greeks: string;       // Perfil de risco
  };
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

// --- TOAST TYPES ---
interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
}

/**
 * ENGINE MATEMÁTICA
 */

const generateUUID = () => Math.random().toString(36).substr(2, 9);

const getOptionValueAtExpiry = (type: OptionType, strike: number, spot: number) => {
  if (type === 'Call') return Math.max(0, spot - strike);
  return Math.max(0, strike - spot);
};

const calculatePayoff = (legs: Leg[], spotRange: number[]) => {
  return spotRange.map(spot => {
    let totalPnl = 0;
    legs.forEach(leg => {
      const valueAtExpiry = getOptionValueAtExpiry(leg.type, leg.strike, spot);
      const cost = leg.quantity * leg.price;
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
  let cost = 0;
  legs.forEach(leg => {
    const legCost = leg.quantity * leg.price;
    if (leg.action === 'Buy') cost += legCost;
    else cost -= legCost;
  });

  const values = payoffData.map(p => p.value);
  const maxVal = Math.max(...values);
  const minVal = Math.min(...values);
  
  const breakevens: number[] = [];
  for (let i = 1; i < payoffData.length; i++) {
    const prev = payoffData[i-1];
    const curr = payoffData[i];
    if ((prev.value < 0 && curr.value >= 0) || (prev.value > 0 && curr.value <= 0)) {
      breakevens.push(parseFloat(curr.price.toFixed(2)));
    }
  }

  return {
    cost,
    maxProfit: maxVal > 100000 ? "Ilimitado" : maxVal,
    maxLoss: minVal < -100000 ? "Ilimitado" : minVal,
    breakevens
  };
};

/**
 * STRATEGY FACTORY (45 ESTRATÉGIAS - ENRIQUECIDAS)
 */
const STRATEGIES: StrategyTemplate[] = [
  // --- 1. BULLISH (ALTA) ---
  { name: "1. Long Call", category: "Bullish", description: "Compra de Call a seco.", details: { thesis: "Alta direcional forte.", mechanics: "Compra de direito de compra. Alavancagem simples.", idealScenario: "Explosão de preço no curto prazo.", greeks: "Delta+, Gamma+, Theta-, Vega+" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Buy', strike: spot, quantity: 1, price: 2.5 }] },
  { name: "2. Short Put (Naked Put)", category: "Bullish", description: "Venda de Put a seco.", details: { thesis: "Neutro a levemente altista.", mechanics: "Venda de obrigação de compra. Gera renda (prêmio).", idealScenario: "Preço acima do strike no vencimento.", greeks: "Delta+, Theta+, Vega-" }, setup: (spot) => [{ id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.95, quantity: 1, price: 2.0 }] },
  { name: "3. Bull Call Spread", category: "Bullish", description: "Trava de Alta com Calls.", details: { thesis: "Alta moderada com custo reduzido.", mechanics: "Compra Call ATM, Vende Call OTM para financiar.", idealScenario: "Preço sobe até o strike vendido.", greeks: "Delta+ (menor que Long Call), Theta misto" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Buy', strike: spot, quantity: 1, price: 5.0 }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.05, quantity: 1, price: 2.0 }] },
  { name: "4. Bull Put Spread", category: "Bullish", description: "Trava de Alta com Puts (Credit Spread).", details: { thesis: "Alta moderada ou lateralização (geração de renda).", mechanics: "Vende Put ATM/OTM (caro), Compra Put OTM (barato).", idealScenario: "Preço fica acima do strike vendido.", greeks: "Delta+, Theta+, Vega-" }, setup: (spot) => [{ id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.95, quantity: 1, price: 3.0 }, { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 0.90, quantity: 1, price: 1.0 }] },
  { name: "5. Call Ratio Spread (1x2)", category: "Bullish", description: "Compra 1 Call ATM e vende 2 Calls OTM.", details: { thesis: "Alta leve. Perde se explodir.", mechanics: "Compra 1 Call, financia vendendo 2 Calls OTM (crédito ou custo zero).", idealScenario: "Preço no vencimento exato no strike vendido.", greeks: "Delta variável, Theta+" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Buy', strike: spot, quantity: 1, price: 5.0 }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.05, quantity: 2, price: 2.0 }] },
  { name: "6. Risk Reversal (Collar)", category: "Bullish", description: "Collar Zero Cost.", details: { thesis: "Alta com proteção financiada.", mechanics: "Compra Call OTM, financia vendendo Put OTM.", idealScenario: "Alta forte (participa da alta sem custo inicial).", greeks: "Delta+, Vega misto" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 1.05, quantity: 1, price: 3.0 }, { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.95, quantity: 1, price: 3.0 }] },
  { name: "7. Call Backspread", category: "Bullish", description: "Vende 1 Call ATM, Compra 2 Calls OTM.", details: { thesis: "Alta explosiva ou queda forte (Volatilidade).", mechanics: "Inverso do Ratio Spread. Delta positivo forte no OTM.", idealScenario: "Movimento brusco de alta.", greeks: "Gamma+, Vega+" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Sell', strike: spot, quantity: 1, price: 5.0 }, { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 1.05, quantity: 2, price: 2.0 }] },
  { name: "8. Bull Call Ladder", category: "Bullish", description: "Variação do Ratio: Compra 1, Vende 1, Vende 1.", details: { thesis: "Alta moderada com redução de custo.", mechanics: "Estende o lucro do Bull Spread vendendo outra Call mais OTM.", idealScenario: "Preço sobe gradualmente, sem explodir.", greeks: "Theta+" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Buy', strike: spot, quantity: 1, price: 5.0 }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.05, quantity: 1, price: 2.0 }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.10, quantity: 1, price: 1.0 }] },
  { name: "9. Synthetic Long Stock", category: "Bullish", description: "Simula ação: Compra Call ATM, Vende Put ATM.", details: { thesis: "Réplica perfeita do ativo objeto.", mechanics: "Delta 1 sintético. Elimina necessidade de capital total da ação.", idealScenario: "Qualquer alta.", greeks: "Delta 1, Theta 0 (teórico)" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Buy', strike: spot, quantity: 1, price: 4.0 }, { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot, quantity: 1, price: 4.0 }] },

  // --- 2. BEARISH (BAIXA) ---
  { name: "10. Long Put", category: "Bearish", description: "Compra de Put a seco.", details: { thesis: "Queda direcional ou proteção (Hedge).", mechanics: "Direito de venda. Ganha com a queda.", idealScenario: "Queda brusca rápida (Gamma e Vega ajudam).", greeks: "Delta-, Gamma+, Vega+" }, setup: (spot) => [{ id: generateUUID(), type: 'Put', action: 'Buy', strike: spot, quantity: 1, price: 2.5 }] },
  { name: "11. Short Call (Naked Call)", category: "Bearish", description: "Venda de Call a seco.", details: { thesis: "Neutro a baixista. Risco ilimitado.", mechanics: "Vende direito de compra. Ganha prêmio.", idealScenario: "Preço não sobe acima do strike.", greeks: "Delta-, Theta+, Vega-" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.05, quantity: 1, price: 2.0 }] },
  { name: "12. Bear Put Spread", category: "Bearish", description: "Trava de Baixa com Puts.", details: { thesis: "Queda moderada com custo definido.", mechanics: "Compra Put ATM, Vende Put OTM para baratear.", idealScenario: "Preço cai até o strike vendido.", greeks: "Delta-, Theta misto" }, setup: (spot) => [{ id: generateUUID(), type: 'Put', action: 'Buy', strike: spot, quantity: 1, price: 5.0 }, { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.95, quantity: 1, price: 2.0 }] },
  { name: "13. Bear Call Spread", category: "Bearish", description: "Trava de Baixa com Calls (Credit Spread).", details: { thesis: "Baixa moderada ou lateralização.", mechanics: "Vende Call ATM/OTM, Compra Call OTM superior (tampa risco).", idealScenario: "Preço fica abaixo do strike vendido.", greeks: "Delta-, Theta+, Vega-" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.05, quantity: 1, price: 3.0 }, { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 1.10, quantity: 1, price: 1.0 }] },
  { name: "14. Put Ratio Spread (1x2)", category: "Bearish", description: "Compra 1 Put ATM, Vende 2 Puts OTM.", details: { thesis: "Queda moderada. Risco se cair demais.", mechanics: "Financia compra da Put vendendo dobro de Puts OTM.", idealScenario: "Preço no vencimento no strike das vendidas.", greeks: "Delta variável, Theta+" }, setup: (spot) => [{ id: generateUUID(), type: 'Put', action: 'Buy', strike: spot, quantity: 1, price: 5.0 }, { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.90, quantity: 2, price: 1.5 }] },
  { name: "15. Put Backspread", category: "Bearish", description: "Vende 1 Put ATM, Compra 2 Puts OTM.", details: { thesis: "Hedge contra crash severo.", mechanics: "Vende Put cara, compra muitas Puts baratas. Ganha na explosão da vol.", idealScenario: "Queda catastrófica.", greeks: "Gamma+, Vega+" }, setup: (spot) => [{ id: generateUUID(), type: 'Put', action: 'Sell', strike: spot, quantity: 1, price: 5.0 }, { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 0.90, quantity: 2, price: 2.0 }] },
  { name: "16. Bear Put Ladder", category: "Bearish", description: "Escada de Baixa: Compra 1, Vende 1, Vende 1.", details: { thesis: "Queda controlada.", mechanics: "Bear Put Spread + Venda extra de Put mais OTM para financiar.", idealScenario: "Queda suave até o miolo da estrutura.", greeks: "Theta+" }, setup: (spot) => [{ id: generateUUID(), type: 'Put', action: 'Buy', strike: spot, quantity: 1, price: 5.0 }, { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.95, quantity: 1, price: 2.0 }, { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.90, quantity: 1, price: 1.0 }] },
  { name: "17. Synthetic Short Stock", category: "Bearish", description: "Simula venda a descoberto.", details: { thesis: "Aposta na queda linear.", mechanics: "Vende Call ATM, Compra Put ATM. Delta -1 sintético.", idealScenario: "Qualquer queda.", greeks: "Delta -1" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Sell', strike: spot, quantity: 1, price: 4.0 }, { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot, quantity: 1, price: 4.0 }] },
  { name: "18. Synthetic Put", category: "Bearish", description: "Put sintética usando Call e Ações (simuladas via Call ATM/Put ATM).", details: { thesis: "Replicação de Put.", mechanics: "Short Stock + Long Call. Cria perfil de payoff de Long Put.", idealScenario: "Queda forte.", greeks: "Delta-" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 1.05, quantity: 1, price: 2.0 }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot, quantity: 1, price: 4.0 }, { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot, quantity: 1, price: 4.0 }] },

  // --- 3. VOLATILITY (VEGA LONG) ---
  { name: "19. Long Straddle", category: "Volatility", description: "Compra Call e Put no mesmo strike.", details: { thesis: "Explosão de preço para qualquer lado.", mechanics: "Compra ATM Call e ATM Put. Custo alto.", idealScenario: "Movimento forte (Earnings, Payroll). Alta da Volatilidade.", greeks: "Gamma++, Vega++, Theta--" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Buy', strike: spot, quantity: 1, price: 4.0 }, { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot, quantity: 1, price: 4.0 }] },
  { name: "20. Long Strangle", category: "Volatility", description: "Compra Put OTM e Call OTM.", details: { thesis: "Explosão de preço (custo menor que Straddle).", mechanics: "Compra opções fora do dinheiro. Exige movimento maior para lucrar.", idealScenario: "Movimento muito forte.", greeks: "Vega+, Theta-" }, setup: (spot) => [{ id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 0.95, quantity: 1, price: 2.5 }, { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 1.05, quantity: 1, price: 2.5 }] },
  { name: "21. Strip", category: "Volatility", description: "Straddle Bearish: 2 Puts + 1 Call.", details: { thesis: "Volatilidade com viés de baixa.", mechanics: "Pesa a mão na Put. Lucra mais na queda, mas protege na alta.", idealScenario: "Queda forte com volatilidade.", greeks: "Gamma+, Delta levemente negativo" }, setup: (spot) => [{ id: generateUUID(), type: 'Put', action: 'Buy', strike: spot, quantity: 2, price: 4.0 }, { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot, quantity: 1, price: 4.0 }] },
  { name: "22. Strap", category: "Volatility", description: "Straddle Bullish: 2 Calls + 1 Put.", details: { thesis: "Volatilidade com viés de alta.", mechanics: "Pesa a mão na Call. Lucra mais na alta.", idealScenario: "Alta forte com volatilidade.", greeks: "Gamma+, Delta levemente positivo" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Buy', strike: spot, quantity: 2, price: 4.0 }, { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot, quantity: 1, price: 4.0 }] },
  { name: "23. Guts", category: "Volatility", description: "Compra Call ITM e Put ITM.", details: { thesis: "Volatilidade (Deep ITM).", mechanics: "Opções ITM têm menos valor extrínseco relativo, comportam-se mais como o ativo.", idealScenario: "Movimento amplo.", greeks: "Delta neutro inicial" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 0.95, quantity: 1, price: 6.0 }, { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 1.05, quantity: 1, price: 6.0 }] },
  { name: "24. Short Iron Condor (Reverse)", category: "Volatility", description: "Aposta na saída do intervalo.", details: { thesis: "O mercado vai sair da lateralização.", mechanics: "Vende as pontas (asas), compra o miolo. Débito.", idealScenario: "Preço rompe as barreiras do condor.", greeks: "Vega+, Theta-" }, setup: (spot) => [{ id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.90, quantity: 1, price: 1.0 }, { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 0.95, quantity: 1, price: 3.0 }, { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 1.05, quantity: 1, price: 3.0 }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.10, quantity: 1, price: 1.0 },] },
  { name: "25. Short Butterfly (Call)", category: "Volatility", description: "Vende miolo, compra pontas.", details: { thesis: "Explosão de preço (Volatilidade).", mechanics: "Inverso da borboleta. Paga para montar, lucra se sair do meio.", idealScenario: "Preço longe do strike central.", greeks: "Vega+, Theta-" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 0.95, quantity: 1, price: 6.0 }, { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot, quantity: 2, price: 3.5 }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.05, quantity: 1, price: 1.5 }] },
  { name: "26. Short Butterfly (Put)", category: "Volatility", description: "Versão com Puts.", details: { thesis: "Explosão de preço.", mechanics: "Mesma lógica da Call, estruturada com Puts.", idealScenario: "Longe do miolo.", greeks: "Vega+, Theta-" }, setup: (spot) => [{ id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.95, quantity: 1, price: 6.0 }, { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot, quantity: 2, price: 3.5 }, { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 1.05, quantity: 1, price: 1.5 }] },
  { name: "27. Double Ratio", category: "Volatility", description: "Complexa: Compra 1, Vende 2 em ambos os lados.", details: { thesis: "Estabilidade ampla, risco nas pontas extremas.", mechanics: "Combina Call Ratio e Put Ratio. Gera muito crédito.", idealScenario: "Preço fica entre os strikes vendidos.", greeks: "Theta++" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 1.02, quantity: 1, price: 3.0 }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.05, quantity: 2, price: 1.5 }, { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 0.98, quantity: 1, price: 3.0 }, { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.95, quantity: 2, price: 1.5 }] },

  // --- 4. INCOME / THETA (VEGA SHORT) ---
  { name: "28. Short Straddle", category: "Income", description: "Venda de Call e Put no mesmo strike.", details: { thesis: "Mercado parado. Alta coleta de Theta.", mechanics: "Venda de volatilidade pura ATM. Risco ilimitado.", idealScenario: "Preço estático no strike.", greeks: "Theta++, Vega-, Gamma-" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Sell', strike: spot, quantity: 1, price: 4.0 }, { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot, quantity: 1, price: 4.0 }] },
  { name: "29. Short Strangle", category: "Income", description: "Venda de Put OTM e Call OTM.", details: { thesis: "Mercado em range amplo.", mechanics: "Venda de volatilidade OTM. Maior probabilidade de lucro que Straddle.", idealScenario: "Preço entre os strikes vendidos.", greeks: "Theta+, Vega-" }, setup: (spot) => [{ id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.90, quantity: 1, price: 2.0 }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.10, quantity: 1, price: 2.0 }] },
  { name: "30. Iron Condor", category: "Income", description: "Strangle vendido com 'asas' compradas para travar o risco (Bull Put + Bear Call).", details: { thesis: "Lateralização com risco definido.", mechanics: "Bull Put Spread + Bear Call Spread. 'Asas' protegem contra cisne negro.", idealScenario: "Preço termina no 'corpo' do condor.", greeks: "Theta+, Vega-" }, setup: (spot) => [{ id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 0.90, quantity: 1, price: 1.0 }, { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.95, quantity: 1, price: 3.0 }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.05, quantity: 1, price: 3.0 }, { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 1.10, quantity: 1, price: 1.0 },] },
  { name: "31. Iron Butterfly", category: "Income", description: "Straddle travado.", details: { thesis: "Mercado parado com risco definido.", mechanics: "Vende ATM Call/Put, Compra OTM Call/Put para proteção.", idealScenario: "Pin no strike central.", greeks: "Theta+, Vega-" }, setup: (spot) => [{ id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 0.95, quantity: 1, price: 2.0 }, { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot, quantity: 1, price: 5.0 }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot, quantity: 1, price: 5.0 }, { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 1.05, quantity: 1, price: 2.0 },] },
  { name: "32. Butterfly (Call)", category: "Income", description: "Borboleta clássica.", details: { thesis: "Alvo preciso de preço.", mechanics: "Compra 1 ITM, Vende 2 ATM, Compra 1 OTM (simetria 1-2-1). Custo baixo.", idealScenario: "Preço no vencimento exato no miolo.", greeks: "Theta+, Vega-" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 0.95, quantity: 1, price: 6.0 }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot, quantity: 2, price: 3.5 }, { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 1.05, quantity: 1, price: 1.5 }] },
  { name: "33. Butterfly (Put)", category: "Income", description: "Borboleta usando Puts.", details: { thesis: "Alvo preciso de preço.", mechanics: "Estrutura 1-2-1 com Puts. Payoff idêntico à Call Butterfly.", idealScenario: "Preço no miolo.", greeks: "Theta+, Vega-" }, setup: (spot) => [{ id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 0.95, quantity: 1, price: 1.5 }, { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot, quantity: 2, price: 3.5 }, { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 1.05, quantity: 1, price: 6.0 }] },
  { name: "34. Broken Wing Butterfly (Call)", category: "Income", description: "Borboleta assimétrica (Crédito).", details: { thesis: "Viés de alta, mas quer renda se ficar parado.", mechanics: "Pula um strike na asa superior (1-2-1 vira 1-2-0.5). Gera crédito inicial.", idealScenario: "Preço estável ou leve alta.", greeks: "Theta+" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 0.95, quantity: 1, price: 6.0 }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot, quantity: 2, price: 3.5 }, { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 1.10, quantity: 1, price: 0.5 } ] },
  { name: "35. Broken Wing Butterfly (Put)", category: "Income", description: "Borboleta assimétrica com Puts.", details: { thesis: "Viés de baixa ou neutro.", mechanics: "Asa inferior mais distante. Risco se cair muito, mas lucro se subir (devido ao crédito).", idealScenario: "Estabilidade.", greeks: "Theta+" }, setup: (spot) => [{ id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 0.90, quantity: 1, price: 0.5 }, { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot, quantity: 2, price: 3.5 }, { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 1.05, quantity: 1, price: 6.0 }] },
  { name: "36. Christmas Tree (Call)", category: "Income", description: "Variação da Butterfly com strikes progressivos (1-1-1 ao invés de 1-2-1).", details: { thesis: "Alta lenta.", mechanics: "Compra 1 ATM, Vende 1 OTM, Vende 1 OTM+. Perfil mais suave que a Butterfly.", idealScenario: "Alta moderada.", greeks: "Theta+" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 0.95, quantity: 1, price: 6.0 }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot, quantity: 1, price: 3.5 }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.05, quantity: 1, price: 1.5 }] },
  { name: "37. Christmas Tree (Put)", category: "Income", description: "Variação da Butterfly com Puts e strikes progressivos.", details: { thesis: "Queda lenta.", mechanics: "Compra 1 Put ATM, Vende sequencialmente Puts OTM.", idealScenario: "Queda moderada.", greeks: "Theta+" }, setup: (spot) => [{ id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.95, quantity: 1, price: 1.5 }, { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot, quantity: 1, price: 3.5 }, { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 1.05, quantity: 1, price: 6.0 }] },
  { name: "38. Condor", category: "Income", description: "Iron Condor feito só com Calls (ou Puts).", details: { thesis: "Lateralização.", mechanics: "Estrutura de 4 pernas usando apenas um tipo de opção. Arbitragem de skew.", idealScenario: "Mercado lateral.", greeks: "Theta+" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 0.90, quantity: 1, price: 9.0 }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 0.95, quantity: 1, price: 6.0 }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.05, quantity: 1, price: 2.0 }, { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 1.10, quantity: 1, price: 0.5 }] },

  // --- 5. HEDGE / EXOTIC ---
  { name: "39. Jade Lizard", category: "Hedge", description: "Venda de Put OTM + Bear Call Spread.", details: { thesis: "Neutro a Altista. Busca volatilidade.", mechanics: "Coleta prêmio gordo na Put e protege a alta com o spread. Sem risco na alta.", idealScenario: "Lateral ou Alta.", greeks: "Theta+, Vega-" }, setup: (spot) => [{ id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.90, quantity: 1, price: 4.0 }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.05, quantity: 1, price: 2.5 }, { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 1.10, quantity: 1, price: 1.0 }] },
  { name: "40. Twisted Sister (Call Lizard)", category: "Hedge", description: "Inverso do Jade Lizard: Venda de Call OTM + Bull Put Spread.", details: { thesis: "Neutro a Baixista.", mechanics: "Venda de Call OTM + Bull Put Spread. Sem risco na queda.", idealScenario: "Lateral ou Queda.", greeks: "Theta+, Vega-" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.10, quantity: 1, price: 2.0 }, { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.95, quantity: 1, price: 3.0 }, { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 0.90, quantity: 1, price: 1.0 }] },
  { name: "41. Seagull", category: "Hedge", description: "Bull Spread financiado por venda de Put (ou vice-versa).", details: { thesis: "Alta (Hedge cambial/commodities).", mechanics: "Compra Call Spread, financia vendendo Put. Custo zero comum.", idealScenario: "Alta forte.", greeks: "Delta+" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 1.00, quantity: 1, price: 5.0 }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.05, quantity: 1, price: 2.0 }, { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.90, quantity: 1, price: 3.0 }] },
  { name: "42. Box Spread", category: "Hedge", description: "Arbitragem: Bull Call Spread + Bear Put Spread. Payoff plano (Bond sintético).", details: { thesis: "Empréstimo/Aplicação a taxa livre de risco.", mechanics: "Bull Call Spread + Bear Put Spread nos mesmos strikes. Payoff flat.", idealScenario: "Arbitragem de taxas de juros.", greeks: "Neutro" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 0.95, quantity: 1, price: 6.0 }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.05, quantity: 1, price: 2.0 }, { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 1.05, quantity: 1, price: 6.0 }, { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.95, quantity: 1, price: 2.0 }] },
  { name: "43. Fence", category: "Hedge", description: "Estrutura de range (cerca): Vende Put OTM, Compra Call ATM, Vende Call OTM.", details: { thesis: "Proteção de carteira com custo reduzido.", mechanics: "Collar (Long Put + Short Call) financiado por Short Put OTM. Limita perda e ganho.", idealScenario: "Queda suave ou estabilidade.", greeks: "Delta negativo suave" }, setup: (spot) => [{ id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.90, quantity: 1, price: 3.0 }, { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot, quantity: 1, price: 5.0 }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.10, quantity: 1, price: 1.0 }] },
  { name: "44. Ratio Call Write", category: "Hedge", description: "Compra Sintética de Ação + Venda de 2 Calls OTM (Covered Call alavancada).", details: { thesis: "Neutro a levemente altista. Coleta de prêmio.", mechanics: "Long Stock + Venda de 2 Calls OTM. Risco se subir muito.", idealScenario: "Alta moderada até o strike.", greeks: "Theta++, Delta variável" }, setup: (spot) => [
      { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot, quantity: 1, price: 4.0 },
      { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot, quantity: 1, price: 4.0 },
      { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.05, quantity: 2, price: 2.0 }
    ] 
  },
  { name: "45. Synthetic Collar", category: "Hedge", description: "Collar em ativo sintético.", details: { thesis: "Proteção total em posição alavancada.", mechanics: "Cria a ação sinteticamente e aplica o Collar. Eficiência de capital.", idealScenario: "Alta moderada.", greeks: "Delta limitado" }, setup: (spot) => [
      { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot, quantity: 1, price: 4.0 },
      { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot, quantity: 1, price: 4.0 },
      { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 0.90, quantity: 1, price: 1.5 },
      { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.10, quantity: 1, price: 1.0 }
    ] 
  }
];

const CategoryTranslation: Record<string, string> = {
  'Bullish': 'Alta (Bull)', 'Bearish': 'Baixa (Bear)', 'Volatility': 'Volatilidade', 'Income': 'Renda', 'Hedge': 'Hedge'
};

/**
 * COMPONENTES UI (Helpers)
 */

const Card = ({ children, className = "" }: { children: React.ReactNode, className?: string }) => (
  <div className={`bg-[#9CB0CE]/20 backdrop-blur-md border border-[#E5F9FF]/10 shadow-lg rounded-xl overflow-hidden ${className}`}>
    {children}
  </div>
);

const Input = ({ label, value, onChange, type = "number", step = "0.01", min, max, className }: any) => (
  <div className={`flex flex-col gap-1 ${className}`}>
    {label && <label className="text-xs text-blue-200/70 font-medium uppercase tracking-wider">{label}</label>}
    <input 
      type={type} 
      step={step}
      min={min}
      max={max}
      value={value} 
      onChange={onChange}
      className="bg-black/30 border border-white/10 rounded-md px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-400 transition-colors w-full"
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
        <option key={opt.value} value={opt.value} className="bg-slate-900 text-white">{opt.label}</option>
      ))}
    </select>
  </div>
);

// --- TOAST COMPONENT ---
const ToastContainer = ({ toasts, removeToast }: { toasts: Toast[], removeToast: (id: number) => void }) => {
  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 w-full max-w-sm pointer-events-none">
      {toasts.map(toast => (
        <div 
          key={toast.id} 
          className={`
            pointer-events-auto transform transition-all duration-300 ease-in-out
            flex items-center gap-3 p-4 rounded-lg shadow-2xl border backdrop-blur-md
            ${toast.type === 'success' ? 'bg-emerald-900/80 border-emerald-500/30 text-emerald-100' : ''}
            ${toast.type === 'error' ? 'bg-red-900/80 border-red-500/30 text-red-100' : ''}
            ${toast.type === 'info' ? 'bg-blue-900/80 border-blue-500/30 text-blue-100' : ''}
          `}
        >
          {toast.type === 'success' && <Check size={20} className="text-emerald-400" />}
          {toast.type === 'error' && <AlertCircle size={20} className="text-red-400" />}
          {toast.type === 'info' && <Info size={20} className="text-blue-400" />}
          
          <p className="text-sm font-medium flex-1">{toast.message}</p>
          
          <button onClick={() => removeToast(toast.id)} className="text-white/40 hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
};

// --- DIALOG COMPONENT (SIMPLE) ---
const SaveDialog = ({ onClose, onSaveNew, onUpdate, strategyName }: any) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
    <Card className="w-full max-w-md bg-[#111C2C] p-6 flex flex-col gap-4">
      <h3 className="text-lg font-bold text-white">Salvar Estratégia</h3>
      <p className="text-sm text-white/70">
        Você está editando "{strategyName}". Deseja atualizar a versão existente ou criar uma nova?
      </p>
      <div className="flex flex-col gap-2 mt-2">
        <button 
          onClick={onUpdate}
          className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold transition-all"
        >
          <RefreshCw size={18} /> Atualizar Existente
        </button>
        <button 
          onClick={onSaveNew}
          className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition-all"
        >
          <Save size={18} /> Salvar como Nova
        </button>
        <button 
          onClick={onClose}
          className="mt-2 text-sm text-white/40 hover:text-white"
        >
          Cancelar
        </button>
      </div>
    </Card>
  </div>
);

/**
 * MAIN APP
 */
export default function OptionsStrategyBuilder() {
  const [spotPrice, setSpotPrice] = useState<number>(100);
  const [simulatedSpot, setSimulatedSpot] = useState<number>(100); 
  const [strategyName, setStrategyName] = useState<string>("Estratégia Personalizada");
  const [legs, setLegs] = useState<Leg[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [savedSimulations, setSavedSimulations] = useState<any[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null); // EDIT STATE
  const [showSaveDialog, setShowSaveDialog] = useState(false); // SAVE DIALOG
  
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Toast Helper
  const addToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000); 
  };

  const removeToast = (id: number) => setToasts(prev => prev.filter(t => t.id !== id));

  useEffect(() => {
    const defaultStrat = STRATEGIES.find(s => s.name.includes("Long Call"));
    if(defaultStrat) {
      setLegs(defaultStrat.setup(100));
      setSimulatedSpot(100);
    }
  }, []);

  useEffect(() => { setSimulatedSpot(spotPrice); }, [spotPrice]);

  const handleStrategyChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selected = STRATEGIES.find(s => s.name === e.target.value);
    if (selected) {
      setStrategyName(selected.name);
      setLegs(selected.setup(spotPrice));
      setEditingId(null); // Reset edit when template changes
      addToast(`Estratégia ${selected.name} carregada`, 'info');
    } else {
      setStrategyName("Estratégia Personalizada");
    }
  };

  const updateLeg = (id: string, field: keyof Leg, value: any) => {
    setLegs(prev => prev.map(leg => leg.id === id ? { ...leg, [field]: value } : leg));
  };

  const addLeg = () => {
    setLegs([...legs, { id: generateUUID(), type: 'Call', action: 'Buy', strike: spotPrice, quantity: 1, price: 1.0 }]);
  };

  const removeLeg = (id: string) => setLegs(legs.filter(l => l.id !== id));

  // --- GAS ACTIONS ---

  const handleSaveClick = () => {
    if (editingId) {
      setShowSaveDialog(true);
    } else {
      saveToSheets('create');
    }
  };

  const saveToSheets = async (action: 'create' | 'update') => {
    setShowSaveDialog(false);
    setIsSaving(true);
    
    const idToSend = action === 'update' ? editingId : null; 

    const payload = { 
      action,
      id: idToSend,
      strategyName, 
      spotPrice, 
      legsData: legs, 
      metrics: calculatedMetrics 
    };

    try {
      await fetch(GAS_URL, {
        method: 'POST',
        mode: 'no-cors', 
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      const msg = action === 'update' ? "Estratégia atualizada com sucesso!" : "Nova estratégia salva com sucesso!";
      addToast(msg, 'success');
      
      if (action === 'create') setEditingId(null);

    } catch (error) {
      console.error(error);
      addToast("Erro de conexão ao salvar.", 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const deleteSimulation = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Tem certeza que deseja excluir esta estratégia?")) return;

    try {
      await fetch(GAS_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', id })
      });
      
      // Optimistic Update
      setSavedSimulations(prev => prev.filter(s => s.id !== id));
      addToast("Estratégia excluída.", 'success');
    } catch (error) {
      addToast("Erro ao excluir.", 'error');
    }
  };

  const loadFromSheets = async () => {
    try {
      const auditUrl = `${GAS_URL}?no_cache=${new Date().getTime()}`;
      const response = await fetch(auditUrl);
      if (!response.ok) throw new Error(`Erro HTTP: ${response.status}`);
      const text = await response.text();
      let data;
      try { data = JSON.parse(text); } catch (e) { throw new Error("Dados inválidos recebidos."); }
      if (!Array.isArray(data)) throw new Error("Formato inválido.");

      setSavedSimulations(data);
      setShowLoadModal(true);
      addToast("Histórico carregado", 'success');
    } catch (error: any) {
      addToast(`Erro ao carregar: ${error.message}`, 'error');
    }
  };

  const loadSimulation = (sim: any) => {
    setStrategyName(sim.name);
    setSpotPrice(parseFloat(sim.spot));
    setSimulatedSpot(parseFloat(sim.spot));
    setLegs(sim.legs);
    setEditingId(sim.id);
    setShowLoadModal(false);
    addToast(`Editando: ${sim.name}`, 'info');
  };

  // --- CALCS ---
  const chartRange = useMemo(() => {
    const range: number[] = [];
    const lower = spotPrice * 0.7;
    const upper = spotPrice * 1.3;
    const step = (upper - lower) / 100;
    for (let p = lower; p <= upper; p += step) range.push(p);
    return range;
  }, [spotPrice]);

  const payoffData = useMemo(() => calculatePayoff(legs, chartRange), [legs, chartRange]);
  const calculatedMetrics = useMemo(() => calculateMetrics(legs, payoffData), [legs, payoffData]);
  const simulatedMetric = useMemo(() => calculatePayoff(legs, [simulatedSpot])[0].value, [legs, simulatedSpot]);
  const currentStrategyInfo = useMemo(() => STRATEGIES.find(s => s.name === strategyName), [strategyName]);

  const riskAnalysis = useMemo(() => {
    const hasShortLegs = legs.some(l => l.action === 'Sell');
    const isUndefinedRisk = typeof calculatedMetrics.maxLoss === 'string';
    let marginType = "Isento", marginValue = "R$ 0,00", riskProfile = "Risco Definido", alertLevel: 'low' | 'medium' | 'high' = 'low';

    if (!hasShortLegs) { marginType = "Isento (Prêmio)"; riskProfile = "Limitado ao Pago"; alertLevel = 'low'; }
    else if (isUndefinedRisk) { marginType = "Chamada de Margem B3"; marginValue = "Alta / Garantia"; riskProfile = "Risco Ilimitado"; alertLevel = 'high'; }
    else { marginType = "Travada (Max Loss)"; if (typeof calculatedMetrics.maxLoss === 'number') marginValue = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Math.abs(calculatedMetrics.maxLoss)); riskProfile = "Travado (Spread)"; alertLevel = 'medium'; }
    return { marginType, marginValue, riskProfile, alertLevel };
  }, [legs, calculatedMetrics]);

  const formatCurrency = (val: number | string) => {
    if (typeof val === 'string') return val;
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 }).format(val);
  };

  return (
    <div className="min-h-screen font-sans text-slate-100 bg-[linear-gradient(85.3deg,#111C2C_2.23%,#395D92_232.74%)] p-4 md:p-8 overflow-x-hidden selection:bg-blue-500/30">
      <ToastContainer toasts={toasts} removeToast={removeToast} />
      {showSaveDialog && <SaveDialog onClose={() => setShowSaveDialog(false)} onSaveNew={() => saveToSheets('create')} onUpdate={() => saveToSheets('update')} strategyName={strategyName} />}

      <header className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-200 to-white flex items-center gap-3">
            <Activity className="text-blue-400" /> Arquiteto de Opções
          </h1>
          <p className="text-blue-200/60 text-sm mt-1">Simulador e Analisador Avançado de Estratégias</p>
        </div>
        <div className="flex gap-3">
          <button onClick={loadFromSheets} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 transition-all text-sm font-medium"><Download size={16} /> Carregar</button>
          <button onClick={handleSaveClick} disabled={isSaving} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 shadow-lg shadow-blue-500/20 transition-all text-sm font-bold text-white">
            {isSaving ? <span className="animate-spin">⌛</span> : (editingId ? <RefreshCw size={16} /> : <Save size={16} />)} 
            {editingId ? "Atualizar / Salvar" : "Salvar"}
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 flex flex-col gap-6">
          <Card className="p-5">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-1"><Input label="Preço do Ativo (Spot)" value={spotPrice} onChange={(e: any) => setSpotPrice(parseFloat(e.target.value))} /></div>
              <div className="md:col-span-2"><Select label="Modelo de Estratégia" value={strategyName} onChange={handleStrategyChange} options={[{ value: "Custom", label: "Estratégia Personalizada" }, ...STRATEGIES.map(s => ({ value: s.name, label: `${CategoryTranslation[s.category]}: ${s.name}` }))]} /></div>
            </div>
          </Card>

          <Card className="p-1 h-[450px] relative group flex flex-col">
            <div className="absolute top-4 left-4 z-10 bg-black/40 backdrop-blur px-3 py-1 rounded text-xs border border-white/10 flex gap-4"><span>Payoff no Vencimento</span><span className="text-blue-300">Simulação: {formatCurrency(simulatedSpot)}</span></div>
            <div className={`absolute top-16 left-1/2 transform -translate-x-1/2 z-20 px-4 py-2 rounded-lg shadow-xl border backdrop-blur-md transition-colors duration-300 ${simulatedMetric >= 0 ? 'bg-emerald-900/60 border-emerald-500/30 text-emerald-100' : 'bg-red-900/60 border-red-500/30 text-red-100'}`}><div className="text-xs uppercase tracking-wider opacity-70 text-center">Resultado Simulado</div><div className="text-xl font-bold text-center">{formatCurrency(simulatedMetric)}</div></div>
            <ResponsiveContainer width="100%" height="100%" className="flex-1">
              <AreaChart data={payoffData} margin={{ top: 20, right: 30, left: 0, bottom: 20 }}>
                <defs><linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10B981" stopOpacity={0.3}/><stop offset="95%" stopColor="#10B981" stopOpacity={0}/></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                <XAxis dataKey="price" stroke="#94a3b8" tickFormatter={(val) => val.toLocaleString('pt-BR')} tick={{fontSize: 12}} />
                <YAxis stroke="#94a3b8" tickFormatter={(val) => formatCurrency(val)} tick={{fontSize: 12}} />
                <Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', color: '#fff' }} itemStyle={{ color: '#fff' }} formatter={(value: number) => [formatCurrency(value), 'Resultado']} labelFormatter={(label) => `Spot: ${formatCurrency(parseFloat(label))}`} />
                <ReferenceLine y={0} stroke="#64748b" strokeDasharray="3 3" />
                <ReferenceLine x={spotPrice} stroke="#fbbf24" strokeDasharray="3 3" label={{ position: 'insideBottom', value: 'Spot', fill: '#fbbf24', fontSize: 10 }} />
                <ReferenceLine x={simulatedSpot} stroke="#ffffff" strokeWidth={2} label={{ position: 'top', value: 'Sim', fill: '#ffffff', fontSize: 10 }} />
                <Area type="monotone" dataKey="value" stroke="#519CFF" strokeWidth={2} fill="url(#colorProfit)" />
              </AreaChart>
            </ResponsiveContainer>
            <div className="px-6 py-4 bg-black/20 border-t border-white/5">
              <div className="flex justify-between items-center text-xs text-blue-200/50 mb-2"><span>-30%</span><span className="text-white font-bold">Ajuste o Preço para Simular Cenários (What-if)</span><span>+30%</span></div>
              <input type="range" min={spotPrice * 0.7} max={spotPrice * 1.3} step={(spotPrice * 0.6) / 200} value={simulatedSpot} onChange={(e) => setSimulatedSpot(parseFloat(e.target.value))} className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500 hover:accent-blue-400 transition-all" />
              <div className="flex justify-between mt-2"><span className="text-xs font-mono text-slate-400">{formatCurrency(spotPrice * 0.7)}</span><button onClick={() => setSimulatedSpot(spotPrice)} className="text-xs bg-white/10 hover:bg-white/20 px-2 py-1 rounded text-white transition-colors">Resetar</button><span className="text-xs font-mono text-slate-400">{formatCurrency(spotPrice * 1.3)}</span></div>
            </div>
          </Card>

          <Card className="p-0 overflow-hidden">
            <div className="p-4 border-b border-white/5 flex justify-between items-center bg-white/5"><h3 className="text-sm font-semibold text-blue-200 uppercase tracking-wide flex items-center gap-2"><LayoutGrid size={16} /> Pernas da Estratégia</h3><button onClick={addLeg} className="text-xs bg-blue-500/20 hover:bg-blue-500/40 text-blue-300 px-2 py-1 rounded border border-blue-500/30 transition-colors flex items-center gap-1"><Plus size={14} /> Adicionar Perna</button></div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-blue-200/50 uppercase bg-black/20"><tr><th className="px-4 py-3">Ação</th><th className="px-4 py-3">Tipo</th><th className="px-4 py-3">Strike ($)</th><th className="px-4 py-3">Qtd</th><th className="px-4 py-3">Prêmio ($)</th><th className="px-4 py-3"></th></tr></thead>
                <tbody className="divide-y divide-white/5">{legs.map((leg) => (<tr key={leg.id} className="hover:bg-white/5 transition-colors"><td className="px-4 py-2"><select value={leg.action} onChange={(e) => updateLeg(leg.id, 'action', e.target.value)} className={`bg-transparent font-bold cursor-pointer outline-none ${leg.action === 'Buy' ? 'text-green-400' : 'text-red-400'}`}><option value="Buy" className="bg-slate-800 text-green-400">Compra</option><option value="Sell" className="bg-slate-800 text-red-400">Venda</option></select></td><td className="px-4 py-2"><select value={leg.type} onChange={(e) => updateLeg(leg.id, 'type', e.target.value)} className="bg-transparent text-white cursor-pointer outline-none"><option value="Call" className="bg-slate-800">Call</option><option value="Put" className="bg-slate-800">Put</option></select></td><td className="px-4 py-2"><input type="number" value={leg.strike} onChange={(e) => updateLeg(leg.id, 'strike', parseFloat(e.target.value))} className="bg-black/20 w-24 px-2 py-1 rounded text-white border border-transparent focus:border-blue-500/50 outline-none"/></td><td className="px-4 py-2"><input type="number" value={leg.quantity} onChange={(e) => updateLeg(leg.id, 'quantity', parseFloat(e.target.value))} className="bg-black/20 w-16 px-2 py-1 rounded text-white border border-transparent focus:border-blue-500/50 outline-none"/></td><td className="px-4 py-2"><input type="number" step="0.01" value={leg.price} onChange={(e) => updateLeg(leg.id, 'price', parseFloat(e.target.value))} className="bg-black/20 w-20 px-2 py-1 rounded text-white border border-transparent focus:border-blue-500/50 outline-none"/></td><td className="px-4 py-2 text-right"><button onClick={() => removeLeg(leg.id)} className="text-white/20 hover:text-red-400 transition-colors"><Trash2 size={16} /></button></td></tr>))}</tbody>
              </table>
            </div>
            {legs.length === 0 && <div className="p-8 text-center text-white/30 italic">Nenhuma perna definida.</div>}
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card className="p-6 bg-gradient-to-br from-[#9CB0CE]/20 to-[#395D92]/30">
            <h3 className="text-xs font-bold text-blue-200 uppercase tracking-widest mb-6 border-b border-white/10 pb-2">Análise da Estrutura</h3>
            <div className="space-y-6">
              <div className="flex justify-between items-end"><div><div className="text-white/50 text-xs mb-1">Custo de Entrada</div><div className={`text-2xl font-bold flex items-center gap-2 ${calculatedMetrics.cost > 0 ? 'text-red-300' : 'text-green-300'}`}>{calculatedMetrics.cost > 0 ? <TrendingDown size={20} /> : <TrendingUp size={20} />}{formatCurrency(Math.abs(calculatedMetrics.cost))}</div><div className="text-xs mt-1 text-white/40">{calculatedMetrics.cost > 0 ? "Débito (Pagar)" : "Crédito (Receber)"}</div></div><div className="p-3 rounded-full bg-white/5"><DollarSign className="text-white/60" size={24} /></div></div>
              <div className="h-px bg-white/10 w-full" />
              <div className="flex flex-col gap-1"><span className="text-xs text-white/50 uppercase">Lucro Máximo</span><span className="text-xl font-medium text-green-400">{typeof calculatedMetrics.maxProfit === 'number' ? formatCurrency(calculatedMetrics.maxProfit) : 'Ilimitado'}</span></div>
              <div className="flex flex-col gap-1"><span className="text-xs text-white/50 uppercase">Risco Máximo</span><span className="text-xl font-medium text-red-400">{typeof calculatedMetrics.maxLoss === 'number' ? formatCurrency(Math.abs(calculatedMetrics.maxLoss)) : 'Ilimitado'}</span></div>
              <div className="flex flex-col gap-1"><span className="text-xs text-white/50 uppercase">Breakeven(s)</span><div className="flex gap-2 flex-wrap">{calculatedMetrics.breakevens.length > 0 ? calculatedMetrics.breakevens.map((be, i) => <span key={i} className="px-2 py-1 rounded bg-white/10 text-white font-mono text-sm border border-white/10">{formatCurrency(be)}</span>) : <span className="text-sm text-white/30 italic">--</span>}</div></div>
            </div>
          </Card>

          <Card className="p-5 flex flex-col gap-4">
             <div className="flex items-start gap-3"><Zap className="text-yellow-400 shrink-0 mt-1" size={18} /><div className="w-full"><h4 className="text-sm font-bold text-white mb-2 flex justify-between items-center"><span>Insight Operacional</span><span className="text-[10px] bg-white/10 px-2 py-0.5 rounded text-white/50 font-mono uppercase">{currentStrategyInfo?.category || "Custom"}</span></h4>{currentStrategyInfo ? (<div className="space-y-4 text-xs"><div className="bg-white/5 p-3 rounded-lg border border-white/5"><div className="text-blue-200/60 uppercase text-[10px] font-bold tracking-wider mb-1">Tese de Investimento</div><p className="text-white/90 leading-relaxed">{currentStrategyInfo.details.thesis}</p></div><div className="grid grid-cols-2 gap-3"><div className="bg-white/5 p-3 rounded-lg border border-white/5"><div className="text-blue-200/60 uppercase text-[10px] font-bold tracking-wider mb-1">Cenário Ideal</div><p className="text-white/80 leading-snug">{currentStrategyInfo.details.idealScenario}</p></div><div className="bg-white/5 p-3 rounded-lg border border-white/5"><div className="text-blue-200/60 uppercase text-[10px] font-bold tracking-wider mb-1">Perfil de Gregas</div><p className="text-emerald-300 font-mono text-[11px]">{currentStrategyInfo.details.greeks}</p></div></div><div><div className="text-blue-200/60 uppercase text-[10px] font-bold tracking-wider mb-1 flex items-center gap-1"><BookOpen size={10}/> Estrutura Mecânica</div><p className="text-white/60 leading-relaxed italic">{currentStrategyInfo.details.mechanics}</p></div></div>) : (<p className="text-xs text-white/50 italic">Estratégia personalizada. Analise o gráfico de Payoff para entender o risco/retorno.</p>)}</div></div>
          </Card>

          <Card className="p-5 flex-1 flex flex-col justify-end min-h-[140px] relative overflow-hidden">
             <Shield className={`absolute -right-6 -bottom-6 w-32 h-32 rotate-12 transition-colors duration-500 ${riskAnalysis.alertLevel === 'high' ? 'text-red-500/10' : 'text-emerald-500/10'}`} />
             <div className="relative z-10 flex flex-col gap-3"><div className="flex justify-between items-start"><h4 className="text-sm font-bold text-white flex items-center gap-2">Controle de Risco & Garantias</h4>{riskAnalysis.alertLevel === 'high' && <AlertTriangle className="text-red-400 animate-pulse" size={18} />}{riskAnalysis.alertLevel === 'medium' && <Lock className="text-yellow-400" size={18} />}{riskAnalysis.alertLevel === 'low' && <Unlock className="text-emerald-400" size={18} />}</div><div className="space-y-2"><div className="flex justify-between items-center text-xs border-b border-white/5 pb-2"><span className="text-white/50">Perfil de Risco</span><span className={`font-bold ${riskAnalysis.alertLevel === 'high' ? 'text-red-400' : 'text-white'}`}>{riskAnalysis.riskProfile}</span></div><div className="flex justify-between items-center text-xs pt-1"><span className="text-white/50">Chamada de Margem (Estimada)</span><div className="text-right"><div className={`font-bold ${riskAnalysis.alertLevel === 'low' ? 'text-emerald-400' : 'text-yellow-400'}`}>{riskAnalysis.marginValue}</div><div className="text-[10px] text-white/30">{riskAnalysis.marginType}</div></div></div></div></div>
          </Card>
        </div>
      </div>

      {showLoadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <Card className="w-full max-w-2xl max-h-[80vh] flex flex-col bg-[#111C2C]">
            <div className="p-6 border-b border-white/10 flex justify-between items-center">
              <h2 className="text-xl font-bold text-white">Simulações Salvas</h2>
              <button onClick={() => setShowLoadModal(false)} className="text-white/50 hover:text-white"><Plus className="rotate-45" /></button>
            </div>
            <div className="overflow-y-auto p-6 space-y-3">
              {savedSimulations.length === 0 ? <div className="text-center text-white/40 py-8">Vazio...</div> : savedSimulations.map((sim, idx) => (
                <div key={idx} onClick={() => loadSimulation(sim)} className="group flex justify-between items-center p-4 bg-white/5 hover:bg-white/10 rounded-lg cursor-pointer border border-transparent hover:border-blue-500/30 transition-all relative">
                  <div>
                    <h3 className="font-bold text-blue-200 group-hover:text-white transition-colors flex items-center gap-2">
                      {sim.name}
                      {new Date(sim.timestamp).getTime() > Date.now() - 60000 && <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-1.5 rounded">Novo</span>}
                    </h3>
                    <div className="text-xs text-white/50 mt-1 flex gap-3">
                      <span>{new Date(sim.timestamp).toLocaleDateString('pt-BR')}</span>
                      <span>Spot: {formatCurrency(parseFloat(sim.spot))}</span>
                      <span>Lucro: <span className="text-green-400">{formatCurrency(parseFloat(sim.metrics.maxProfit))}</span></span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={(e) => { e.stopPropagation(); loadSimulation(sim); }}
                      className="p-2 text-white/30 hover:text-blue-400 transition-colors"
                      title="Editar"
                    >
                      <Edit2 size={16} />
                    </button>
                    <button 
                      onClick={(e) => deleteSimulation(sim.id, e)}
                      className="p-2 text-white/30 hover:text-red-400 transition-colors"
                      title="Excluir"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
