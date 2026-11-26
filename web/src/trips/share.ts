// Share dialog: who's on a trip, pending invites, the invite form, and
// managing members. The rules mirror the trip_members and trip_invites
// policies so the dialog only offers actions the database allows.

import type {
  Profile,
  TripInvite,
  TripMember,
  TripRole,
} from '../lib/database.types'

export type InviteRole = Exclude<TripRole, 'owner'>

export const INVITE_ROLES: InviteRole[] = ['editor', 'viewer']

export const ROLE_LABELS: Record<TripRole, string> = {
  owner: 'Owner',
  editor: 'Editor',
  viewer: 'Viewer',
}

export type MemberRow = {
  userId: string
  name: string
  role: TripRole
  isYou: boolean
}

const ROLE_ORDER: Record<TripRole, number> = { owner: 0, editor: 1, viewer: 2 }

/**
 * Members with their display names, owner first, then editors and viewers,
 * each group alphabetical. Someone without a display name shows as "Unnamed".
 */
export function memberRows(
  members: Pick<TripMember, 'user_id' | 'role'>[],
  profiles: Pick<Profile, 'id' | 'display_name'>[],
  currentUserId: string | undefined,
): MemberRow[] {
  const names = new Map(profiles.map((p) => [p.id, p.display_name]))
  return members
    .map((m) => ({
      userId: m.user_id,
      name: names.get(m.user_id)?.trim() || 'Unnamed',
      role: m.role,
      isYou: m.user_id === currentUserId,
    }))
    .sort(compareMembers)
}

function compareMembers(a: MemberRow, b: MemberRow) {
  return (
    ROLE_ORDER[a.role] - ROLE_ORDER[b.role] ||
    a.name.localeCompare(b.name) ||
    (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0)
  )
}

export type MemberAction = 'changeRole' | 'remove' | 'leave'

/**
 * What the signed-in user (with `viewerRole`) can do to a member's row. The
 * owner changes roles and removes anyone but themself; everyone else can only
 * leave. The owner's row has no actions (ownership transfer isn't supported).
 */
export function memberActions(
  member: MemberRow,
  viewerRole: TripRole,
): MemberAction[] {
  if (member.role === 'owner') return []
  if (viewerRole === 'owner') return ['changeRole', 'remove']
  return member.isYou ? ['leave'] : []
}

/** The list after a member's role changed, re-sorted. */
export function withMemberRole(
  rows: MemberRow[],
  userId: string,
  role: InviteRole,
): MemberRow[] {
  return rows
    .map((m) => (m.userId === userId ? { ...m, role } : m))
    .sort(compareMembers)
}

/** The list without a member who was removed. */
export function withoutMember(rows: MemberRow[], userId: string): MemberRow[] {
  return rows.filter((m) => m.userId !== userId)
}

export function removeMemberPrompt(name: string) {
  return `Remove ${name} from this trip? They'll lose access right away.`
}

export function leaveTripPrompt(tripName: string) {
  return `Leave "${tripName}"? You'll need a new invite to rejoin.`
}

/** Invites nobody has accepted yet, oldest first. */
export function pendingInvites<
  T extends Pick<TripInvite, 'accepted_at' | 'created_at'>,
>(invites: T[]): T[] {
  return invites
    .filter((i) => i.accepted_at === null)
    .sort((a, b) =>
      a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0,
    )
}

export type InviteResult =
  | { ok: true; email: string; role: InviteRole }
  | { ok: false; error: string }

// A pragmatic check: something@something.tld, no spaces. The database only
// requires lower case and something before the "@".
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Validates the invite form. The email is trimmed and lower-cased. */
export function parseInvite(email: string, role: string): InviteResult {
  const normalized = email.trim().toLowerCase()
  if (normalized === '') return { ok: false, error: 'Enter an email address.' }
  if (!EMAIL_PATTERN.test(normalized))
    return { ok: false, error: 'Enter a valid email address.' }
  if (!INVITE_ROLES.includes(role as InviteRole))
    return { ok: false, error: 'Choose editor or viewer.' }
  return { ok: true, email: normalized, role: role as InviteRole }
}

/** Postgres unique_violation: this email was already invited to the trip. */
export function isDuplicateInvite(error: { code?: string } | null) {
  return error?.code === '23505'
}

export function duplicateInviteMessage(email: string) {
  return `${email} has already been invited to this trip.`
}

/** A note the owner can copy and send, since we don't email invites yet. */
export function inviteMessage(tripName: string, appUrl: string, email: string) {
  return `I've shared our trip "${tripName}" on Glovebox — sign in at ${appUrl} with ${email} to see it.`
}
