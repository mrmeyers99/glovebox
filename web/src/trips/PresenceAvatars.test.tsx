// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Peer } from './presence'
import { EditingBadges, PresenceAvatars } from './PresenceAvatars'

afterEach(cleanup)

const pat: Peer = { userId: 'u1', name: 'Pat Lee', color: 2, focus: [] }
const zoe: Peer = { userId: 'u2', name: 'Zoe', color: 4, focus: [] }

describe('PresenceAvatars', () => {
  it('shows initials of everyone else viewing', () => {
    render(<PresenceAvatars peers={[pat, zoe]} />)
    const list = screen.getByRole('list', {
      name: 'Also viewing: Pat Lee and Zoe',
    })
    expect(list.textContent).toBe('PLZ')
    const avatar = screen.getByTitle('Pat Lee')
    expect(avatar.style.getPropertyValue('--presence-color')).toBe(
      'var(--presence-color-2)',
    )
  })

  it('renders nothing when nobody else is here', () => {
    const { container } = render(<PresenceAvatars peers={[]} />)
    expect(container.innerHTML).toBe('')
  })
})

describe('EditingBadges', () => {
  it('labels one editor', () => {
    render(<EditingBadges peers={[pat]} verb="editing" />)
    expect(screen.getByText('Pat Lee is editing')).toBeTruthy()
  })

  it('labels several editors', () => {
    render(<EditingBadges peers={[pat, zoe]} verb="adding a stop" />)
    expect(screen.getByTitle('Pat Lee and Zoe are adding a stop')).toBeTruthy()
  })
})
