import type { Action, ActionResult, HandlerCallback, IAgentRuntime, Memory, State } from '@elizaos/core';
import { z } from 'zod';
import { RateQuoterService } from '../services/rateQuoterService';
import type { GetRatesInput, Mode } from '../types';

const getRatesSchema = z.object({
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

export const getRatesAction: Action = {
  name: 'get_rates',
  similes: ['GET_RATES', 'FETCH_RATES', 'GET_QUOTES'],
  description: 'Fetches rates from SQL by lane and optional mode.',

  validate: async (_runtime: IAgentRuntime, _message: Memory, state: State): Promise<boolean> => {
    // Allow LLM/caller to invoke; strict validation occurs in handler using zod
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
    try {
      // Expect minimal args in message text or state.values
      const values = state?.values || {};
      const candidate: Partial<GetRatesInput> = {
        origin: (values.origin as string) || (values.shipOrigin as string),
        destination: (values.destination as string) || (values.shipDestination as string),
        weightLbs: typeof values.weightLbs === 'number' ? (values.weightLbs as number) : Number(values.weightLbs),
        mode: normalizeMode(values.mode as string),
      };

      const parsed = await getRatesSchema.parseAsync({
        ...candidate,
        mode: candidate.mode,
      });
      const input: GetRatesInput = {
        origin: parsed.origin,
        destination: parsed.destination,
        weightLbs: parsed.weightLbs,
        mode: normalizeMode(parsed.mode),
      };
      const service = runtime.getService(RateQuoterService.serviceType) as RateQuoterService | null
        || new RateQuoterService(runtime);

      const quotes = await service.fetchContractRates(input);

      const text = quotes.length
        ? `Found ${quotes.length} quotes for ${input.origin} → ${input.destination}${input.mode ? ' (' + input.mode + ')' : ''}.`
        : `No quotes found for ${input.origin} → ${input.destination}.`;

      await callback({ text, actions: ['get_rates'], source: message.content.source });

      return {
        text,
        values: { count: quotes.length },
        data: { quotes },
        success: true,
      };
    } catch (error) {
      const errText = 'Failed to fetch rates';
      await callback({ text: errText, actions: ['get_rates'], source: message.content.source });
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


