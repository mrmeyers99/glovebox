// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Day, Stop, Trip } from '../lib/database.types'
import { summarizeTrip } from '../lib/tripMath'
import { toDayInput, toStopInput } from '../lib/tripRows'
import { DayListPanel } from './DayListPanel'
import { indexPresence, type Peer } from './presence'

afterEach(cleanup)

const trip: Trip = {
  id: 't1',
  owner_id: 'u1',
  name: 'Road trip',
  start_date: null,
  mpg: 25,
  gas_price_per_gallon: 3,
  created_at: '',
  updated_at: '',
}

const day = (id: string, position: string): Day => ({
  id,
  trip_id: 't1',
  position,
  notes: null,
  created_at: '',
  updated_at: '',
})

const stop = (id: string, dayId: string, position: string): Stop => ({
  id,
  trip_id: 't1',
  day_id: dayId,
  position,
  kind: 'waypoint',
  name: `Stop ${id}`,
  lat: 0,
  lng: 0,
  address: null,
  notes: null,
  cost_amount: null,
  cost_category: null,
  arrival_time: null,
  stay_minutes: null,
  skipped: false,
  created_at: '',
  updated_at: '',
  updated_by: null,
})

const days = [day('d1', 'a0'), day('d2', 'a1')]
const stops = [stop('s1', 'd1', 'a0'), stop('s2', 'd1', 'a1')]
const summary = summarizeTrip(days.map(toDayInput), stops.map(toStopInput), {
  mpg: 25,
  gasPricePerGallon: 3,
  route: () => undefined,
})

const zoe: Peer = {
  userId: 'u2',
  name: 'Zoe',
  color: 4,
  focus: [{ stopId: 's1' }, { dayId: 'd2' }],
}

function renderPanel(peers: Peer[], canEdit: boolean) {
  return render(
    <DayListPanel
      trip={trip}
      days={days}
      stops={stops}
      summary={summary}
      gasPriceKnown
      selection={null}
      onSelectStop={() => {}}
      onMoveStop={canEdit ? () => {} : undefined}
      presence={indexPresence(peers)}
    />,
  )
}

describe('DayListPanel presence', () => {
  for (const canEdit of [true, false]) {
    it(`marks stops and days others are editing (${canEdit ? 'editor' : 'viewer'})`, () => {
      const { container } = renderPanel([zoe], canEdit)
      const edited = container.querySelectorAll<HTMLElement>(
        '.stop[data-presence]',
      )
      expect(edited).toHaveLength(1)
      expect(within(edited[0]).getByText('Zoe is editing')).toBeTruthy()
      expect(edited[0].textContent).toContain('Stop s1')
      expect(edited[0].style.getPropertyValue('--presence-color')).toBe(
        'var(--presence-color-4)',
      )

      const day2 = screen.getByRole('listitem', { name: 'Day 2' })
      expect(day2.dataset.presence).toBe('true')
      expect(within(day2).getByText('Zoe is adding a stop')).toBeTruthy()
      const day1 = screen.getByRole('listitem', { name: 'Day 1' })
      expect(day1.dataset.presence).toBeUndefined()
    })
  }

  it('shows no markers when nobody is editing', () => {
    const { container } = renderPanel([], true)
    expect(container.querySelector('[data-presence]')).toBeNull()
    expect(container.querySelector('.presence-editing')).toBeNull()
  })
})

describe('DayListPanel start and end', () => {
  const ends = [
    { ...stop('start', 'd1', 'a0'), kind: 'start' as const },
    stop('mid', 'd1', 'a1'),
    { ...stop('end', 'd2', 'a0'), kind: 'end' as const },
  ]
  const endsSummary = summarizeTrip(
    days.map(toDayInput),
    ends.map(toStopInput),
    { mpg: 25, gasPricePerGallon: 3, route: () => undefined },
  )

  function renderEnds() {
    const onSetTripEnd = vi.fn()
    const onSelectStop = vi.fn()
    render(
      <DayListPanel
        trip={trip}
        days={days}
        stops={ends}
        summary={endsSummary}
        gasPriceKnown
        selection={null}
        onSelectStop={onSelectStop}
        onMoveStop={() => {}}
        onSetTripEnd={onSetTripEnd}
      />,
    )
    return { onSetTripEnd, onSelectStop }
  }

  it('lets the start and end be dragged like any stop', () => {
    renderEnds()
    for (const name of ['Stop start', 'Stop mid', 'Stop end'])
      expect(screen.getByRole('button', { name: `Move ${name}` })).toBeTruthy()
  })

  it('changes the start or end without selecting it', () => {
    const { onSetTripEnd, onSelectStop } = renderEnds()
    fireEvent.click(
      screen.getByRole('button', { name: "Change the trip's end" }),
    )
    expect(onSetTripEnd).toHaveBeenCalledExactlyOnceWith('end', ends[2])
    expect(onSelectStop).not.toHaveBeenCalled()
  })

  it("announces a picked-up stop's place among all of its day's stops", async () => {
    renderEnds()
    const handle = screen.getByRole('button', { name: 'Move Stop start' })
    handle.focus()
    fireEvent.keyDown(handle, { code: 'Space' })
    expect(
      await screen.findByText(
        'Picked up Stop start, position 1 of 2 on Day 1.',
      ),
    ).toBeTruthy()
  })
})
