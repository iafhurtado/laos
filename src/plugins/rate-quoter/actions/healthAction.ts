import type { Action, ActionResult, HandlerCallback, IAgentRuntime, Memory, State } from '@elizaos/core';
import { logger } from '@elizaos/core';
import { z } from 'zod';
import { RateQuoterService } from '../services/rateQuoterService';

// Minimal input allowing optional echo context for testing logs end-to-end
const healthInputSchema = z.object({
  echo: z.string().optional(),
});

export const healthAction: Action = {
  name: 'health_check',
  similes: ['HEALTH', 'PING', 'STATUS', 'SYSTEM_HEALTH'],
  description: 'Performs a simple health check for the rate-quoter stack and logs lifecycle steps.',

  validate: async (_runtime: IAgentRuntime, _message: Memory, _state: State): Promise<boolean> => {
    // Always allow invocation so we can observe logs; schema is enforced in handler
    logger.info('health_check.validate invoked');
    return true;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
    _options: any,
    callback: HandlerCallback,
    _responses: Memory[]
  ): Promise<ActionResult> => {
    const correlationId = `health-${message.id}`;
    logger.info({ correlationId, stateKeys: Object.keys(state?.values || {}) }, 'health_check.handler start');

    try {
      // Parse lightweight input from state.values if present
      const values = state?.values || {};
      const parsed = await healthInputSchema.safeParseAsync({ echo: values.echo as string | undefined });
      if (!parsed.success) {
        logger.warn({ correlationId, issues: parsed.error.issues }, 'health_check input validation failed');
      }

      // Try to acquire service instance
      const service = (runtime.getService(RateQuoterService.serviceType) as RateQuoterService | null) || null;
      const serviceAvailable = !!service;
      logger.info({ correlationId, serviceAvailable }, 'health_check service availability');

      // Basic DB reachability signal via fetchContractRates with harmless noop lane (will short-circuit if no DB)
      let dbReachable = false;
      let dbSampleCount = 0;
      try {
        if (service) {
          const quotes = await service.fetchContractRates({ origin: 'HEALTH', destination: 'HEALTH', weightLbs: 1 });
          dbSampleCount = quotes.length;
          dbReachable = true; // If call returns (even empty), path is functioning
        }
      } catch (e) {
        logger.warn({ correlationId, error: e instanceof Error ? e.message : String(e) }, 'health_check DB probe error');
      }

      const summary = serviceAvailable
        ? dbReachable
          ? `RateQuoterService OK; DB probe executed (${dbSampleCount} rows).`
          : 'RateQuoterService OK; DB probe not reachable.'
        : 'RateQuoterService not registered.';

      const echoNote = parsed.success && parsed.data.echo ? ` Echo: ${parsed.data.echo}` : '';
      const text = `Health check: ${summary}.${echoNote}`;

      await callback({ text, actions: ['health_check'], source: message.content.source });

      logger.info({ correlationId, text }, 'health_check.handler success');

      return {
        text,
        values: { serviceAvailable, dbReachable, dbSampleCount },
        data: {
          actionName: 'HEALTH_CHECK',
          correlationId,
          serviceAvailable,
          dbReachable,
          dbSampleCount,
          timestamp: Date.now(),
        },
        success: true,
      };
    } catch (error) {
      logger.error({ correlationId, error }, 'health_check.handler error');
      const text = 'Health check failed.';
      await callback({ text, actions: ['health_check'], source: message.content.source });
      return {
        text,
        values: { success: false },
        data: {
          actionName: 'HEALTH_CHECK',
          correlationId,
          error: error instanceof Error ? error.message : String(error),
        },
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  },

  examples: [
    [
      {
        name: '{{name1}}',
        content: { text: 'run a health check' },
      },
      {
        name: '{{name2}}',
        content: { text: 'Health check: RateQuoterService OK; DB probe executed (0 rows).', actions: ['health_check'] },
      },
    ],
  ],
};


