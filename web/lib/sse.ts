export type SSEClient = ReadableStreamDefaultController<Uint8Array>;

export const encoder = new TextEncoder();
export const sseClients = new Set<SSEClient>();

export function broadcast(payload: Record<string, unknown>): void {
  const frame = encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
  for (const ctrl of sseClients) {
    try {
      ctrl.enqueue(frame);
    } catch {
      sseClients.delete(ctrl);
    }
  }
}
