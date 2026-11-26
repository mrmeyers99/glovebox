// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TripsPage } from './TripsPage'

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        order: () => Promise.resolve({ data: [], error: null }),
      }),
    }),
    auth: { signOut: vi.fn() },
  },
}))

afterEach(cleanup)

describe('TripsPage', () => {
  it('offers the theme picker in the header', async () => {
    render(
      <MemoryRouter>
        <TripsPage />
      </MemoryRouter>,
    )
    expect(screen.getByLabelText('Theme')).toBeTruthy()
    expect(await screen.findByText('No trips yet.')).toBeTruthy()
  })
})
