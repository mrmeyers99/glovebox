// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
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
