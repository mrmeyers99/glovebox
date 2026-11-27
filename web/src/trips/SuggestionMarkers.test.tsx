// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LatLng } from '../lib/corridor'
import type { Suggestion } from '../lib/suggestions'
import { SuggestionCard } from './SuggestionCard'
import { SuggestionMarkers } from './SuggestionMarkers'

vi.mock('../lib/supabase', () => ({ supabase: {} }))

/** A stand-in for the MapLibre map that useMap returns. */
const map = vi.hoisted(() => {
  const listeners = new Set<() => void>()
  return {
    zoom: 12,
    west: -180,
    getZoom() {
      return this.zoom
    },
    getBounds() {
      return {
        getWest: () => this.west,
        getSouth: () => -90,
        getEast: () => 180,
        getNorth: () => 90,
      }
    },
    on: (_: string, fn: () => void) => listeners.add(fn),
    off: (_: string, fn: () => void) => listeners.delete(fn),
    move() {
      for (const fn of listeners) fn()
    },
    listeners,
    present: true,
  }
})

vi.mock('react-map-gl/maplibre', () => ({
  useMap: () => ({ current: map.present ? map : undefined }),
  Marker: ({
    children,
    onClick,
  }: {
    children: ReactNode
    onClick: (e: { originalEvent: { stopPropagation: () => void } }) => void
  }) => (
    <div
      data-testid="marker"
      // The real Marker passes the element's native click event.
      onClick={(e) =>
        onClick({
          originalEvent: { stopPropagation: () => e.stopPropagation() },
        })
      }
    >
      {children}
    </div>
  ),
  Popup: ({
    children,
    onClose,
  }: {
    children: ReactNode
    onClose: () => void
  }) => (
    <div role="dialog">
      {children}
      <button type="button" onClick={onClose}>
        Close
      </button>
    </div>
  ),
}))

function place(over: Partial<Suggestion> = {}): Suggestion {
  return {
    id: 1,
    name: 'Corn Palace',
    kind: 'attraction',
    category: 'tourism=attraction',
    lat: 43.7,
    lng: -98.03,
    tile_key: '43.5_-98.5',
    score: 2,
    percentile: 0.95,
    image: null,
    wikipedia_url: null,
    osm_url: null,
    ...over,
  }
}

const none: ReadonlySet<number> = new Set()

const lines: LatLng[][] = [
  [
    [43.7, -98.5],
    [43.7, -97.5],
  ],
]

beforeEach(() => {
  map.zoom = 12
  map.west = -180
  map.present = true
})
afterEach(cleanup)

describe('SuggestionMarkers', () => {
  const places = [
    place(),
    place({ id: 2, name: 'Mitchell Museum', percentile: 0.3 }),
  ]

  it('draws a marker per place, sized by percentile', () => {
    render(<SuggestionMarkers places={places} lines={lines} inTrip={none} />)
    const top = screen.getByRole('button', {
      name: 'Corn Palace (Attraction)',
    })
    expect(top.dataset.tier).toBe('top')
    expect(
      screen.getByRole('button', { name: 'Mitchell Museum (Attraction)' })
        .dataset.tier,
    ).toBe('other')
  })

  it('thins markers out when zoomed out, and follows the view', () => {
    render(<SuggestionMarkers places={places} lines={lines} inTrip={none} />)
    expect(screen.getAllByTestId('marker')).toHaveLength(2)
    map.zoom = 5
    act(() => map.move())
    expect(screen.getAllByTestId('marker')).toHaveLength(1)
    // Out of view.
    map.zoom = 12
    map.west = 0
    act(() => map.move())
    expect(screen.queryAllByTestId('marker')).toHaveLength(0)
  })

  it('stops following the map when removed', () => {
    const { unmount } = render(
      <SuggestionMarkers places={places} lines={lines} inTrip={none} />,
    )
    expect(map.listeners.size).toBe(1)
    unmount()
    expect(map.listeners.size).toBe(0)
  })

  it('draws every place before the map is ready', () => {
    map.present = false
    render(<SuggestionMarkers places={places} lines={lines} inTrip={none} />)
    // Zoom 0 until the map reports one: the best per tile.
    expect(screen.getAllByTestId('marker')).toHaveLength(1)
  })

  it('opens a card on click without the map seeing the click', () => {
    const onMapClick = vi.fn()
    render(
      <div onClick={onMapClick}>
        <SuggestionMarkers places={places} lines={lines} inTrip={none} />
      </div>,
    )
    const marker = screen.getByRole('button', {
      name: 'Corn Palace (Attraction)',
    })
    fireEvent.click(marker)
    expect(onMapClick).not.toHaveBeenCalled()
    expect(marker.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('heading', { name: 'Corn Palace' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBe(null)
  })
})

describe('SuggestionMarkers photos', () => {
  const image = {
    thumbnail_url: 'https://commons.wikimedia.org/big.jpg',
    marker_url: 'https://commons.wikimedia.org/small.jpg',
    page_url: 'https://commons.wikimedia.org/wiki/File:Corn.jpg',
    credit: null,
    license: null,
  }
  const marker = (name = 'Corn Palace (Attraction)') =>
    screen.getByRole('button', { name })

  it("shows the place's small photo instead of the icon", () => {
    render(
      <SuggestionMarkers
        places={[place({ image })]}
        lines={lines}
        inTrip={new Set([1])}
      />,
    )
    const button = marker('Corn Palace (Attraction, in your trip)')
    const img = button.querySelector('img')
    expect(img?.getAttribute('src')).toBe(image.marker_url)
    expect(img?.getAttribute('alt')).toBe('')
    expect(img?.getAttribute('loading')).toBe('lazy')
    expect(img?.getAttribute('decoding')).toBe('async')
    expect(button.dataset.photo).toBe('true')
    expect(button.dataset.inTrip).toBe('true')
    expect(button.textContent).toBe('')
  })

  it('shows the icon when the place has no photo', () => {
    render(
      <SuggestionMarkers
        places={[
          place(),
          place({ id: 2, name: 'B', image: { ...image, marker_url: null } }),
        ]}
        lines={lines}
        inTrip={none}
      />,
    )
    for (const button of [marker(), marker('B (Attraction)')]) {
      expect(button.querySelector('img')).toBe(null)
      expect(button.dataset.photo).toBeUndefined()
      expect(button.textContent).toBe('⭐')
    }
  })

  it("falls back to the icon when the photo doesn't load, and tries a new one", () => {
    const { rerender } = render(
      <SuggestionMarkers
        places={[place({ image })]}
        lines={lines}
        inTrip={none}
      />,
    )
    fireEvent.error(marker().querySelector('img')!)
    expect(marker().querySelector('img')).toBe(null)
    expect(marker().dataset.photo).toBeUndefined()
    expect(marker().textContent).toBe('⭐')
    const other = {
      ...image,
      marker_url: 'https://commons.wikimedia.org/new.jpg',
    }
    rerender(
      <SuggestionMarkers
        places={[place({ image: other })]}
        lines={lines}
        inTrip={none}
      />,
    )
    expect(marker().querySelector('img')?.getAttribute('src')).toBe(
      other.marker_url,
    )
  })
})

describe('SuggestionMarkers in the trip', () => {
  const places = [
    place(),
    place({ id: 2, name: 'Mitchell Museum', percentile: 0.3 }),
  ]

  it('marks places already in the trip', () => {
    render(
      <SuggestionMarkers places={places} lines={lines} inTrip={new Set([2])} />,
    )
    const marker = screen.getByRole('button', {
      name: 'Mitchell Museum (Attraction, in your trip)',
    })
    expect(marker.dataset.inTrip).toBe('true')
    expect(
      screen.getByRole('button', { name: 'Corn Palace (Attraction)' }).dataset
        .inTrip,
    ).toBeUndefined()
    fireEvent.click(marker)
    expect(screen.getByText('In your trip')).toBeTruthy()
  })

  it('closes the card when its place is added', () => {
    const onAdd = vi.fn()
    render(
      <SuggestionMarkers
        places={places}
        lines={lines}
        inTrip={none}
        onAdd={onAdd}
      />,
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Corn Palace (Attraction)' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add to trip' }))
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }))
    expect(screen.queryByRole('dialog')).toBe(null)
  })
})

describe('SuggestionCard', () => {
  it('shows the place, its photo credit, links and distance', () => {
    const onAdd = vi.fn()
    render(
      <SuggestionCard
        place={place({
          lat: 44,
          image: {
            thumbnail_url: 'https://commons.wikimedia.org/thumb.jpg',
            marker_url: null,
            page_url: 'https://commons.wikimedia.org/wiki/File:Corn.jpg',
            credit: 'Jane Doe',
            license: 'CC BY-SA 4.0',
          },
          wikipedia_url: 'https://en.wikipedia.org/wiki/Corn_Palace',
          osm_url: 'https://www.openstreetmap.org/way/1',
        })}
        lines={lines}
        inTrip={false}
        onAdd={onAdd}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Corn Palace' })).toBeTruthy()
    expect(screen.getByText(/Attraction · 21 mi from the route/)).toBeTruthy()
    const credit = screen.getByRole('link', {
      name: 'Jane Doe · CC BY-SA 4.0',
    })
    expect(credit.getAttribute('href')).toBe(
      'https://commons.wikimedia.org/wiki/File:Corn.jpg',
    )
    expect(screen.getByText(/Wikimedia Commons/)).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'Wikipedia' }).getAttribute('href'),
    ).toBe('https://en.wikipedia.org/wiki/Corn_Palace')
    expect(
      screen.getByRole('link', { name: 'OpenStreetMap' }).getAttribute('href'),
    ).toBe('https://www.openstreetmap.org/way/1')
    fireEvent.click(screen.getByRole('button', { name: 'Add to trip' }))
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }))
  })

  it('says when the place is already in the trip', () => {
    render(
      <SuggestionCard
        place={place()}
        lines={lines}
        inTrip={true}
        onAdd={vi.fn()}
      />,
    )
    expect(screen.getByText('In your trip')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add to trip' })).toBe(null)
  })

  it('offers no adding to viewers', () => {
    render(<SuggestionCard place={place()} lines={lines} inTrip={false} />)
    expect(screen.queryByRole('button', { name: 'Add to trip' })).toBe(null)
    expect(screen.queryByText('In your trip')).toBe(null)
  })

  it('leaves out what it does not know', () => {
    render(
      <SuggestionCard
        place={place({
          image: {
            thumbnail_url: 'https://t',
            marker_url: null,
            page_url: 'https://p',
            credit: null,
            license: null,
          },
          osm_url: 'https://www.openstreetmap.org/node/1',
        })}
        lines={[]}
        inTrip={false}
      />,
    )
    expect(screen.getByRole('link', { name: 'Photo' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Wikipedia' })).toBe(null)
    expect(screen.queryByText(/from the route/)).toBe(null)
  })

  it('has no links section without links', () => {
    const { container } = render(
      <SuggestionCard place={place()} lines={lines} inTrip={false} />,
    )
    expect(container.querySelector('.suggestion-links')).toBe(null)
    expect(container.querySelector('img')).toBe(null)
    expect(screen.getByText(/On the route/)).toBeTruthy()
  })
})
