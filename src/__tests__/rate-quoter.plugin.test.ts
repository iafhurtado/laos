import { describe, it, expect } from 'bun:test';
import plugin from '../plugins/rate-quoter/index';
import { RateQuoterService } from '../plugins/rate-quoter/services/rateQuoterService';

describe('rate-quoter plugin', () => {
  it('should have correct name and actions', () => {
    expect(plugin.name).toBe('@elizaos/plugin-rate-quoter');
    expect(plugin.services?.[0]).toBe(RateQuoterService);
    const actionNames = (plugin.actions || []).map((a) => a.name).sort();
    expect(actionNames).toContain('get_rates');
    expect(actionNames).toContain('score_quotes');
    expect(actionNames).toContain('get_top3_rates');
  });
});


