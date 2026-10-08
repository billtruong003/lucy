// Channels — message bus mỏng (msg-as-data). Tab Channels của hub đọc cái này.
import type { Store } from './store'
import type { ChannelKind, ChannelMsg } from './types'

export function post(store: Store, channel: string, author: string, kind: ChannelKind, text: string, cardId?: string): ChannelMsg {
  const m: ChannelMsg = { ts: Date.now(), channel, author, kind, text, cardId }
  store.postMessage(m)
  return m
}

// thread riêng cho mỗi card (nơi agent của card đó chatter/report)
export function threadOf(cardId: string): string {
  return `card-${cardId}`
}
