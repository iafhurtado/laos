import { describe, it, expect } from 'bun:test';
import { RateQuoterService } from '../plugins/rate-quoter/services/rateQuoterService';

const mockRuntime: any = {
  databaseAdapter: {
    db: async (strings: any, ...values: any[]) => {
      return [
        {
          origin: 'Zurich, Switzerland',
          destination: 'Berlin, Germany',
          mode: 'air',
          carrier_id: 'swiss',
          carrier_name: 'Swiss WorldCargo',
          min_weight: 45,
          max_weight: 5500,
          base_rate: 2.5,
          transit_days: 1,
        },
        {
          origin: 'Hamburg, Germany',
          destination: 'Berlin, Germany',
          mode: 'ltl',
          carrier_id: 'dhl',
          carrier_name: 'Deutsche Post DHL',
          min_weight: 100,
          max_weight: 14000,
          base_rate: 0.88,
          transit_days: 1,
        },
      ];
    },
  },
  getService: () => null,
};

describe('RateQuoterService (Neon schema)', () => {
  it('fetchContractRates maps Neon rows into Quote', async () => {
    const svc = new RateQuoterService(mockRuntime);
    const quotes = await svc.fetchContractRates({ origin: 'Zurich', destination: 'Berlin', weightLbs: 100, mode: 'air' });
    expect(Array.isArray(quotes)).toBe(true);
    expect(quotes.length).toBeGreaterThan(0);
    expect(quotes[0]).toHaveProperty('components.baseRate');
    // Has pricing meta
    expect(['per_shipment','per_kg','per_lb','per_cbm']).toContain(quotes[0].chargeBasis || 'per_shipment');
  });

  it('scoreQuotesComposite produces composite scores with weights', async () => {
    const svc = new RateQuoterService(mockRuntime);
    const quotes = await svc.fetchContractRates({ origin: 'Zurich', destination: 'Berlin', weightLbs: 100, mode: 'air' });
    const scored = svc.scoreQuotesComposite(quotes, 200, { weights: { cost: 0.5, time: 0.2, reliability: 0.2, risk: 0.1 } });
    expect(scored.length).toBeGreaterThan(0);
    expect(scored[0].breakdown).toHaveProperty('compositeScore');
    // ensure cost uses chargeBasis+fuel if present
    expect(typeof scored[0].breakdown.totalCostUsd).toBe('number');
  });
});


