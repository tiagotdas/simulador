import {
  CoreStressScenario,
  Leg,
  MarginBreakdown,
  MarketParams,
} from '../types/options';
import { priceOption } from './americanPricing';
import { getContinuousMarketRates, intrinsicValue } from './blackScholes';
import { getTimeToMaturityYears } from './calendar';
import { getActiveLegs, getNearestDte } from './payoff';

const BASE_SPOT_SHOCKS_PCT = [-28, -21, -14, -7, 0, 7, 14, 21, 28];
const REL_VOL_SHOCKS_PCT = [-35, 0, 35, 60];

/**
 * Estimates B3 margin / collateral commitment using a 2D Portfolio Stress Matrix
 * (Spot Shock × Relative IV Shock) over a 2-business-day closeout horizon,
 * inspired by B3's CORE (Closeout Risk Evaluation) methodology.
 *
 * Captures natural portfolio offsets across spreads, collars, iron condors,
 * covered calls, and calendar structures while exposing the binding stress scenario.
 */
export function evaluateCoreMarginProxy(
  legs: Leg[],
  marketParams: MarketParams,
  netCost: number
): MarginBreakdown {
  const active = getActiveLegs(legs);
  if (active.length === 0 || marketParams.spotPrice <= 0) {
    return {
      initialCashRequired: 0,
      coreMarginRequired: 0,
      totalCapitalRequired: 0,
      bindingScenario: null,
      scenariosEvaluated: 0,
    };
  }

  const optionLegs = active.filter((l) => l.type !== 'Stock');
  const totalOptQty = optionLegs.reduce((s, l) => s + l.quantity, 0);
  const avgIv =
    totalOptQty > 0
      ? optionLegs.reduce((s, l) => s + (l.impliedVolatility > 0 ? l.impliedVolatility : 0.35) * l.quantity, 0) /
        totalOptQty
      : 0.30;

  // Scale stress envelope moderately for high-volatility underlying stocks (e.g. MGLU3)
  const volScale = Math.max(1.0, Math.min(1.6, avgIv / 0.3));
  const spotShocks = BASE_SPOT_SHOCKS_PCT.map((pct) =>
    Number(Math.max(-80, pct * volScale).toFixed(1))
  );

  // Closeout window: 2 business days (~3 calendar days), plus immediate stress (T+0)
  const nearestDte = getNearestDte(active);
  const closeoutHorizons = nearestDte <= 3 ? [0, nearestDte] : [0, 3];
  const { rCont, qCont } = getContinuousMarketRates(marketParams);

  let worstPnl = Infinity;
  let bindingScenario: CoreStressScenario | null = null;
  let scenariosEvaluated = 0;

  for (const daysElapsed of closeoutHorizons) {
    for (const spotShockPct of spotShocks) {
      const scenarioSpot = Math.max(0.01, marketParams.spotPrice * (1 + spotShockPct / 100));

      for (const volShockRelPct of REL_VOL_SHOCKS_PCT) {
        scenariosEvaluated += 1;
        let closeoutPnl = 0;

        for (const leg of active) {
          const dir = leg.action === 'Buy' ? 1 : -1;
          let legVal: number;

          if (leg.type === 'Stock') {
            legVal = scenarioSpot;
          } else {
            const remDays = Math.max(0, leg.daysToMaturity - daysElapsed);
            if (remDays <= 0) {
              legVal = intrinsicValue(leg.type, scenarioSpot, leg.strike);
            } else {
              const T = getTimeToMaturityYears(
                remDays,
                marketParams.dayCountConvention,
                leg.expirationDate
              );
              const baseIv = leg.impliedVolatility > 0 ? leg.impliedVolatility : 0.35;
              const shockedIv = Math.max(0.03, baseIv * (1 + volShockRelPct / 100));
              legVal = priceOption({
                S: scenarioSpot,
                K: leg.strike,
                T,
                r: rCont,
                q: qCont,
                sigma: shockedIv,
                type: leg.type,
                exerciseStyle: leg.exerciseStyle ?? 'European',
              });
            }
          }

          closeoutPnl += dir * (legVal - leg.price) * leg.quantity;
        }

        if (closeoutPnl < worstPnl) {
          worstPnl = closeoutPnl;
          bindingScenario = {
            spotShockPct,
            volShockRelPct,
            scenarioSpot: Number(scenarioSpot.toFixed(2)),
            closeoutPnl: Number(closeoutPnl.toFixed(2)),
          };
        }
      }
    }
  }

  // Account for B3 BTC borrow haircut floor when holding net short stock positions
  let netStockShares = 0;
  for (const leg of active) {
    if (leg.type === 'Stock') {
      netStockShares += leg.action === 'Buy' ? leg.quantity : -leg.quantity;
    }
  }
  const shortStockHaircutFloor =
    netStockShares < 0 ? Math.abs(netStockShares) * marketParams.spotPrice * 0.2 : 0;

  const initialCashRequired = Math.max(0, netCost);
  const worstLossMagnitude = Number.isFinite(worstPnl) && worstPnl < 0 ? Math.abs(worstPnl) : 0;

  // Additional collateral beyond upfront debit already paid
  const coreMarginRequired =
    netCost >= 0
      ? Math.max(0, worstLossMagnitude - initialCashRequired, shortStockHaircutFloor)
      : Math.max(0, worstLossMagnitude, shortStockHaircutFloor);

  const totalCapitalRequired = initialCashRequired + coreMarginRequired;

  return {
    initialCashRequired: Number(initialCashRequired.toFixed(2)),
    coreMarginRequired: Number(coreMarginRequired.toFixed(2)),
    totalCapitalRequired: Number(totalCapitalRequired.toFixed(2)),
    bindingScenario: coreMarginRequired > 0 || worstLossMagnitude > 0 ? bindingScenario : null,
    scenariosEvaluated,
  };
}
