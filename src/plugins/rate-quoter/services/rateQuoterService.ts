import { Service, type IAgentRuntime, logger } from '@elizaos/core';
import type { GetRatesInput, Quote, ScoredQuote, ScoringPolicy, ScoringPolicyWeights, Mode, ChargeBasis } from '../types';

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

      // Neon schema (introspected):
      // public.rates(id uuid, carrier_id uuid, origin text, destination text,
      //   mode enum, rate_type enum, base_rate numeric, fuel_surcharge numeric,
      //   accessorials jsonb, currency text, valid_from ts, valid_to ts,
      //   transit_days int, min_weight numeric, max_weight numeric,
      //   contract_number text, is_active boolean, created_at ts, updated_at ts)
      // public.carriers(id uuid, name text, code text, mode text, country text, is_active boolean, ...)
      let rows: any[] = [];
      if (input.mode) {
        rows = await db`
          SELECT r.origin,
                 r.destination,
                 r.mode::text AS mode,
                 r.carrier_id,
                 c.name AS carrier_name,
                 r.min_weight,
                 r.max_weight,
                 r.base_rate,
                 r.charge_basis::text as charge_basis,
                 r.fuel_surcharge,
                 r.currency,
                 r.transit_days
          FROM rates r
          LEFT JOIN carriers c ON c.id = r.carrier_id
          WHERE r.origin ILIKE ${'%' + originKey + '%'}
            AND r.destination ILIKE ${'%' + destKey + '%'}
            AND r.mode::text = ${input.mode}
            AND (now() BETWEEN r.valid_from AND r.valid_to)
            AND (r.is_active = true OR r.is_active IS NULL)
          LIMIT 50
        `;
      } else {
        rows = await db`
          SELECT r.origin,
                 r.destination,
                 r.mode::text AS mode,
                 r.carrier_id,
                 c.name AS carrier_name,
                 r.min_weight,
                 r.max_weight,
                 r.base_rate,
                 r.charge_basis::text as charge_basis,
                 r.fuel_surcharge,
                 r.currency,
                 r.transit_days
          FROM rates r
          LEFT JOIN carriers c ON c.id = r.carrier_id
          WHERE r.origin ILIKE ${'%' + originKey + '%'}
            AND r.destination ILIKE ${'%' + destKey + '%'}
            AND (now() BETWEEN r.valid_from AND r.valid_to)
            AND (r.is_active = true OR r.is_active IS NULL)
          LIMIT 50
        `;
      }

      const normalizeMode = (value?: string | null): Mode => {
        const v = (value || '').toLowerCase();
        if (v === 'ltl') return 'LTL';
        if (v === 'ftl') return 'FTL';
        if (v === 'parcel') return 'parcel';
        if (v === 'air') return 'air';
        if (v === 'ocean') return 'ocean';
        return 'ocean';
      };

      const mapped: Quote[] = (rows || []).map((r: any) => ({
        origin: r.origin,
        destination: r.destination,
        mode: normalizeMode(r.mode as string),
        carrierId: String(r.carrier_id),
        carrierName: r.carrier_name || undefined,
        minWeightLbs: r.min_weight != null ? Number(r.min_weight) : null,
        maxWeightLbs: r.max_weight != null ? Number(r.max_weight) : null,
        components: {
          baseRate: Number(r.base_rate ?? 0),
          // Schema does not provide per-lb; keep zero to reflect flat/base pricing
          ratePerLb: 0,
        },
        transitDays: r.transit_days != null ? Number(r.transit_days) : null,
        chargeBasis: ((r.charge_basis as string) || 'per_shipment') as ChargeBasis,
        fuelPct: r.fuel_surcharge != null ? Number(r.fuel_surcharge) : 0,
        currency: (r.currency as string) || 'EUR',
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
      const totalCost = this.computeTotal(q, weightLbs);
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
          currency: q.currency,
          baseAmount: this.computeBase(q, weightLbs),
          fuelPctApplied: q.fuelPct ?? 0,
        },
      } as ScoredQuote;
    });

    return scored.sort((a, b) => a.score - b.score);
  }

  private computeBase(q: Quote, weightLbs: number): number {
    const basis = q.chargeBasis || 'per_shipment';
    if (basis === 'per_shipment') return q.components.baseRate || 0;
    if (basis === 'per_lb') return (q.components.baseRate || 0) * weightLbs;
    if (basis === 'per_kg') return (q.components.baseRate || 0) * (weightLbs * 0.45359237);
    if (basis === 'per_cbm') return q.components.baseRate || 0; // requires volume later
    return q.components.baseRate || 0;
  }

  private computeTotal(q: Quote, weightLbs: number): number {
    const baseAmount = this.computeBase(q, weightLbs);
    const fuelPct = (q.fuelPct ?? 0) / 100;
    let total = baseAmount * (1 + (fuelPct > 0 ? fuelPct : 0));
    // Optional: apply generic surcharges if enabled (simple fixed percent blend)
    const surchargesEnabled = String(process.env.SURCHARGES_ENABLED || 'true') === 'true';
    if (surchargesEnabled) {
      // For MVP, apply a conservative 2% generic and 75 EUR flat if mode is ocean/air
      const modeStr = String(q.mode).toLowerCase();
      const genericPct = 0.02;
      const flat = (modeStr === 'ocean' || modeStr === 'air') ? 75 : 0;
      total = total * (1 + genericPct) + flat;
    }
    return total;
  }

  private normalizeWeights(weights?: Partial<ScoringPolicyWeights>): ScoringPolicyWeights {
    const defaults: ScoringPolicyWeights = {
      cost: Number(process.env.SCORING_WEIGHTS_COST ?? 0.35),
      time: Number(process.env.SCORING_WEIGHTS_TIME ?? 0.25),
      reliability: Number(process.env.SCORING_WEIGHTS_RELIABILITY ?? 0.30),
      risk: Number(process.env.SCORING_WEIGHTS_RISK ?? 0.10),
    };

    const merged: ScoringPolicyWeights = {
      cost: weights?.cost ?? defaults.cost,
      time: weights?.time ?? defaults.time,
      reliability: weights?.reliability ?? defaults.reliability,
      risk: weights?.risk ?? defaults.risk,
    };

    const sum = merged.cost + merged.time + merged.reliability + merged.risk;
    if (sum <= 0) return defaults;
    return {
      cost: merged.cost / sum,
      time: merged.time / sum,
      reliability: merged.reliability / sum,
      risk: merged.risk / sum,
    };
  }

  scoreQuotesComposite(
    quotes: Quote[],
    weightLbs: number,
    policy?: Partial<ScoringPolicy>
  ): ScoredQuote[] {
    if (!quotes?.length) return [];

    // Precompute cost metrics
    const totals = quotes.map((q) => this.computeTotal(q, weightLbs));
    const minCost = Math.min(...totals);
    const maxCost = Math.max(...totals);

    // Precompute time metrics when available
    const transitValues = quotes.map((q) => (typeof q.transitDays === 'number' && q.transitDays > 0 ? q.transitDays : null)).filter((v): v is number => v != null);
    const hasTransit = transitValues.length > 0;
    const minTransit = hasTransit ? Math.min(...transitValues) : 0;
    const maxTransit = hasTransit ? Math.max(...transitValues) : 1;

    const weights = this.normalizeWeights(policy?.weights);

    const reliableCarriers = new Set(['FedEx', 'UPS', 'DHL', 'TForce', 'XPO', 'CH Robinson']);
    const modeRisk: Record<string, number> = {
      air: 0.1,
      parcel: 0.1,
      LTL: 0.2,
      FTL: 0.15,
      ocean: 0.3,
    };

    const scored = quotes.map((q, idx) => {
      const totalCost = totals[idx];
      const costPerLb = weightLbs > 0 ? totalCost / weightLbs : totalCost;

      // Normalize cost to 0..1 (lower cost → higher score)
      let costScore = 0.5;
      if (maxCost > minCost) costScore = 1 - (totalCost - minCost) / (maxCost - minCost);

      // Time score: faster (lower days) → higher score
      let timeScore = 0.5;
      if (hasTransit) {
        const t = q.transitDays ?? maxTransit;
        timeScore = maxTransit > minTransit ? 1 - (t - minTransit) / (maxTransit - minTransit) : 0.5;
      }

      // Reliability: simple heuristic
      let reliabilityScore = 0.5;
      if (q.carrierName && reliableCarriers.has(q.carrierName)) reliabilityScore += 0.25;
      const withinBracket =
        (q.minWeightLbs == null || weightLbs >= q.minWeightLbs) && (q.maxWeightLbs == null || weightLbs <= q.maxWeightLbs);
      if (withinBracket) reliabilityScore += 0.15;
      reliabilityScore = Math.max(0, Math.min(1, reliabilityScore));

      // Risk: based on mode baseline (lower risk → higher score)
      const modeKey = String(q.mode) as keyof typeof modeRisk;
      const riskBase = modeRisk[modeKey] ?? 0.2;
      const riskScore = Math.max(0, Math.min(1, 1 - riskBase));

      const composite =
        costScore * weights.cost + timeScore * weights.time + reliabilityScore * weights.reliability + riskScore * weights.risk;

      return {
        ...q,
        score: 1 - composite, // maintain lower-is-better for backward-compat
        breakdown: {
          totalCostUsd: totalCost,
          costPerLbUsd: costPerLb,
          weightFitPenalty: withinBracket ? 0 : 0.15,
          costScore,
          timeScore,
          reliabilityScore,
          riskScore,
          compositeScore: composite,
          weights,
        },
      } as ScoredQuote;
    });

    // Sort by compositeScore descending (best first)
    return scored.sort((a, b) => (b.breakdown.compositeScore ?? 0) - (a.breakdown.compositeScore ?? 0));
  }
}


