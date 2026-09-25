import type { ChunkSource } from './types';

export type ChatTurnResult = { content: string; sources: ChunkSource[] };
type Subscribe = (event: string, callback: (payload: unknown) => void) => Promise<() => void>;

/** Own streaming text and citations for one turn, including listener cleanup on errors. */
export async function runChatTurn(
  subscribe: Subscribe,
  send: () => Promise<void>,
  onUpdate: (result: ChatTurnResult) => void,
): Promise<ChatTurnResult> {
  let result: ChatTurnResult = { content: '', sources: [] };
  const cleanup: Array<() => void> = [];
  try {
    cleanup.push(await subscribe('llm_sources', payload => {
      result = { ...result, sources: payload as ChunkSource[] };
      onUpdate(result);
    }));
    cleanup.push(await subscribe('llm_response', payload => {
      result = { ...result, content: payload as string };
      onUpdate(result);
    }));
    await send();
    return result;
  } finally {
    cleanup.forEach(unlisten => unlisten());
  }
}
