// Who else has the trip open, and what they're editing, from Supabase
// Realtime Presence. Nothing here touches the database: each open tab tracks
// a small payload on the trip's presence channel, and every tab turns the
// channel's state into peers to show.
//
// Payloads come from other clients, so they're checked before use and
// anything malformed is ignored.

import type { CSSProperties } from 'react'

/** What someone has open: a stop's edit form, or adding a stop to a day. */
export type PresenceFocus = { stopId: string } | { dayId: string }

/** What each tab tracks on the trip's presence channel. */
export type PresencePayload = {
  user_id: string
  name: string
  /** 1-based index into the presence colours (`--presence-color-N`). */
  color: number
  focus: PresenceFocus | null
}

/** Someone else viewing the trip, merged across their open tabs. */
export type Peer = {
  userId: string
  name: string
  color: number
  /** What they're editing, in any of their tabs. */
  focus: PresenceFocus[]
}

/** Peers grouped by what they're editing. */
export type PresenceIndex = {
  stops: Map<string, Peer[]>
  days: Map<string, Peer[]>
}

/** Keep in sync with `--presence-color-N` in index.css. */
export const PRESENCE_COLOR_COUNT = 6

/** A colour for a user, the same in every browser. */
export function presenceColor(userId: string): number {
  // FNV-1a: small, and spreads similar UUIDs across the palette.
  let hash = 0x811c9dc5
  for (let i = 0; i < userId.length; i++) {
    hash ^= userId.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return ((hash >>> 0) % PRESENCE_COLOR_COUNT) + 1
}

/** The CSS colour for a presence colour index. */
export function presenceColorVar(color: number) {
  return `var(--presence-color-${color})`
}

/** Sets `--presence-color` on a stop or day being edited by `peers`. */
export function presenceOutline(
  peers: Peer[] | undefined,
): CSSProperties | undefined {
  return peers?.length
    ? ({
        '--presence-color': presenceColorVar(peers[0].color),
      } as CSSProperties)
    : undefined
}

/** Up to two initials for an avatar, e.g. "Pat Lee" → "PL". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  const letters =
    words.length === 1 ? [words[0]] : [words[0], words[words.length - 1]]
  return letters
    .map((w) => Array.from(w)[0] ?? '')
    .join('')
    .toUpperCase()
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function parseFocus(value: unknown): PresenceFocus | null {
  if (typeof value !== 'object' || value === null) return null
  const focus = value as Record<string, unknown>
  if (isString(focus.stopId)) return { stopId: focus.stopId }
  if (isString(focus.dayId)) return { dayId: focus.dayId }
  return null
}

/** A tracked payload, or null if it's malformed. */
export function parsePayload(value: unknown): PresencePayload | null {
  if (typeof value !== 'object' || value === null) return null
  const p = value as Record<string, unknown>
  if (!isString(p.user_id)) return null
  const color =
    typeof p.color === 'number' &&
    Number.isInteger(p.color) &&
    p.color >= 1 &&
    p.color <= PRESENCE_COLOR_COUNT
      ? p.color
      : presenceColor(p.user_id)
  return {
    user_id: p.user_id,
    name: (typeof p.name === 'string' && p.name.trim()) || 'Unnamed',
    color,
    focus: parseFocus(p.focus),
  }
}

function sameFocus(a: PresenceFocus, b: PresenceFocus) {
  return 'stopId' in a
    ? 'stopId' in b && a.stopId === b.stopId
    : 'dayId' in b && a.dayId === b.dayId
}

/**
 * Everyone but `ownUserId` in a presence state (as returned by
 * `channel.presenceState()`), one entry per person however many tabs they
 * have open, sorted by name.
 */
export function peersFromState(
  state: Record<string, unknown[]>,
  ownUserId: string | undefined,
): Peer[] {
  const peers = new Map<string, Peer>()
  for (const entries of Object.values(state)) {
    for (const entry of entries) {
      const payload = parsePayload(entry)
      if (!payload || payload.user_id === ownUserId) continue
      let peer = peers.get(payload.user_id)
      if (!peer) {
        peer = {
          userId: payload.user_id,
          name: payload.name,
          color: payload.color,
          focus: [],
        }
        peers.set(payload.user_id, peer)
      }
      const { focus } = payload
      if (focus && !peer.focus.some((f) => sameFocus(f, focus)))
        peer.focus.push(focus)
    }
  }
  return [...peers.values()].sort(
    (a, b) =>
      a.name.localeCompare(b.name) ||
      (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0),
  )
}

/** Peers grouped by the stops and days they're editing. */
export function indexPresence(peers: Peer[]): PresenceIndex {
  const index: PresenceIndex = { stops: new Map(), days: new Map() }
  const add = (map: Map<string, Peer[]>, id: string, peer: Peer) => {
    const list = map.get(id)
    if (list) list.push(peer)
    else map.set(id, [peer])
  }
  for (const peer of peers) {
    for (const focus of peer.focus) {
      if ('stopId' in focus) add(index.stops, focus.stopId, peer)
      else add(index.days, focus.dayId, peer)
    }
  }
  return index
}

/** "Pat", "Pat and Zoe", "Ann, Pat and Zoe". */
export function listNames(peers: Pick<Peer, 'name'>[]): string {
  const names = peers.map((p) => p.name)
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}
