import { Service, type IAgentRuntime, logger } from '@elizaos/core';
import type { GetRatesInput, Quote, ScoredQuote, ShipmentSpec } from '../types';

export class RateQuoterService extends Service {
  static serviceType = 'rate-quoter-service';
  capabilityDescription = 'Provides rate fetching and scoring for logistics quoting.';

  constructor(runtime: IAgentRuntime) {
    super(runtime);
  }

  static async start(runtime: IAgentRuntime) {
    const service = new RateQuoterService(runtime);
    return service;
  }

  async stop() {}

  async fetchContractRates(input: GetRatesInput): Promise<Quote[]> {
    try {
      const db = (this.runtime as any).databaseAdapter?.db || (this.runtime as any).db;
      if (!db) {
        logger.warn('No database adapter available; returning empty rates');
        return [];
      }

      const toKey = (s: string) =>
        (s || '')
          .toString()
          .trim();

      const originKey = toKey(input.origin);
      const destKey = toKey(input.destination);

      logger.info(
        {
          origin: originKey,
          destination: destKey,
          mode: input.mode || 'any',
          weightLbs: input.weightLbs,
        },
        'Fetching rates from DB'
      );

      // Simple example schema expectation:
      // table rates(origin text, destination text, mode text, carrier_id text, carrier_name text,
      //   min_weight_lbs numeric, max_weight_lbs numeric, base_rate numeric, rate_per_lb numeric, transit_days int)
      let rows: any[] = [];
      if (input.mode) {
        rows = await db`
          SELECT origin, destination, mode, carrier_id, carrier_name,
                 min_weight_lbs, max_weight_lbs, base_rate, rate_per_lb, transit_days
          FROM rates
          WHERE origin ILIKE ${'%' + originKey + '%'}
            AND destination ILIKE ${'%' + destKey + '%'}
            AND mode = ${input.mode}
          LIMIT 50
        `;
      } else {
        rows = await db`
          SELECT origin, destination, mode, carrier_id, carrier_name,
                 min_weight_lbs, max_weight_lbs, base_rate, rate_per_lb, transit_days
          FROM rates
          WHERE origin ILIKE ${'%' + originKey + '%'}
            AND destination ILIKE ${'%' + destKey + '%'}
          LIMIT 50
        `;
      }

      const mapped: Quote[] = (rows || []).map((r: any) => ({
        origin: r.origin,
        destination: r.destination,
        mode: r.mode,
        carrierId: r.carrier_id,
        carrierName: r.carrier_name,
        minWeightLbs: r.min_weight_lbs ?? null,
        maxWeightLbs: r.max_weight_lbs ?? null,
        components: {
          baseRate: Number(r.base_rate ?? 0),
          ratePerLb: Number(r.rate_per_lb ?? 0),
        },
        transitDays: r.transit_days ?? null,
      }));

      logger.info({ count: mapped.length }, 'DB rates fetched');
      return mapped;
    } catch (error) {
      logger.error({ error }, 'fetchContractRates failed');
      return [];
    }
  }

  scoreQuotesByWeight(quotes: Quote[], weightLbs: number): ScoredQuote[] {
    const scored = quotes.map((q) => {
      const totalCost = (q.components.baseRate || 0) + (q.components.ratePerLb || 0) * weightLbs;
      const costPerLb = weightLbs > 0 ? totalCost / weightLbs : totalCost;

      // Penalty when outside suggested weight brackets
      const belowMin = q.minWeightLbs != null && weightLbs < q.minWeightLbs;
      const aboveMax = q.maxWeightLbs != null && weightLbs > q.maxWeightLbs;
      const weightPenalty = belowMin || aboveMax ? 0.15 : 0; // simple 15% penalty

      const score = totalCost * (1 + weightPenalty);
      return {
        ...q,
        score,
        breakdown: {
          totalCostUsd: totalCost,
          costPerLbUsd: costPerLb,
          weightFitPenalty: weightPenalty,
        },
      } as ScoredQuote;
    });

    return scored.sort((a, b) => a.score - b.score);
  }
}


