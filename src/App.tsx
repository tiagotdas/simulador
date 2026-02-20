import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine 
} from 'recharts';
import { 
  Plus, Trash2, Save, Download, Activity, DollarSign, Shield, Zap, LayoutGrid, Check, X, AlertCircle, Info, BookOpen, Lock, Unlock, AlertTriangle, Edit2, RefreshCw, FileText, TrendingUp, TrendingDown, Search, ArrowRightLeft, ChevronDown
} from 'lucide-react';

/**
 * CONFIGURAÇÃO E BACKEND
 */
const GAS_URL = "https://script.google.com/macros/s/AKfycbx7kyTKXaQtVYg0WzgzMow9s3elbyDq4Su6TSirn3l3Ppn3_T4xIODahwC9Rt9zWpNJtA/exec"; 

/**
 * MOTOR MATEMÁTICO: BLACK-SCHOLES (GREGAS)
 */
const normPDF = (x) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
const normCDF = (x) => {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
};

const calculateGreeks = (S, K, daysToMaturity, sigma, type) => {
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

const generateUUID = () => Math.random().toString(36).substr(2, 9);

/**
 * CATÁLOGO COMPLETO: 45 ESTRATÉGIAS DE OPÇÕES
 */
const STRATEGIES = [
  // BULLISH (1-9)
  { name: "1. Long Call", category: "Bullish", description: "Compra de Call a seco.", details: { thesis: "Alta direcional forte.", mechanics: "Compra de direito de compra.", idealScenario: "Explosão de preço.", greeks: "Delta+, Gamma+, Theta-, Vega+" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Buy', strike: spot, quantity: 100, price: 2.5 }] },
  { name: "2. Short Put (Naked)", category: "Bullish", description: "Venda de Put a seco.", details: { thesis: "Neutro a levemente altista.", mechanics: "Venda de obrigação de compra.", idealScenario: "Preço acima do strike.", greeks: "Delta+, Theta+, Vega-" }, setup: (spot) => [{ id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.95, quantity: 100, price: 2.0 }] },
  { name: "3. Bull Call Spread", category: "Bullish", description: "Trava de Alta com Calls.", details: { thesis: "Alta moderada.", mechanics: "Compra Call ATM, Vende Call OTM.", idealScenario: "Sobe até o strike vendido.", greeks: "Delta+, Theta misto" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Buy', strike: spot, quantity: 100, price: 5.0 }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.05, quantity: 100, price: 2.0 }] },
  { name: "4. Bull Put Spread", category: "Bullish", description: "Trava de Alta com Puts.", details: { thesis: "Alta moderada/lateral.", mechanics: "Vende Put ATM, Compra Put OTM.", idealScenario: "Acima do strike vendido.", greeks: "Delta+, Theta+, Vega-" }, setup: (spot) => [{ id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.95, quantity: 100, price: 3.0 }, { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 0.90, quantity: 100, price: 1.0 }] },
  { name: "5. Call Ratio Spread", category: "Bullish", description: "Compra 1, Vende 2 Calls.", details: { thesis: "Alta leve.", mechanics: "Compra 1 Call, Vende 2 Calls OTM.", idealScenario: "No strike vendido.", greeks: "Delta variável" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Buy', strike: spot, quantity: 100, price: 5.0 }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.05, quantity: 200, price: 2.0 }] },
  { name: "6. Risk Reversal", category: "Bullish", description: "Compra Call OTM, Vende Put OTM.", details: { thesis: "Alta com proteção de custo.", mechanics: "Financia a Call vendendo Put.", idealScenario: "Alta forte.", greeks: "Delta+" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 1.05, quantity: 100, price: 3.0 }, { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.95, quantity: 100, price: 3.0 }] },
  { name: "7. Call Backspread", category: "Bullish", description: "Vende 1, Compra 2 Calls.", details: { thesis: "Alta explosiva.", mechanics: "Vende 1 ATM, Compra 2 OTM.", idealScenario: "Movimento brusco de alta.", greeks: "Gamma+" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Sell', strike: spot, quantity: 100, price: 5.0 }, { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 1.05, quantity: 200, price: 2.0 }] },
  { name: "8. Bull Call Ladder", category: "Bullish", description: "Ratio estendido.", details: { thesis: "Alta moderada com crédito.", mechanics: "Bull Spread + Venda Extra.", idealScenario: "Alta gradual.", greeks: "Theta+" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Buy', strike: spot, quantity: 100, price: 5.0 }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.05, quantity: 100, price: 2.0 }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.10, quantity: 100, price: 1.0 }] },
  { name: "9. Synthetic Long", category: "Bullish", description: "Simula compra de ação.", details: { thesis: "Réplica do ativo sem capital.", mechanics: "Compra Call, Vende Put ATM.", idealScenario: "Qualquer alta.", greeks: "Delta 1" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Buy', strike: spot, quantity: 100, price: 4.0 }, { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot, quantity: 100, price: 4.0 }] },

  // BEARISH (10-18)
  { name: "10. Long Put", category: "Bearish", description: "Compra de Put a seco.", details: { thesis: "Queda direcional.", mechanics: "Direito de venda.", idealScenario: "Queda brusca.", greeks: "Delta-, Gamma+" }, setup: (spot) => [{ id: generateUUID(), type: 'Put', action: 'Buy', strike: spot, quantity: 100, price: 2.5 }] },
  { name: "11. Short Call (Naked)", category: "Bearish", description: "Venda de Call a seco.", details: { thesis: "Neutro a baixista.", mechanics: "Vende direito de compra.", idealScenario: "Preço não sobe.", greeks: "Delta-, Theta+" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.05, quantity: 100, price: 2.0 }] },
  { name: "12. Bear Put Spread", category: "Bearish", description: "Trava de Baixa com Puts.", details: { thesis: "Queda moderada.", mechanics: "Compra Put ATM, Vende OTM.", idealScenario: "Cai até strike vendido.", greeks: "Delta-, Theta+" }, setup: (spot) => [{ id: generateUUID(), type: 'Put', action: 'Buy', strike: spot, quantity: 100, price: 5.0 }, { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.95, quantity: 100, price: 2.0 }] },
  { name: "13. Bear Call Spread", category: "Bearish", description: "Trava de Baixa com Calls.", details: { thesis: "Baixa moderada.", mechanics: "Vende Call ATM, Compra OTM.", idealScenario: "Abaixo do strike.", greeks: "Delta-, Theta+" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.05, quantity: 100, price: 3.0 }, { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 1.10, quantity: 100, price: 1.0 }] },
  { name: "14. Put Ratio Spread", category: "Bearish", description: "Compra 1, Vende 2 Puts.", details: { thesis: "Queda moderada.", mechanics: "Financia compra da Put.", idealScenario: "No strike vendido.", greeks: "Theta+" }, setup: (spot) => [{ id: generateUUID(), type: 'Put', action: 'Buy', strike: spot, quantity: 100, price: 5.0 }, { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.90, quantity: 200, price: 1.5 }] },
  { name: "15. Put Backspread", category: "Bearish", description: "Vende 1, Compra 2 Puts.", details: { thesis: "Crash severo.", mechanics: "Vende cara, compra baratas.", idealScenario: "Queda catastrófica.", greeks: "Gamma+" }, setup: (spot) => [{ id: generateUUID(), type: 'Put', action: 'Sell', strike: spot, quantity: 100, price: 5.0 }, { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 0.90, quantity: 200, price: 2.0 }] },
  { name: "16. Bear Put Ladder", category: "Bearish", description: "Escada de Baixa.", details: { thesis: "Queda controlada.", mechanics: "Bear Put + Venda extra.", idealScenario: "Queda suave.", greeks: "Theta+" }, setup: (spot) => [{ id: generateUUID(), type: 'Put', action: 'Buy', strike: spot, quantity: 100, price: 5.0 }, { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.95, quantity: 100, price: 2.0 }, { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.90, quantity: 100, price: 1.0 }] },
  { name: "17. Synthetic Short", category: "Bearish", description: "Simula venda a descoberto.", details: { thesis: "Queda linear sem aluguer.", mechanics: "Vende Call, Compra Put ATM.", idealScenario: "Qualquer queda.", greeks: "Delta -1" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Sell', strike: spot, quantity: 100, price: 4.0 }, { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot, quantity: 100, price: 4.0 }] },
  { name: "18. Synthetic Put", category: "Bearish", description: "Put com Ação.", details: { thesis: "Replicação de Put.", mechanics: "Short Stock + Long Call.", idealScenario: "Queda forte.", greeks: "Delta-" }, setup: (spot) => [{ id: generateUUID(), type: 'Stock', action: 'Sell', strike: spot, quantity: 100, price: spot }, { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot, quantity: 100, price: 2.5 }] },

  // VOLATILITY (19-27)
  { name: "19. Long Straddle", category: "Volatility", description: "Compra Call e Put ATM.", details: { thesis: "Explosão de preço.", mechanics: "Compra Volatilidade pura.", idealScenario: "Movimento forte.", greeks: "Gamma++, Vega++, Theta--" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Buy', strike: spot, quantity: 100, price: 4.0 }, { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot, quantity: 100, price: 4.0 }] },
  { name: "20. Long Strangle", category: "Volatility", description: "Compra Put e Call OTM.", details: { thesis: "Explosão (menor custo).", mechanics: "Opções OTM.", idealScenario: "Movimento muito forte.", greeks: "Vega+" }, setup: (spot) => [{ id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 0.95, quantity: 100, price: 2.5 }, { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 1.05, quantity: 100, price: 2.5 }] },
  { name: "21. Strip", category: "Volatility", description: "Straddle Bearish.", details: { thesis: "Volatilidade viés baixa.", mechanics: "2 Puts + 1 Call ATM.", idealScenario: "Queda forte.", greeks: "Gamma+" }, setup: (spot) => [{ id: generateUUID(), type: 'Put', action: 'Buy', strike: spot, quantity: 200, price: 4.0 }, { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot, quantity: 100, price: 4.0 }] },
  { name: "22. Strap", category: "Volatility", description: "Straddle Bullish.", details: { thesis: "Volatilidade viés alta.", mechanics: "2 Calls + 1 Put ATM.", idealScenario: "Alta forte.", greeks: "Gamma+" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Buy', strike: spot, quantity: 200, price: 4.0 }, { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot, quantity: 100, price: 4.0 }] },
  { name: "23. Guts", category: "Volatility", description: "Compra ITM.", details: { thesis: "Volatilidade Deep ITM.", mechanics: "Call/Put ITM.", idealScenario: "Movimento amplo.", greeks: "Delta neutro" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 0.95, quantity: 100, price: 6.0 }, { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 1.05, quantity: 100, price: 6.0 }] },
  { name: "24. Reverse Iron Condor", category: "Volatility", description: "Aposta na explosão.", details: { thesis: "Sair do intervalo.", mechanics: "Compra pontas internas.", idealScenario: "Rompe barreiras.", greeks: "Vega+" }, setup: (spot) => [{ id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.90, quantity: 100, price: 1.0 }, { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 0.95, quantity: 100, price: 3.0 }, { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 1.05, quantity: 100, price: 3.0 }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.10, quantity: 100, price: 1.0 }] },
  { name: "25. Short Butterfly (C)", category: "Volatility", description: "Explosão de preço.", details: { thesis: "Sair do centro.", mechanics: "Inverso da borboleta.", idealScenario: "Longe do miolo.", greeks: "Vega+" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 0.95, quantity: 100, price: 6.0 }, { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot, quantity: 200, price: 3.5 }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.05, quantity: 100, price: 1.5 }] },
  { name: "26. Short Butterfly (P)", category: "Volatility", description: "Versão com Puts.", details: { thesis: "Explosão de preço.", mechanics: "Com Puts.", idealScenario: "Longe do miolo.", greeks: "Vega+" }, setup: (spot) => [{ id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.95, quantity: 100, price: 6.0 }, { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot, quantity: 200, price: 3.5 }, { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 1.05, quantity: 100, price: 1.5 }] },
  { name: "27. Double Ratio (Vol)", category: "Volatility", description: "Backspread duplo.", details: { thesis: "Grande movimento.", mechanics: "Vende ATM, compra OTM duplo.", idealScenario: "Explosão lateral.", greeks: "Gamma+" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Sell', strike: spot, quantity: 100, price: 4.0 }, { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 1.05, quantity: 200, price: 1.5 }, { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot, quantity: 100, price: 4.0 }, { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 0.95, quantity: 200, price: 1.5 }] },

  // INCOME (28-38)
  { name: "28. Short Straddle", category: "Income", description: "Venda ATM.", details: { thesis: "Mercado parado.", mechanics: "Venda de vol ATM.", idealScenario: "Preço estático.", greeks: "Theta++" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Sell', strike: spot, quantity: 100, price: 4.0 }, { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot, quantity: 100, price: 4.0 }] },
  { name: "29. Short Strangle", category: "Income", description: "Venda OTM.", details: { thesis: "Mercado em range.", mechanics: "Venda de vol OTM.", idealScenario: "Entre strikes.", greeks: "Theta+" }, setup: (spot) => [{ id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.90, quantity: 100, price: 2.0 }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.10, quantity: 100, price: 2.0 }] },
  { name: "30. Iron Condor", category: "Income", description: "Strangle travado.", details: { thesis: "Lateralização segura.", mechanics: "Bull Put + Bear Call.", idealScenario: "No corpo do condor.", greeks: "Theta+" }, setup: (spot) => [{ id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 0.90, quantity: 100, price: 1.0 }, { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.95, quantity: 100, price: 3.0 }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.05, quantity: 100, price: 3.0 }, { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 1.10, quantity: 100, price: 1.0 }] },
  { name: "31. Iron Butterfly", category: "Income", description: "Straddle travado.", details: { thesis: "Pin no strike central.", mechanics: "Vende ATM, protege OTM.", idealScenario: "Preço exato no miolo.", greeks: "Theta+" }, setup: (spot) => [{ id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 0.95, quantity: 100, price: 2.0 }, { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot, quantity: 100, price: 5.0 }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot, quantity: 100, price: 5.0 }, { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 1.05, quantity: 100, price: 2.0 }] },
  { name: "32. Butterfly (Call)", category: "Income", description: "Borboleta clássica.", details: { thesis: "Alvo preciso.", mechanics: "Simetria 1-2-1.", idealScenario: "Exato no miolo.", greeks: "Theta+" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 0.95, quantity: 100, price: 6.0 }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot, quantity: 200, price: 3.5 }, { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 1.05, quantity: 100, price: 1.5 }] },
  { name: "33. Butterfly (Put)", category: "Income", description: "Borboleta com Puts.", details: { thesis: "Alvo preciso.", mechanics: "1-2-1 com Puts.", idealScenario: "No miolo.", greeks: "Theta+" }, setup: (spot) => [{ id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 0.95, quantity: 100, price: 1.5 }, { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot, quantity: 200, price: 3.5 }, { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 1.05, quantity: 100, price: 6.0 }] },
  { name: "34. Broken Wing (C)", category: "Income", description: "Borboleta assimétrica.", details: { thesis: "Viés de alta + renda.", mechanics: "Asa superior aberta.", idealScenario: "Estável ou alta.", greeks: "Theta+" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 0.95, quantity: 100, price: 6.0 }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot, quantity: 200, price: 3.5 }, { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 1.10, quantity: 100, price: 0.5 }] },
  { name: "35. Broken Wing (P)", category: "Income", description: "Borboleta assimétrica P.", details: { thesis: "Viés de baixa + renda.", mechanics: "Asa inferior aberta.", idealScenario: "Estabilidade.", greeks: "Theta+" }, setup: (spot) => [{ id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 0.90, quantity: 100, price: 0.5 }, { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot, quantity: 200, price: 3.5 }, { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 1.05, quantity: 100, price: 6.0 }] },
  { name: "36. Christmas Tree (C)", category: "Income", description: "Christmas Tree 1-3-2.", details: { thesis: "Alta lenta e limitada.", mechanics: "Compra 1, pula strike, vende 3, compra 2.", idealScenario: "No strike vendido.", greeks: "Theta+, Vega-" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 0.95, quantity: 100, price: 6.0 }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.05, quantity: 300, price: 1.5 }, { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 1.10, quantity: 200, price: 0.5 }] },
  { name: "37. Christmas Tree (P)", category: "Income", description: "Versão com Puts.", details: { thesis: "Queda lenta e limitada.", mechanics: "Com Puts.", idealScenario: "No strike vendido.", greeks: "Theta+" }, setup: (spot) => [{ id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 1.05, quantity: 100, price: 6.0 }, { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.95, quantity: 300, price: 1.5 }, { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 0.90, quantity: 200, price: 0.5 }] },
  { name: "38. Condor (Call)", category: "Income", description: "Corpo largo.", details: { thesis: "Lateralidade ampla.", mechanics: "Borboleta com miolo aberto.", idealScenario: "Entre strikes vendidos.", greeks: "Theta+" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 0.90, quantity: 100, price: 9.0 }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 0.95, quantity: 100, price: 6.0 }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.05, quantity: 100, price: 2.0 }, { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 1.10, quantity: 100, price: 0.5 }] },

  // HEDGE (39-45)
  { name: "39. Jade Lizard", category: "Hedge", description: "Put + Bear Call.", details: { thesis: "Neutro/Alta sem risco alta.", mechanics: "Soma de crédito.", idealScenario: "Lateral/Alta.", greeks: "Theta+" }, setup: (spot) => [{ id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.90, quantity: 100, price: 4.0 }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.05, quantity: 100, price: 2.5 }, { id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 1.10, quantity: 100, price: 1.0 }] },
  { name: "40. Twisted Sister", category: "Hedge", description: "Inverso Jade.", details: { thesis: "Neutro/Baixa.", mechanics: "Venda Call + Bull Put.", idealScenario: "Lateral/Queda.", greeks: "Theta+" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.10, quantity: 100, price: 2.0 }, { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.95, quantity: 100, price: 3.0 }, { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 0.90, quantity: 100, price: 1.0 }] },
  { name: "41. Seagull (Bull)", category: "Hedge", description: "Bull Spread financiado.", details: { thesis: "Alta financiada.", mechanics: "Call Spread + Put Short.", idealScenario: "Alta forte.", greeks: "Delta+" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Buy', strike: spot, quantity: 100, price: 5.0 }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.05, quantity: 100, price: 2.0 }, { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.90, quantity: 100, price: 3.0 }] },
  { name: "42. Box Spread", category: "Hedge", description: "Arbitragem.", details: { thesis: "Renda Fixa.", mechanics: "Bull Call + Bear Put.", idealScenario: "Arbitragem livre de risco.", greeks: "Neutro" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Buy', strike: spot * 0.95, quantity: 100, price: 6.0 }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.05, quantity: 100, price: 2.0 }, { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 1.05, quantity: 100, price: 6.0 }, { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot * 0.95, quantity: 100, price: 2.0 }] },
  { name: "43. Fence (Collar Options)", category: "Hedge", description: "Proteção.", details: { thesis: "Proteção de carteira.", mechanics: "Compra Put, Venda Call.", idealScenario: "Cai protegendo.", greeks: "Delta-" }, setup: (spot) => [{ id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 0.95, quantity: 100, price: 3.0 }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.05, quantity: 100, price: 2.5 }] },
  { name: "44. Ratio Call Write", category: "Hedge", description: "Covered Call 1x2.", details: { thesis: "Renda extra no ativo.", mechanics: "Long Stock + 2 Calls Short.", idealScenario: "Alta moderada.", greeks: "Theta++" }, setup: (spot) => [{ id: generateUUID(), type: 'Stock', action: 'Buy', strike: spot, quantity: 100, price: spot }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.05, quantity: 200, price: 2.0 }] },
  { name: "45. Synthetic Collar", category: "Hedge", description: "Collar sintético.", details: { thesis: "Proteção total.", mechanics: "Stock Sintético + Collar.", idealScenario: "Alta moderada.", greeks: "Delta limitado" }, setup: (spot) => [{ id: generateUUID(), type: 'Call', action: 'Buy', strike: spot, quantity: 100, price: 4.0 }, { id: generateUUID(), type: 'Put', action: 'Sell', strike: spot, quantity: 100, price: 4.0 }, { id: generateUUID(), type: 'Put', action: 'Buy', strike: spot * 0.90, quantity: 100, price: 1.5 }, { id: generateUUID(), type: 'Call', action: 'Sell', strike: spot * 1.10, quantity: 100, price: 1.0 }] }
];

const CategoryTranslation = { 'Bullish': 'Alta', 'Bearish': 'Baixa', 'Volatility': 'Volatilidade', 'Income': 'Renda', 'Hedge': 'Proteção' };

/**
 * COMPONENTES UI (HELPERS)
 */
const Card = ({ children, className = "" }) => (
  <div className={`bg-[#9CB0CE]/20 backdrop-blur-md border border-[#E5F9FF]/10 shadow-lg rounded-xl overflow-hidden ${className}`}>
    {children}
  </div>
);

const ToastContainer = ({ toasts, removeToast }) => (
  <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 w-full max-w-sm pointer-events-none">
    {toasts.map(t => (
      <div key={t.id} className={`pointer-events-auto flex items-center gap-3 p-4 rounded-lg shadow-2xl border backdrop-blur-md transition-all duration-300 ${t.type === 'success' ? 'bg-emerald-900/80 border-emerald-500/30 text-emerald-100' : t.type === 'error' ? 'bg-red-900/80 border-red-500/30 text-red-100' : 'bg-blue-900/80 border-blue-500/30 text-blue-100'}`}>
        {t.type === 'success' ? <Check size={18} /> : t.type === 'error' ? <AlertCircle size={18} /> : <Info size={18} />}
        <p className="text-sm font-medium flex-1">{t.message}</p>
        <button onClick={() => removeToast(t.id)} className="opacity-50 hover:opacity-100"><X size={16} /></button>
      </div>
    ))}
  </div>
);

/**
 * ENGINE MATEMÁTICA PAYOFF & CONSOLIDAÇÃO
 */
const getOptionValueAtExpiry = (type, strike, spot) => {
  if (type === 'Call') return Math.max(0, spot - strike);
  if (type === 'Put') return Math.max(0, strike - spot);
  if (type === 'Stock') return spot;
  return 0;
};

const calculatePayoff = (legs, spotRange) => {
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

/**
 * MAIN APP COMPONENT
 */
export default function OptionsStrategyBuilder() {
  const [spotPrice, setSpotPrice] = useState(100);
  const [simulatedSpot, setSimulatedSpot] = useState(100); 
  const [legs, setLegs] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [strategyName, setStrategyName] = useState("Custom");
  
  const [tickerQuery, setTickerQuery] = useState("PETR4");
  const [isFetchingMarket, setIsFetchingMarket] = useState(false);
  const [marketData, setMarketData] = useState(null);
  const [selectedExpiry, setSelectedExpiration] = useState("");

  const addToast = (msg, type = 'info') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message: msg, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000); 
  };

  useEffect(() => { setSimulatedSpot(spotPrice); }, [spotPrice]);

  // FETCH MARKET DATA
  const fetchMarketData = async () => {
    if (!tickerQuery) return;
    setIsFetchingMarket(true);
    addToast(`Consolidando dados reais de ${tickerQuery.toUpperCase()}...`, 'info');
    try {
      const response = await fetch(`${GAS_URL}?ticker=${tickerQuery.toUpperCase()}`);
      const json = await response.json();
      if (json.status === 'success' && json.data.chain.length > 0) {
        const enrichedChain = json.data.chain.map(opt => ({
          ...opt, ...calculateGreeks(json.data.spotPrice, opt.strike, opt.daysToMaturity, opt.impliedVolatility, opt.type)
        }));
        setMarketData({ ...json.data, chain: enrichedChain });
        setSpotPrice(json.data.spotPrice);
        const dates = [...new Set(enrichedChain.map(opt => opt.expirationDate))];
        if (dates.length > 0) setSelectedExpiration(dates[0]);
        addToast(`Matriz carregada: Spot ${json.data.spotPrice}`, 'success');
      }
    } catch (e) { addToast("Erro ao conectar ao Gateway.", 'error'); } finally { setIsFetchingMarket(false); }
  };

  const handleStrategyTemplateChange = (e) => {
    const selected = STRATEGIES.find(s => s.name === e.target.value);
    if (selected) {
      setStrategyName(selected.name);
      const newLegs = selected.setup(spotPrice).map(leg => {
        const match = marketData?.chain.find(o => Math.abs(o.strike - leg.strike) < 0.2 && o.type === leg.type);
        return { ...leg, delta: match?.delta, gamma: match?.gamma, theta: match?.theta, vega: match?.vega };
      });
      setLegs(newLegs);
      addToast(`Template ${selected.name} aplicado.`, 'success');
    } else { setStrategyName("Custom"); }
  };

  const addLegFromMarket = (option, action) => {
    if (!option) return;
    setLegs([...legs, { 
      id: generateUUID(), type: option.type, action, strike: option.strike, quantity: 100, 
      price: action === 'Buy' ? option.ask : option.bid, ...option
    }]);
  };

  const updateLeg = (id, field, value) => {
    setLegs(prev => prev.map(leg => leg.id === id ? { ...leg, [field]: value } : leg));
  };

  // CALCULATED METRICS
  const payoffData = useMemo(() => {
    const range = [];
    const lower = spotPrice * 0.7, upper = spotPrice * 1.3, step = (upper - lower) / 100;
    for (let p = lower; p <= upper; p += step) range.push(p);
    return calculatePayoff(legs, range);
  }, [legs, spotPrice]);

  const metrics = useMemo(() => {
    let cost = 0, dInf = 0, pZero = 0, tD = 0, tG = 0, tT = 0, tV = 0;
    legs.forEach(l => {
      const isB = l.action === 'Buy', m = isB ? 1 : -1, c = l.quantity * l.price;
      if (isB) cost += c; else cost -= c;
      if (l.type === 'Call' || l.type === 'Stock') dInf += isB ? l.quantity : -l.quantity;
      const vZ = getOptionValueAtExpiry(l.type, l.strike, 0);
      pZero += isB ? (vZ * l.quantity) - c : c - (vZ * l.quantity);
      if (l.delta) tD += l.delta * l.quantity * m;
      if (l.gamma) tG += l.gamma * l.quantity * m;
      if (l.theta) tT += l.theta * l.quantity * m;
      if (l.vega) tV += l.vega * l.quantity * m;
    });
    const vals = payoffData.map(p => p.value);
    let mP = Math.max(...vals, pZero), mL = Math.min(...vals, pZero);
    if (dInf > 0) mP = "Ilimitado"; if (dInf < 0) mL = "Ilimitado";
    const be = [];
    for (let i = 1; i < payoffData.length; i++) {
      if (payoffData[i-1].value * payoffData[i].value <= 0 && payoffData[i-1].value !== payoffData[i].value) {
        be.push(parseFloat((payoffData[i-1].price - payoffData[i-1].value * (payoffData[i].price - payoffData[i-1].price) / (payoffData[i].value - payoffData[i-1].value)).toFixed(2)));
      }
    }
    return { cost, maxProfit: mP, maxLoss: mL, breakevens: Array.from(new Set(be)), greeks: { delta: tD, gamma: tG, theta: tT, vega: tV } };
  }, [legs, payoffData]);

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
    <div className="min-h-screen font-sans text-slate-100 bg-[#111C2C] p-4 md:p-8 selection:bg-blue-500/30">
      <ToastContainer toasts={toasts} removeToast={(id) => setToasts(prev => prev.filter(t => t.id !== id))} />

      {/* HEADER DINÂMICO */}
      <header className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-black bg-clip-text text-transparent bg-gradient-to-r from-blue-200 to-white flex items-center gap-3">
            <Activity className="text-blue-400" /> Arquiteto v2.2
          </h1>
          <p className="text-blue-200/50 text-xs font-bold uppercase tracking-widest">Plataforma de Auditoria & Cálculo Quantitativo</p>
        </div>
        
        <div className="flex gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-[9px] text-blue-300 font-black uppercase tracking-tighter">Modelos (45 Estratégias)</label>
            <select onChange={handleStrategyTemplateChange} value={strategyName} className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs font-bold text-white outline-none hover:bg-black/60 transition-all cursor-pointer">
              <option value="Custom">Custom Setup</option>
              {STRATEGIES.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[9px] text-blue-300 font-black uppercase tracking-tighter">Real-Time Data B3</label>
            <div className="flex gap-2 bg-black/40 p-1 rounded-lg border border-white/10 shadow-inner">
              <input type="text" value={tickerQuery} onChange={(e) => setTickerQuery(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === 'Enter' && fetchMarketData()} className="bg-transparent border-none outline-none text-white px-2 w-20 font-black uppercase text-sm" />
              <button onClick={fetchMarketData} disabled={isFetchingMarket} className="bg-blue-600 hover:bg-blue-500 px-3 py-1 rounded-md text-[10px] font-black flex items-center gap-2 transition-all">
                {isFetchingMarket ? <RefreshCw className="animate-spin" size={12} /> : <Search size={12} />} ANALISAR
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* COLUNA ESQUERDA: VISUALIZAÇÃO E POSIÇÃO */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="p-4 h-[420px] relative bg-slate-900/40">
             <div className={`absolute top-12 left-1/2 transform -translate-x-1/2 z-20 px-8 py-3 rounded-2xl border backdrop-blur-xl shadow-2xl transition-all duration-500 ${metrics.cost <= 0 ? 'bg-emerald-900/40 border-emerald-500/20' : 'bg-red-900/40 border-red-500/20'}`}>
                <div className="text-[9px] font-black uppercase tracking-[0.2em] text-center opacity-50 mb-1">Total PnL Projection</div>
                <div className="text-3xl font-black text-center">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(calculatePayoff(legs, [simulatedSpot])[0]?.value || 0)}</div>
             </div>
             <ResponsiveContainer width="100%" height="100%">
               <AreaChart data={payoffData} margin={{ top: 40, right: 30, left: 0, bottom: 0 }}>
                 <defs><linearGradient id="cP" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10B981" stopOpacity={0.4}/><stop offset="95%" stopColor="#10B981" stopOpacity={0}/></linearGradient></defs>
                 <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
                 <XAxis dataKey="price" stroke="#475569" tick={{fontSize: 10, fontWeight: 'bold'}} />
                 <YAxis stroke="#475569" tick={{fontSize: 10}} tickFormatter={v => `R$${v}`} />
                 <Tooltip contentStyle={{backgroundColor: '#0f172a', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)'}} itemStyle={{fontWeight: 'bold'}} />
                 <ReferenceLine y={0} stroke="#64748b" strokeWidth={1} />
                 <ReferenceLine x={spotPrice} stroke="#fbbf24" strokeDasharray="5 5" label={{value: 'SPOT', fill: '#fbbf24', fontSize: 10, fontWeight: '900'}} />
                 <ReferenceLine x={simulatedSpot} stroke="#fff" label={{value: 'WHAT-IF', fill: '#fff', fontSize: 10, fontWeight: '900'}} />
                 <Area type="monotone" dataKey="value" stroke="#519CFF" strokeWidth={4} fill="url(#cP)" />
               </AreaChart>
             </ResponsiveContainer>
             <div className="mt-4 px-10">
                <input type="range" min={spotPrice * 0.7} max={spotPrice * 1.3} step={0.01} value={simulatedSpot} onChange={(e) => setSimulatedSpot(parseFloat(e.target.value))} className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500" />
             </div>
          </Card>

          <Card className="p-0 bg-slate-900/20">
            <div className="p-4 border-b border-white/5 flex justify-between items-center bg-white/5">
              <h3 className="text-xs font-black uppercase tracking-widest text-blue-200">Portfolio Consolidation</h3>
              <button onClick={() => setLegs([])} className="text-[10px] font-black text-white/20 hover:text-red-400 uppercase transition-colors">Clear All Positions</button>
            </div>
            <div className="overflow-x-auto max-h-[300px] custom-scrollbar">
              <table className="w-full text-xs text-left">
                 <thead className="bg-black/40 text-[9px] font-black uppercase text-white/30 sticky top-0 z-10"><tr className="border-b border-white/5"><th className="p-4">OP</th><th className="p-4">TYPE</th><th className="p-4">STRIKE</th><th className="p-4 text-center">QUANTITY</th><th className="p-4">PRICE</th><th className="p-4">DELTA</th><th className="p-4 text-right">ACTION</th></tr></thead>
                 <tbody className="divide-y divide-white/5">
                   {legs.map(l => (
                     <tr key={l.id} className="hover:bg-white/5 group transition-all">
                       <td className="p-4"><span className={`px-2 py-0.5 rounded text-[10px] font-black ${l.action === 'Buy' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>{l.action === 'Buy' ? 'BUY' : 'SELL'}</span></td>
                       <td className="p-4 font-black text-white/80">{l.type}</td>
                       <td className="p-4 text-blue-300 font-mono font-bold">{l.type === 'Stock' ? '---' : l.strike.toFixed(2)}</td>
                       <td className="p-4 text-center"><input type="number" value={l.quantity} onChange={(e) => updateLeg(l.id, 'quantity', parseInt(e.target.value) || 0)} className="bg-black/40 w-20 px-2 py-1 rounded text-center outline-none border border-transparent focus:border-blue-500/50 font-mono" /></td>
                       <td className="p-4 font-mono">R${l.price.toFixed(2)}</td>
                       <td className="p-4 text-white/20 font-mono">{l.delta ? l.delta.toFixed(3) : '-'}</td>
                       <td className="p-4 text-right"><button onClick={() => removeLeg(l.id)} className="text-white/10 group-hover:text-red-400 transition-colors"><Trash2 size={16}/></button></td>
                     </tr>
                   ))}
                 </tbody>
              </table>
              {legs.length === 0 && <div className="p-16 text-center text-white/10 italic text-sm font-bold uppercase tracking-widest">Nenhuma perna ativa. Selecione um modelo ou use a matriz lateral.</div>}
            </div>
          </Card>
        </div>

        {/* COLUNA DIREITA: INDICADORES E MATRIZ */}
        <div className="space-y-6">
          <Card className="p-6 bg-gradient-to-br from-slate-900 to-blue-950 border-blue-500/30 relative overflow-hidden shadow-2xl">
            <div className="absolute top-0 right-0 p-4 opacity-5"><Shield size={80} /></div>
            <h3 className="text-[10px] font-black uppercase text-blue-400 tracking-[0.3em] mb-6 border-b border-white/10 pb-3">Accounting & Risk</h3>
            <div className="space-y-6">
              <div><div className="text-[9px] text-white/40 font-black uppercase mb-1">Custo de Montagem</div><div className={`text-3xl font-black ${metrics.cost > 0 ? 'text-red-400' : 'text-emerald-400'}`}>R$ {Math.abs(metrics.cost).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</div></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-black/40 p-3 rounded-xl border border-white/5"><div className="text-[8px] text-white/30 font-black uppercase mb-1">Max Profit</div><div className="text-sm font-black text-emerald-400">{typeof metrics.maxProfit === 'number' ? `R$${metrics.maxProfit.toLocaleString()}` : metrics.maxProfit}</div></div>
                <div className="bg-black/40 p-3 rounded-xl border border-white/5"><div className="text-[8px] text-white/30 font-black uppercase mb-1">Max Risk</div><div className="text-sm font-black text-red-400">{typeof metrics.maxLoss === 'number' ? `R$${Math.abs(metrics.maxLoss).toLocaleString()}` : metrics.maxLoss}</div></div>
              </div>
              <div className="bg-black/40 p-4 rounded-xl border border-white/10">
                <div className="text-[9px] font-black text-blue-400 uppercase mb-4 flex items-center gap-2"><Zap size={10}/> Portfolio Sensitivities</div>
                <div className="grid grid-cols-2 gap-4 text-[11px] font-mono">
                  <div className="flex justify-between border-b border-white/5 pb-1"><span>Delta</span><span className="text-blue-300 font-black">{metrics.greeks.delta.toFixed(2)}</span></div>
                  <div className="flex justify-between border-b border-white/5 pb-1"><span>Theta</span><span className={metrics.greeks.theta > 0 ? 'text-emerald-400' : 'text-red-400'}>{metrics.greeks.theta.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span>Gamma</span><span className="text-white/60">{metrics.greeks.gamma.toFixed(4)}</span></div>
                  <div className="flex justify-between"><span>Vega</span><span className="text-purple-400">{metrics.greeks.vega.toFixed(2)}</span></div>
                </div>
              </div>
            </div>
          </Card>

          {/* INSIGHTS DO MODELO SELECIONADO */}
          <Card className="p-5 bg-slate-900/40 border-white/5">
             <div className="flex items-center gap-2 mb-4 text-yellow-500"><BookOpen size={18}/><h4 className="text-[10px] font-black uppercase tracking-widest">Structural Insights</h4></div>
             {currentStratInfo ? (
               <div className="space-y-4">
                 <div className="bg-black/30 p-3 rounded-lg text-[11px] leading-relaxed border-l-2 border-blue-500"><span className="text-blue-300 font-black uppercase block text-[9px] mb-1">Investment Thesis:</span> {currentStratInfo.details.thesis}</div>
                 <div className="grid grid-cols-2 gap-2">
                    <div className="bg-black/30 p-2 rounded-lg"><div className="text-white/30 font-black uppercase text-[8px] mb-1">Scenario</div><div className="text-[10px] font-bold">{currentStratInfo.details.idealScenario}</div></div>
                    <div className="bg-black/30 p-2 rounded-lg"><div className="text-white/30 font-black uppercase text-[8px] mb-1">Greeks Profile</div><div className="text-[10px] font-mono text-emerald-400 font-bold">{currentStratInfo.details.greeks}</div></div>
                 </div>
               </div>
             ) : <div className="p-8 text-center text-white/10 text-[10px] font-black uppercase tracking-widest border-2 border-dashed border-white/5 rounded-xl">Custom Strategy Selection</div>}
          </Card>

          {/* T-BOARD OPTION CHAIN */}
          <Card className="flex-1 flex flex-col min-h-[420px] bg-[#0f172a]/80 border-white/5">
             <div className="p-4 border-b border-white/5 bg-black/40">
                <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-200 mb-3 flex items-center gap-2"><LayoutGrid size={14}/> Market Option Board</h3>
                {marketData ? (
                  <div className="relative">
                    <select value={selectedExpiry} onChange={(e) => setSelectedExpiration(e.target.value)} className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-xs text-white outline-none font-black cursor-pointer appearance-none">
                      {[...new Set(marketData.chain.map(o => o.expirationDate))].map(d => (
                        <option key={d} value={d}>{new Date(d).toLocaleDateString('pt-BR')} ({marketData.chain.find(o => o.expirationDate === d)?.daysToMaturity} DTE)</option>
                      ))}
                    </select>
                    <div className="absolute right-3 top-2 pointer-events-none opacity-40"><ChevronDown size={14}/></div>
                  </div>
                ) : <div className="p-4 text-center border-2 border-dashed border-white/5 rounded-lg text-[9px] font-black text-white/20">Aguardando Ticker...</div>}
             </div>
             <div className="overflow-y-auto flex-1 custom-scrollbar">
                <table className="w-full text-[9px] font-mono text-center">
                  <thead className="sticky top-0 bg-slate-900/95 z-20"><tr className="border-b border-white/10 text-white/40"><th className="py-2 text-emerald-400">CALL BID</th><th className="bg-slate-800 text-white px-2">STRK</th><th className="py-2 text-red-400">PUT ASK</th></tr></thead>
                  <tbody className="divide-y divide-white/5">
                    {tBoardData.map((row, i) => {
                      const isATM = Math.abs(row.strike - spotPrice) < 0.3;
                      return (
                        <tr key={i} className={`hover:bg-blue-400/10 transition-colors ${isATM ? 'bg-blue-500/5' : ''}`}>
                          <td className="p-0">
                            <button onClick={() => addLegFromMarket(row.call, 'Sell')} className="w-full py-2 px-1 text-emerald-400/40 hover:text-emerald-400 transition-all">{row.call?.bid.toFixed(2) || '-'}</button>
                          </td>
                          <td className={`p-0 bg-slate-800/40 font-black ${isATM ? 'text-blue-300' : 'text-white/30'}`}>{row.strike.toFixed(2)}</td>
                          <td className="p-0">
                            <button onClick={() => addLegFromMarket(row.put, 'Buy')} className="w-full py-2 px-1 text-red-400/40 hover:text-red-400 transition-all">{row.put?.ask.toFixed(2) || '-'}</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
             </div>
          </Card>
        </div>
      </div>

      <style>{`.custom-scrollbar::-webkit-scrollbar { width: 4px; } .custom-scrollbar::-webkit-scrollbar-track { background: transparent; } .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 10px; } .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }`}</style>
    </div>
  );
}
