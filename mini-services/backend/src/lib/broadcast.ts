// v16.5: Broadcast content-change events to ALL connected clients so the
// main app refetches instantly after Studio saves. Non-critical — failures
// are swallowed (save already succeeded in the DB).

import { getIo } from '../socket/handlers.js'

export function broadcastChanged(event: string, payload?: unknown): void {
  try {
    const io = getIo()
    if (io) io.emit(event, payload)
  } catch {
    // non-critical — save already succeeded
  }
}
