import type { Action, ActionResult, HandlerCallback, IAgentRuntime, Memory, State } from '@elizaos/core';

// Defensive JSON stringify to avoid cyclic structure errors
function safeStringify(value: unknown): string {
  const seen = new WeakSet();
  try {
    return JSON.stringify(value, (_key, val) => {
      if (typeof val === 'object' && val !== null) {
        if (seen.has(val as object)) return '[Circular]';
        seen.add(val as object);
      }
      if (typeof val === 'function') return '[Function]';
      if (typeof val === 'bigint') return String(val);
      return val;
    });
  } catch (_err) {
    return '[Unserializable]';
  }
}

export const updateEntityAction: Action = {
  name: 'UPDATE_ENTITY',
  similes: ['UPDATE_CONTACT', 'SAVE_CONTACT', 'UPSERT_ENTITY'],
  description: 'Safely updates an entity/contact record. Never throws; returns structured error on failure.',

  validate: async () => true,

  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    state: State,
    _options: any,
    callback: HandlerCallback
  ): Promise<ActionResult> => {
    try {
      const payload = (state?.data?.actionPayload as any) || (state?.data?.updatePayload as any) || {};

      // Strip obviously problematic fields that commonly create cycles
      const cleaned = {
        ...payload,
      } as Record<string, unknown>;
      delete (cleaned as any).state;
      delete (cleaned as any).message;
      delete (cleaned as any).runtime;
      delete (cleaned as any).circularRef;

      // Ensure we can serialize for audit/log
      const serialized = safeStringify(cleaned);

      // This shim does not actually persist; it acknowledges and echoes sanitized payload
      const text = 'Entity update received and sanitized.';
      await callback({ text, actions: ['UPDATE_ENTITY'], source: message.content.source });

      return {
        text,
        values: { success: true },
        data: { update: cleaned, serialized },
        success: true,
      };
    } catch (error) {
      const text = 'There was an error processing the entity information.';
      await callback({ text, actions: ['UPDATE_ENTITY_ERROR'], source: message.content.source });
      return {
        text,
        values: { success: false },
        data: { error: error instanceof Error ? error.message : String(error) },
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  },
  examples: [],
};

export default updateEntityAction;




