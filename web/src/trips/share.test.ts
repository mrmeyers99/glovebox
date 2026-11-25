import { describe, expect, it } from 'vitest'
import {
  duplicateInviteMessage,
  inviteMessage,
  isDuplicateInvite,
  memberRows,
  parseInvite,
  pendingInvites,
} from './share'

describe('memberRows', () => {
  const profiles = [
    { id: 'u1', display_name: 'Pat' },
    { id: 'u2', display_name: 'Zoe' },
    { id: 'u3', display_name: 'Ann' },
    { id: 'u4', display_name: '  ' },
  ]

  it('puts the owner first, then editors and viewers by name', () => {
    const rows = memberRows(
      [
        { user_id: 'u3', role: 'viewer' },
        { user_id: 'u2', role: 'editor' },
        { user_id: 'u1', role: 'owner' },
        { user_id: 'u4', role: 'editor' },
      ],
      profiles,
      'u2',
    )
    expect(rows).toEqual([
      { userId: 'u1', name: 'Pat', role: 'owner', isYou: false },
      { userId: 'u4', name: 'Unnamed', role: 'editor', isYou: false },
      { userId: 'u2', name: 'Zoe', role: 'editor', isYou: true },
      { userId: 'u3', name: 'Ann', role: 'viewer', isYou: false },
    ])
  })

  it('handles a member with no profile row', () => {
    const rows = memberRows([{ user_id: 'u9', role: 'viewer' }], [], 'u1')
    expect(rows).toEqual([
      { userId: 'u9', name: 'Unnamed', role: 'viewer', isYou: false },
    ])
  })
})

describe('pendingInvites', () => {
  it('drops accepted invites and sorts oldest first', () => {
    const invites = [
      { id: 'b', accepted_at: null, created_at: '2026-11-25T02:00:00Z' },
      {
        id: 'x',
        accepted_at: '2026-11-25T03:00:00Z',
        created_at: '2026-11-25T00:00:00Z',
      },
      { id: 'a', accepted_at: null, created_at: '2026-11-25T01:00:00Z' },
    ]
    expect(pendingInvites(invites).map((i) => i.id)).toEqual(['a', 'b'])
  })
})

describe('parseInvite', () => {
  it('trims and lower-cases the email', () => {
    expect(parseInvite('  Sam.Smith@Example.COM ', 'viewer')).toEqual({
      ok: true,
      email: 'sam.smith@example.com',
      role: 'viewer',
    })
  })

  it.each(['', '   ', 'sam', '@example.com', 'sam@example', 'sam @x.com'])(
    'rejects %j',
    (email) => {
      expect(parseInvite(email, 'editor').ok).toBe(false)
    },
  )

  it('only allows editor or viewer', () => {
    expect(parseInvite('sam@example.com', 'editor').ok).toBe(true)
    expect(parseInvite('sam@example.com', 'owner').ok).toBe(false)
    expect(parseInvite('sam@example.com', '').ok).toBe(false)
  })
})

describe('isDuplicateInvite', () => {
  it('recognizes a unique violation', () => {
    expect(isDuplicateInvite({ code: '23505' })).toBe(true)
    expect(isDuplicateInvite({ code: '42501' })).toBe(false)
    expect(isDuplicateInvite(null)).toBe(false)
  })

  it('names the email in the message', () => {
    expect(duplicateInviteMessage('sam@example.com')).toContain(
      'sam@example.com',
    )
  })
})

describe('inviteMessage', () => {
  it('includes the trip, app URL and email', () => {
    const message = inviteMessage(
      'Route 66',
      'https://glovebox.example',
      'sam@example.com',
    )
    expect(message).toContain('"Route 66"')
    expect(message).toContain('https://glovebox.example')
    expect(message).toContain('sam@example.com')
  })
})
