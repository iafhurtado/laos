import type { Plugin } from '@elizaos/core';
import { logger, ModelType } from '@elizaos/core';
import { z } from 'zod';
import { RateQuoterService } from './services/rateQuoterService';
import { getRatesAction } from './actions/getRatesAction';
import { scoreQuotesAction } from './actions/scoreQuotesAction';
import { getTop3RatesAction } from './actions/getTop3RatesAction';

const configSchema = z.object({
  RATE_LIMIT_PER_MINUTE: z.coerce.number().default(120),
  MAX_CONCURRENT_REQUESTS: z.coerce.number().default(8),
  CACHE_TTL_SECONDS: z.coerce.number().default(300),
});

export const rateQuoterPlugin: Plugin = {
  name: '@elizaos/plugin-rate-quoter',
  description: 'Rate quoting, scoring, and tendering for logistics',
  config: {
    RATE_LIMIT_PER_MINUTE: process.env.RATE_LIMIT_PER_MINUTE,
    MAX_CONCURRENT_REQUESTS: process.env.MAX_CONCURRENT_REQUESTS,
    CACHE_TTL_SECONDS: process.env.CACHE_TTL_SECONDS,
  },
  async init(config: Record<string, any>) {
    const validated = await configSchema.parseAsync(config);
    Object.entries(validated).forEach(([k, v]) => (process.env[k] = String(v)));
    logger.info('rate-quoter plugin initialized');
  },
  services: [RateQuoterService],
  actions: [getRatesAction, scoreQuotesAction, getTop3RatesAction],
  providers: [],
  evaluators: [],
  routes: [],
  events: {},
};

export default rateQuoterPlugin;


