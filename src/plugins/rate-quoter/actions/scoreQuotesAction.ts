import type { Action, ActionResult, HandlerCallback, IAgentRuntime, Memory, State } from '@elizaos/core';
import { z } from 'zod';
import { RateQuoterService } from '../services/rateQuoterService';
import type { Quote, Mode } from '../types';

const scoreSchema = z.object({
  weightLbs: z.number().positive(),
  quotes: z
    .array(
      z.object({
        carrierId: z.string(),
        mode: z.string(),
        origin: z.string(),
        destination: z.string(),
        components: z.object({ baseRate: z.number(), ratePerLb: z.number() }),
        minWeightLbs: z.number().nullable().optional(),
        maxWeightLbs: z.number().nullable().optional(),
      })
    )
    .min(1),
});

const normalizeMode = (value: string): Mode | undefined => {
  if (!value) return undefined;
  const v = value.toLowerCase();
  if (v === 'ltl') return 'LTL';
  if (v === 'ftl') return 'FTL';
  if (v === 'parcel') return 'parcel';
  if (v === 'air') return 'air';
  if (v === 'ocean') return 'ocean';
  return undefined;
};

export const scoreQuotesAction: Action = {
  name: 'score_quotes',
  similes: ['SCORE_QUOTES', 'RANK_QUOTES', 'EVALUATE_QUOTES'],
  description: 'Scores quotes by weight-adjusted cost and returns top 3.',

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
      const payloadRaw = state?.data?.actionPayload || state?.data?.quotesPayload || {};
      const payload = {
        weightLbs: typeof values.weightLbs === 'number' ? values.weightLbs : Number(values.weightLbs),
        quotes: (payloadRaw.quotes || (state?.data?.quotes as Quote[]) || []) as Quote[],
      };

      const { weightLbs, quotes } = await scoreSchema.parseAsync(payload);
      // Coerce modes to Mode union
      const typedQuotes: Quote[] = quotes.map((q: any) => ({
        ...q,
        mode: normalizeMode(q.mode) || 'ocean',
      }));
      const service = runtime.getService(RateQuoterService.serviceType) as RateQuoterService | null
        || new RateQuoterService(runtime);

      const scored = service.scoreQuotesByWeight(typedQuotes, weightLbs);
      const top3 = scored.slice(0, 3);

      const text = top3.length
        ? `Top ${top3.length} options by cost for ${weightLbs} lbs:\n` +
          top3
            .map(
              (q, i) =>
                `${i + 1}. ${q.carrierName || q.carrierId} - $${q.breakdown.totalCostUsd.toFixed(
                  2
                )} (${q.mode})`
            )
            .join('\n')
        : 'No quotes to score.';

      await callback({ text, actions: ['score_quotes'], source: message.content.source });

      return {
        text,
        values: { topCount: top3.length },
        data: { top3 },
        success: true,
      };
    } catch (error) {
      const errText = 'Failed to score quotes';
      await callback({ text: errText, actions: ['score_quotes'], source: message.content.source });
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


