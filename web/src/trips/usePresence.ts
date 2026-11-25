import type { RealtimeChannel } from '@supabase/supabase-js'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { supabase } from '../lib/supabase'
import {
  indexPresence,
  peersFromState,
  presenceColor,
  type Peer,
  type PresenceFocus,
  type PresenceIndex,
  type PresencePayload,
} from './presence'

// Channels still being removed, by topic. supabase.channel() returns an
// existing channel with the same topic, and presence needs every tab on the
// same topic, so a new subscription (e.g. StrictMode's remount, or reopening
// the trip quickly) waits for the old one to finish leaving.
const leaving = new Map<string, Promise<unknown>>()

/**
 * Joins the trip's presence channel while the page is open, tracking the
 * signed-in user's name, colour and `focus` (what they're editing). Returns
 * everyone else on the trip, and who's editing which stop or day.
 *
 * The channel is a public Realtime channel (no database changes), so anyone
 * signed in who knows the trip's id could join it; it carries only names and
 * the ids of what's being edited, never trip data.
 */
export function usePresence(
  tripId: string | undefined,
  focus: PresenceFocus | null,
): { peers: Peer[]; index: PresenceIndex } {
  const { session } = useAuth()
  const userId = session?.user.id
  const name = useDisplayName(userId)
  const [peers, setPeers] = useState<Peer[]>([])
  const channelRef = useRef<RealtimeChannel | null>(null)
  const [subscribed, setSubscribed] = useState(false)

  // Depend on the focus ids, not the object, so re-renders don't re-track.
  const stopId = focus && 'stopId' in focus ? focus.stopId : undefined
  const dayId = focus && 'dayId' in focus ? focus.dayId : undefined
  const payload = useMemo((): PresencePayload | null => {
    if (!userId) return null
    return {
      user_id: userId,
      name: name ?? 'Unnamed',
      color: presenceColor(userId),
      focus: stopId ? { stopId } : dayId ? { dayId } : null,
    }
  }, [userId, name, stopId, dayId])
  // The latest payload, so a rejoin after a dropped connection re-tracks it.
  const payloadRef = useRef(payload)

  useEffect(() => {
    if (!tripId || !userId) return
    const topic = `trip-presence:${tripId}`
    let cancelled = false
    let channel: RealtimeChannel | null = null

    const join = async () => {
      await leaving.get(topic)
      if (cancelled) return
      const ch = supabase.channel(topic, {
        // One entry per tab; peersFromState merges a person's tabs.
        config: { presence: { key: crypto.randomUUID() } },
      })
      channel = ch
      ch.on('presence', { event: 'sync' }, () => {
        setPeers(peersFromState(ch.presenceState(), userId))
      }).subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          channelRef.current = ch
          setSubscribed(true)
          // Presence is tied to the connection, so track again on every
          // (re)join.
          if (payloadRef.current) ch.track(payloadRef.current)
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          setSubscribed(false)
        }
      })
    }
    join()

    return () => {
      cancelled = true
      channelRef.current = null
      setSubscribed(false)
      setPeers([])
      if (channel) {
        const done = supabase.removeChannel(channel)
        leaving.set(topic, done)
        done.finally(() => {
          if (leaving.get(topic) === done) leaving.delete(topic)
        })
      }
    }
  }, [tripId, userId])

  // Track changes to the name or focus.
  useEffect(() => {
    payloadRef.current = payload
    const channel = channelRef.current
    if (subscribed && channel && payload) channel.track(payload)
  }, [subscribed, payload])

  const index = useMemo(() => indexPresence(peers), [peers])
  return { peers, index }
}

/** The signed-in user's display name, or null until loaded or if unset. */
function useDisplayName(userId: string | undefined) {
  const [name, setName] = useState<{ userId: string; name: string | null }>()
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    supabase
      .from('profiles')
      .select('display_name')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled)
          setName({ userId, name: data?.display_name?.trim() || null })
      })
    return () => {
      cancelled = true
    }
  }, [userId])
  return name && name.userId === userId ? name.name : null
}
