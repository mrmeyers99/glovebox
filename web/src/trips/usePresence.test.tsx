// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { presenceColor, type PresenceFocus } from './presence'
import { usePresence } from './usePresence'

type Status = 'SUBSCRIBED' | 'CLOSED' | 'CHANNEL_ERROR' | 'TIMED_OUT'

/** A stand-in for a Realtime channel that records what the hook does. */
class FakeChannel {
  state: Record<string, unknown[]> = {}
  tracked: unknown[] = []
  onSync = () => {}
  onStatus: (status: Status) => void = () => {}
  topic: string
  options: { config: { presence: { key: string } } }
  constructor(
    topic: string,
    options: { config: { presence: { key: string } } },
  ) {
    this.topic = topic
    this.options = options
  }
  on(_type: string, _filter: unknown, callback: () => void) {
    this.onSync = callback
    return this
  }
  subscribe(callback: (status: Status) => void) {
    this.onStatus = callback
    return this
  }
  presenceState() {
    return this.state
  }
  track(payload: unknown) {
    this.tracked.push(payload)
    return Promise.resolve('ok')
  }
  /** Simulates the server's presence state changing. */
  sync(state: Record<string, unknown[]>) {
    this.state = state
    act(() => this.onSync())
  }
  status(status: Status) {
    act(() => this.onStatus(status))
  }
}

const mocks = vi.hoisted(() => ({
  userId: 'me' as string | undefined,
  displayName: 'Me Myself' as string | null,
  channels: [] as unknown[],
  removeChannel: vi.fn<(channel: unknown) => Promise<string>>(),
}))

vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({
    session: mocks.userId ? { user: { id: mocks.userId } } : null,
    loading: false,
  }),
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    channel: (
      topic: string,
      options: { config: { presence: { key: string } } },
    ) => {
      const channel = new FakeChannel(topic, options)
      mocks.channels.push(channel)
      return channel
    },
    removeChannel: (channel: unknown) => mocks.removeChannel(channel),
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({ data: { display_name: mocks.displayName } }),
        }),
      }),
    }),
  },
}))

const channels = () => mocks.channels as FakeChannel[]

beforeEach(() => {
  mocks.userId = 'me'
  mocks.displayName = 'Me Myself'
  mocks.channels = []
  mocks.removeChannel.mockReset()
  mocks.removeChannel.mockResolvedValue('ok')
})

afterEach(cleanup)

function renderPresence(
  tripId: string | undefined,
  focus: PresenceFocus | null = null,
) {
  return renderHook(
    (props: { tripId: string | undefined; focus: PresenceFocus | null }) =>
      usePresence(props.tripId, props.focus),
    { initialProps: { tripId, focus } },
  )
}

/** Renders, waits for the channel and the display name, and joins. */
async function joined(focus: PresenceFocus | null = null) {
  const hook = renderPresence('t1', focus)
  await waitFor(() => expect(channels()).toHaveLength(1))
  const channel = channels()[0]
  channel.status('SUBSCRIBED')
  await waitFor(() =>
    expect(channel.tracked.at(-1)).toMatchObject({ name: 'Me Myself' }),
  )
  return { hook, channel }
}

describe('usePresence', () => {
  it('joins the trip’s channel with a key per tab and tracks this user', async () => {
    const { channel } = await joined({ stopId: 's1' })
    expect(channel.topic).toBe('trip-presence:t1')
    expect(channel.options.config.presence.key).toMatch(/^[0-9a-f-]{36}$/)
    expect(channel.tracked.at(-1)).toEqual({
      user_id: 'me',
      name: 'Me Myself',
      color: presenceColor('me'),
      focus: { stopId: 's1' },
    })
  })

  it('returns everyone else, indexed by what they are editing', async () => {
    const { hook, channel } = await joined()
    channel.sync({
      a: [{ user_id: 'me', name: 'Me Myself', color: 1, focus: null }],
      b: [{ user_id: 'u2', name: 'Zoe', color: 2, focus: { stopId: 's1' } }],
      c: [{ user_id: 'u3', name: 'Ann', color: 3, focus: { dayId: 'd1' } }],
    })
    const { peers, index } = hook.result.current
    expect(peers.map((p) => p.name)).toEqual(['Ann', 'Zoe'])
    expect(index.stops.get('s1')?.map((p) => p.name)).toEqual(['Zoe'])
    expect(index.days.get('d1')?.map((p) => p.name)).toEqual(['Ann'])
  })

  it('tracks again when the focus changes, but not for an equal focus', async () => {
    const { hook, channel } = await joined({ stopId: 's1' })
    const count = channel.tracked.length
    hook.rerender({ tripId: 't1', focus: { stopId: 's1' } })
    expect(channel.tracked).toHaveLength(count)
    hook.rerender({ tripId: 't1', focus: { dayId: 'd2' } })
    expect(channel.tracked.at(-1)).toMatchObject({ focus: { dayId: 'd2' } })
    hook.rerender({ tripId: 't1', focus: null })
    expect(channel.tracked.at(-1)).toMatchObject({ focus: null })
  })

  it('tracks again after rejoining, and not while disconnected', async () => {
    const { hook, channel } = await joined()
    channel.status('CHANNEL_ERROR')
    const count = channel.tracked.length
    hook.rerender({ tripId: 't1', focus: { stopId: 's3' } })
    expect(channel.tracked).toHaveLength(count)
    channel.status('SUBSCRIBED')
    expect(channel.tracked.at(-1)).toMatchObject({ focus: { stopId: 's3' } })
  })

  it('uses "Unnamed" without a display name', async () => {
    mocks.displayName = '  '
    renderPresence('t1')
    await waitFor(() => expect(channels()).toHaveLength(1))
    const channel = channels()[0]
    channel.status('SUBSCRIBED')
    expect(channel.tracked.at(-1)).toMatchObject({ name: 'Unnamed' })
  })

  it('leaves the channel on unmount, and a rejoin waits for it', async () => {
    const { hook, channel } = await joined()
    let finishLeaving: (status: string) => void = () => {}
    mocks.removeChannel.mockReturnValueOnce(
      new Promise((resolve) => (finishLeaving = resolve)),
    )
    hook.unmount()
    expect(mocks.removeChannel).toHaveBeenCalledWith(channel)

    renderPresence('t1')
    // Still waiting for the old channel to leave.
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(channels()).toHaveLength(1)
    await act(async () => finishLeaving('ok'))
    await waitFor(() => expect(channels()).toHaveLength(2))
  })

  it('does not join before the channel is created if unmounted first', async () => {
    const hook = renderPresence('t1')
    hook.unmount()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(channels()).toHaveLength(0)
    expect(mocks.removeChannel).not.toHaveBeenCalled()
  })

  it('does nothing without a trip or a signed-in user', async () => {
    const hook = renderPresence(undefined)
    mocks.userId = undefined
    renderPresence('t1')
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(channels()).toHaveLength(0)
    expect(hook.result.current.peers).toEqual([])
  })
})
