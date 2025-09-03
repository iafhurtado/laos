import { describe, it, expect } from 'bun:test';
import { getRatesAction } from '../plugins/rate-quoter/actions/getRatesAction';
import { scoreQuotesAction } from '../plugins/rate-quoter/actions/scoreQuotesAction';
import { getTop3RatesAction } from '../plugins/rate-quoter/actions/getTop3RatesAction';
import { createMockMessage, createMockState } from './utils/core-test-utils';
import { RateQuoterService } from '../plugins/rate-quoter/services/rateQuoterService';

const mockRuntime: any = {
  databaseAdapter: {
    db: async (strings: any, ...values: any[]) => {
      // Return Neon-shaped rows expected by updated service
      return [
        {
          origin: 'Ningbo',
          destination: 'Hamburg',
          mode: 'ocean',
          carrier_id: 'msk',
          carrier_name: 'Maersk',
          min_weight: 1000,
          max_weight: 30000,
          base_rate: 1200,
          transit_days: 32,
        },
        {
          origin: 'Ningbo',
          destination: 'Hamburg',
          mode: 'air',
          carrier_id: 'lh',
          carrier_name: 'Lufthansa',
          min_weight: 100,
          max_weight: 5000,
          base_rate: 900,
          transit_days: 4,
        },
      ];
    },
  },
  getService: () => null,
};

describe('rate-quoter actions', () => {
  it('get_rates returns quotes from DB', async () => {
    const message = createMockMessage('');
    const state = createMockState();
    state.values = { origin: 'Ningbo', destination: 'Hamburg', weightLbs: 2000 };

    let cbText = '';
    const result = await getRatesAction.handler(
      mockRuntime,
      message,
      state,
      {},
      async (content) => {
        cbText = content.text || '';
      },
      []
    );

    expect(result.success).toBe(true);
    expect(result.data?.quotes?.length).toBeGreaterThan(0);
    expect(cbText).toContain('Found');
  });

  it('score_quotes ranks top 3', async () => {
    const message = createMockMessage('');
    const state = createMockState();
    state.values = { weightLbs: 2000 };
    state.data = {
      quotesPayload: {
        quotes: [
          {
            origin: 'Ningbo',
            destination: 'Hamburg',
            mode: 'ocean',
            carrierId: 'msk',
            components: { baseRate: 1200, ratePerLb: 0.15 },
          },
          {
            origin: 'Ningbo',
            destination: 'Hamburg',
            mode: 'air',
            carrierId: 'lh',
            components: { baseRate: 900, ratePerLb: 1.1 },
          },
        ],
      },
    } as any;

    let cbText = '';
    const result = await scoreQuotesAction.handler(
      mockRuntime,
      message,
      state,
      {},
      async (content) => {
        cbText = content.text || '';
      }
    );

    expect(result.success).toBe(true);
    expect(result.data?.top3?.length).toBeGreaterThan(0);
    expect(cbText).toContain('Top');
  });

  it('get_top3_rates orchestrates fetch and score', async () => {
    const message = createMockMessage('');
    const state = createMockState();
    state.values = { origin: 'Ningbo', destination: 'Hamburg', weightLbs: 2000 };

    let cbText = '';
    const result = await getTop3RatesAction.handler(
      mockRuntime,
      message,
      state,
      {},
      async (content) => {
        cbText = content.text || '';
      }
    );

    expect(result.success).toBe(true);
    expect(result.data?.top3?.length).toBeGreaterThan(0);
    expect(cbText).toContain('Top');
  });
});


