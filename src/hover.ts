export type HoverState = { title: string; detail: string; messageId?: string } | null;

export function nextHover(current: HoverState, incoming: HoverState): HoverState {
  if (current === incoming) return current;
  if (!current || !incoming) return incoming;
  if (current.title === incoming.title && current.detail === incoming.detail && current.messageId === incoming.messageId) {
    return current;
  }
  return incoming;
}
