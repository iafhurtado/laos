import type { Action, ActionResult, HandlerCallback, IAgentRuntime, Memory, State } from '@elizaos/core';
import { z } from 'zod';
import { RateQuoterService } from '../services/rateQuoterService';
import type { Quote, Mode, ScoringPolicy } from '../types';

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
  policy: z
    .object({
      weights: z.object({
        cost: z.number().nonnegative().optional(),
        time: z.number().nonnegative().optional(),
        reliability: z.number().nonnegative().optional(),
        risk: z.number().nonnegative().optional(),
      }),
      maxTransitDays: z.number().int().positive().optional(),
      preferredCarriers: z.array(z.string()).optional(),
    })
    .partial()
    .optional(),
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
        policy:
          (payloadRaw.policy as Partial<ScoringPolicy>) ||
          (state?.data?.policy as Partial<ScoringPolicy>) ||
          (values?.policy as Partial<ScoringPolicy>) ||
          (values?.scoringPolicy as Partial<ScoringPolicy>) ||
          undefined,
      };

      const parsed = await scoreSchema.parseAsync(payload);
      const weightLbs = parsed.weightLbs;
      const quotes = parsed.quotes;
      const policy = (parsed.policy as Partial<ScoringPolicy> | undefined);
      // Coerce modes to Mode union
      const typedQuotes: Quote[] = quotes.map((q: any) => ({
        ...q,
        mode: normalizeMode(q.mode) || 'ocean',
      }));
      const service = runtime.getService(RateQuoterService.serviceType) as RateQuoterService | null
        || new RateQuoterService(runtime);

      const scored = service.scoreQuotesComposite(typedQuotes, weightLbs, policy);
      const top3 = scored.slice(0, 3);

      const text = top3.length
        ? `Top ${top3.length} scored options for ${weightLbs} lbs (weights: cost=${(policy?.weights?.cost ?? Number(process.env.SCORING_WEIGHTS_COST ?? 0.35))}, time=${(policy?.weights?.time ?? Number(process.env.SCORING_WEIGHTS_TIME ?? 0.25))}, reliability=${(policy?.weights?.reliability ?? Number(process.env.SCORING_WEIGHTS_RELIABILITY ?? 0.30))}, risk=${(policy?.weights?.risk ?? Number(process.env.SCORING_WEIGHTS_RISK ?? 0.10))}):\n` +
          top3
            .map((q, i) => {
              const pct = ((q.breakdown.compositeScore ?? 0) * 100).toFixed(1);
              return `${i + 1}. ${q.carrierName || q.carrierId} - $${q.breakdown.totalCostUsd.toFixed(2)} (${q.mode}) • Score ${pct}%`;
            })
            .join('\n')
        : 'No quotes to score.';

      await callback({ text, actions: ['score_quotes'], source: message.content.source });

      return {
        text,
        values: { topCount: top3.length },
        data: { actionName: 'SCORE_QUOTES', top3, policy: policy ?? null },
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


