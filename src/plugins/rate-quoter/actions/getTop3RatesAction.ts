import type { Action, ActionResult, HandlerCallback, IAgentRuntime, Memory, State } from '@elizaos/core';
import { z } from 'zod';
import { RateQuoterService } from '../services/rateQuoterService';
import type { Mode } from '../types';

const inputSchema = z.object({
  origin: z.string().min(2),
  destination: z.string().min(2),
  weightLbs: z.number().positive(),
  mode: z.string().optional(),
});

const normalizeMode = (value?: string | null): Mode | undefined => {
  if (!value) return undefined;
  const v = value.toLowerCase();
  if (v === 'ltl') return 'LTL';
  if (v === 'ftl') return 'FTL';
  if (v === 'parcel') return 'parcel';
  if (v === 'air') return 'air';
  if (v === 'ocean') return 'ocean';
  return undefined;
};

export const getTop3RatesAction: Action = {
  name: 'get_top3_rates',
  similes: ['GET_TOP3_RATES', 'BEST_RATES', 'TOP_RATES'],
  description: 'Fetch rates and return the top 3 options by cost for the given weight.',
  validate: async () => true,
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
    _options: any,
    callback: HandlerCallback
  ): Promise<ActionResult> => {
    try {
      const values = state?.values || {};
      const candidate = {
        origin: (values.origin as string) || (values.shipOrigin as string),
        destination: (values.destination as string) || (values.shipDestination as string),
        weightLbs: typeof values.weightLbs === 'number' ? (values.weightLbs as number) : Number(values.weightLbs),
        mode: normalizeMode(values.mode as string),
      };
      const parsed = await inputSchema.parseAsync({
        ...candidate,
        mode: candidate.mode,
      });
      const input = {
        origin: parsed.origin,
        destination: parsed.destination,
        weightLbs: parsed.weightLbs,
        mode: normalizeMode(parsed.mode),
      };

      const service = (runtime.getService(RateQuoterService.serviceType) as RateQuoterService) || new RateQuoterService(runtime);
      const quotes = await service.fetchContractRates(input);
      const scored = service.scoreQuotesByWeight(quotes, input.weightLbs);
      const top3 = scored.slice(0, 3);

      const text = top3.length
        ? `Top ${top3.length} for ${input.origin} → ${input.destination} at ${input.weightLbs} lbs:\n` +
          top3
            .map(
              (q, i) =>
                `${i + 1}. ${q.carrierName || q.carrierId} - $${q.breakdown.totalCostUsd.toFixed(
                  2
                )} (${q.mode}${q.transitDays ? `, ~${q.transitDays}d` : ''})`
            )
            .join('\n')
        : 'No matching rates.';

      await callback({ text, actions: ['get_top3_rates'], source: message.content.source });
      return { text, values: { topCount: top3.length }, data: { top3 }, success: true };
    } catch (error) {
      const errText = 'Failed to get top rates';
      await callback({ text: errText, actions: ['get_top3_rates'], source: message.content.source });
      return {
        text: errText,
        values: { success: false },
        data: { error: error instanceof Error ? error.message : String(error) },
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  },
  examples: [],
};


