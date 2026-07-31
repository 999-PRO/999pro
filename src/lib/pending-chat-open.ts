// v11-fix: Module-level pending state for opening a conversation.
//
// Problem: SmartShareSheet dispatches `chat:open-conversation` via window
// CustomEvent, but ChatView is lazy-loaded via next/dynamic and may not
// have mounted + registered its event listener by the time the event fires.
// The event is lost, and the user stays on the chat list instead of seeing
// the conversation they just sent a product to.
//
// Solution: SmartShareSheet sets the pending conversation ID here BEFORE
// dispatching the navigate event. ChatView reads and clears it on mount
// (in its initial useEffect). This is 100% reliable — no timing dependencies.

let pendingConvId: string | null = null

export function setPendingOpenConversation(id: string | null): void {
  pendingConvId = id
}

export function getPendingOpenConversation(): string | null {
  const id = pendingConvId
  pendingConvId = null  // drain — only read once
  return id
}
