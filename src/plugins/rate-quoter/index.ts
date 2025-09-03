import type { Plugin } from '@elizaos/core';
import { logger, ModelType } from '@elizaos/core';
import { z } from 'zod';
import { RateQuoterService } from './services/rateQuoterService';
import { getRatesAction } from './actions/getRatesAction';
import { scoreQuotesAction } from './actions/scoreQuotesAction';
import { getTop3RatesAction } from './actions/getTop3RatesAction';
import { updateEntityAction } from './actions/updateEntityAction';

const configSchema = z.object({
  RATE_LIMIT_PER_MINUTE: z.coerce.number().default(120),
  MAX_CONCURRENT_REQUESTS: z.coerce.number().default(8),
  CACHE_TTL_SECONDS: z.coerce.number().default(300),
  SCORING_WEIGHTS_COST: z.coerce.number().default(0.35),
  SCORING_WEIGHTS_TIME: z.coerce.number().default(0.25),
  SCORING_WEIGHTS_RELIABILITY: z.coerce.number().default(0.30),
  SCORING_WEIGHTS_RISK: z.coerce.number().default(0.10),
  SURCHARGES_ENABLED: z.coerce.boolean().default(true),
});

export const rateQuoterPlugin: Plugin = {
  name: '@elizaos/plugin-rate-quoter',
  description: 'Rate quoting, scoring, and tendering for logistics',
  config: {
    RATE_LIMIT_PER_MINUTE: process.env.RATE_LIMIT_PER_MINUTE,
    MAX_CONCURRENT_REQUESTS: process.env.MAX_CONCURRENT_REQUESTS,
    CACHE_TTL_SECONDS: process.env.CACHE_TTL_SECONDS,
    SCORING_WEIGHTS_COST: process.env.SCORING_WEIGHTS_COST,
    SCORING_WEIGHTS_TIME: process.env.SCORING_WEIGHTS_TIME,
    SCORING_WEIGHTS_RELIABILITY: process.env.SCORING_WEIGHTS_RELIABILITY,
    SCORING_WEIGHTS_RISK: process.env.SCORING_WEIGHTS_RISK,
    SURCHARGES_ENABLED: process.env.SURCHARGES_ENABLED,
  },
  async init(config: Record<string, any>) {
    const validated = await configSchema.parseAsync(config);
    Object.entries(validated).forEach(([k, v]) => (process.env[k] = String(v)));
    logger.info('rate-quoter plugin initialized');
  },
  services: [RateQuoterService],
  actions: [getRatesAction, scoreQuotesAction, getTop3RatesAction, updateEntityAction],
  providers: [],
  evaluators: [],
  routes: [],
  events: {},
};

export default rateQuoterPlugin;


