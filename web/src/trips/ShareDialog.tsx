import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import type { Trip, TripInvite, TripRole } from '../lib/database.types'
import { supabase } from '../lib/supabase'
import {
  duplicateInviteMessage,
  INVITE_ROLES,
  inviteMessage,
  isDuplicateInvite,
  leaveTripPrompt,
  memberActions,
  memberRows,
  parseInvite,
  pendingInvites,
  removeMemberPrompt,
  ROLE_LABELS,
  withMemberRole,
  withoutMember,
  type InviteRole,
  type MemberRow,
} from './share'

type Props = {
  trip: Trip
  role: TripRole
  onClose: () => void
}

type Loaded = { members: MemberRow[]; invites: TripInvite[] }

type Confirming = { kind: 'remove'; member: MemberRow } | { kind: 'leave' }

/**
 * Modal listing a trip's members and pending invites. Owners invite, change
 * roles, remove members and revoke invites; everyone else can leave.
 */
export function ShareDialog({ trip, role, onClose }: Props) {
  const navigate = useNavigate()
  const { session } = useAuth()
  const userId = session?.user.id
  const isOwner = role === 'owner'
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  const [email, setEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<InviteRole>('editor')
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviting, setInviting] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Managing members: one action at a time, keyed like 'role:<userId>'.
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<Confirming | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  useEffect(() => {
    let active = true
    fetchSharing(trip.id, userId).then((result) => {
      if (!active) return
      if ('error' in result) setLoadError(result.error)
      else setLoaded(result)
    })
    return () => {
      active = false
    }
  }, [trip.id, userId, attempt])

  function retry() {
    setLoadError(null)
    setAttempt((n) => n + 1)
  }

  async function invite(event: FormEvent) {
    event.preventDefault()
    const result = parseInvite(email, inviteRole)
    if (!result.ok) {
      setInviteError(result.error)
      return
    }
    setInviting(true)
    setInviteError(null)
    setSentTo(null)
    const { data, error } = await supabase
      .from('trip_invites')
      .insert({ trip_id: trip.id, email: result.email, role: result.role })
      .select()
      .single()
    setInviting(false)
    if (error) {
      setInviteError(
        isDuplicateInvite(error)
          ? duplicateInviteMessage(result.email)
          : `Couldn't send the invite: ${error.message}`,
      )
      return
    }
    setLoaded((prev) =>
      prev ? { ...prev, invites: [...prev.invites, data] } : prev,
    )
    // Refetch too, to pick up changes others made while the dialog was open
    // (another owner's invites, accepted invites). The lists stay shown meanwhile.
    setAttempt((n) => n + 1)
    setEmail('')
    setCopied(false)
    setSentTo(result.email)
  }

  /** Refetch after a change, to pick up what others changed meanwhile. */
  function refresh() {
    setAttempt((n) => n + 1)
  }

  async function changeRole(member: MemberRow, newRole: InviteRole) {
    setBusy(`role:${member.userId}`)
    setActionError(null)
    const { data, error } = await supabase
      .from('trip_members')
      .update({ role: newRole })
      .eq('trip_id', trip.id)
      .eq('user_id', member.userId)
      .select('user_id')
    setBusy(null)
    if (error) {
      setActionError(`Couldn't change ${member.name}'s role: ${error.message}`)
    } else if (data.length === 0) {
      setActionError(
        `Couldn't change ${member.name}'s role. They may no longer be on this trip.`,
      )
    } else {
      setLoaded((prev) =>
        prev
          ? {
              ...prev,
              members: withMemberRole(prev.members, member.userId, newRole),
            }
          : prev,
      )
    }
    refresh()
  }

  async function removeMember(member: MemberRow) {
    setBusy(`remove:${member.userId}`)
    setActionError(null)
    const { error } = await supabase
      .from('trip_members')
      .delete()
      .eq('trip_id', trip.id)
      .eq('user_id', member.userId)
    setBusy(null)
    setConfirming(null)
    if (error) {
      setActionError(`Couldn't remove ${member.name}: ${error.message}`)
    } else {
      setLoaded((prev) =>
        prev
          ? { ...prev, members: withoutMember(prev.members, member.userId) }
          : prev,
      )
    }
    refresh()
  }

  async function revokeInvite(invite: TripInvite) {
    setBusy(`revoke:${invite.id}`)
    setActionError(null)
    const { error } = await supabase
      .from('trip_invites')
      .delete()
      .eq('id', invite.id)
    setBusy(null)
    if (error) {
      setActionError(
        `Couldn't revoke the invite for ${invite.email}: ${error.message}`,
      )
    } else {
      setLoaded((prev) =>
        prev
          ? { ...prev, invites: prev.invites.filter((i) => i.id !== invite.id) }
          : prev,
      )
      if (sentTo === invite.email) setSentTo(null)
    }
    refresh()
  }

  async function leaveTrip() {
    if (!userId) return
    setBusy('leave')
    setActionError(null)
    const { error } = await supabase
      .from('trip_members')
      .delete()
      .eq('trip_id', trip.id)
      .eq('user_id', userId)
    setBusy(null)
    if (error) {
      setConfirming(null)
      setActionError(`Couldn't leave this trip: ${error.message}`)
      return
    }
    navigate('/')
  }

  const message = sentTo
    ? inviteMessage(trip.name, window.location.origin, sentTo)
    : null

  async function copyMessage() {
    if (!message) return
    try {
      await navigator.clipboard.writeText(message)
      setCopied(true)
    } catch {
      // Clipboard can be unavailable (e.g. insecure context); the text is
      // still selectable.
      setCopied(false)
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="dialog"
      aria-labelledby="share-title"
      // Escape closes the dialog natively; keep React state in step.
      onClose={onClose}
    >
      <div className="dialog-form">
        <h2 id="share-title">Share “{trip.name}”</h2>

        {loadError && (
          <p role="alert" className="error">
            Couldn't load who's on this trip: {loadError}{' '}
            <button type="button" onClick={retry}>
              Try again
            </button>
          </p>
        )}
        {!loaded && !loadError && <p>Loading…</p>}

        {loaded && (
          <>
            <section aria-labelledby="share-members">
              <h3 id="share-members" className="share-heading">
                Members
              </h3>
              <ul className="share-list">
                {loaded.members.map((m) => {
                  const actions = memberActions(m, role)
                  return (
                    <li key={m.userId}>
                      <span>
                        {m.name}
                        {m.isYou && <span className="muted"> (you)</span>}
                      </span>
                      <span className="share-row-actions">
                        {actions.includes('changeRole') ? (
                          <select
                            aria-label={`Role for ${m.name}`}
                            value={m.role}
                            disabled={busy !== null}
                            onChange={(e) =>
                              changeRole(m, e.target.value as InviteRole)
                            }
                          >
                            {INVITE_ROLES.map((r) => (
                              <option key={r} value={r}>
                                {ROLE_LABELS[r]}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="muted">{ROLE_LABELS[m.role]}</span>
                        )}
                        {actions.includes('remove') && (
                          <button
                            type="button"
                            aria-label={`Remove ${m.name}`}
                            disabled={busy !== null}
                            onClick={() =>
                              setConfirming({ kind: 'remove', member: m })
                            }
                          >
                            Remove
                          </button>
                        )}
                        {actions.includes('leave') && (
                          <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() => setConfirming({ kind: 'leave' })}
                          >
                            Leave trip
                          </button>
                        )}
                      </span>
                    </li>
                  )
                })}
              </ul>
              {confirming && (
                <div className="share-confirm" role="alert">
                  <p>
                    {confirming.kind === 'remove'
                      ? removeMemberPrompt(confirming.member.name)
                      : leaveTripPrompt(trip.name)}
                  </p>
                  <div className="dialog-actions">
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => setConfirming(null)}
                    >
                      Cancel
                    </button>
                    {confirming.kind === 'remove' ? (
                      <button
                        type="button"
                        className="danger"
                        disabled={busy !== null}
                        onClick={() => removeMember(confirming.member)}
                      >
                        {busy ? 'Removing…' : 'Remove'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="danger"
                        disabled={busy !== null}
                        onClick={leaveTrip}
                      >
                        {busy ? 'Leaving…' : 'Leave trip'}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </section>

            <section aria-labelledby="share-invites">
              <h3 id="share-invites" className="share-heading">
                Pending invites
              </h3>
              {loaded.invites.length === 0 ? (
                <p className="muted">No pending invites.</p>
              ) : (
                <ul className="share-list">
                  {loaded.invites.map((i) => (
                    <li key={i.id}>
                      <span className="share-email">{i.email}</span>
                      <span className="share-row-actions">
                        <span className="muted">{ROLE_LABELS[i.role]}</span>
                        {isOwner && (
                          <button
                            type="button"
                            aria-label={`Revoke invite for ${i.email}`}
                            disabled={busy !== null}
                            onClick={() => revokeInvite(i)}
                          >
                            {busy === `revoke:${i.id}` ? 'Revoking…' : 'Revoke'}
                          </button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {actionError && (
              <p role="alert" className="error">
                {actionError}
              </p>
            )}
          </>
        )}

        {isOwner && (
          <form className="dialog-form" noValidate onSubmit={invite}>
            <h3 className="share-heading">Invite someone</h3>
            <div className="share-invite-fields">
              <div className="field share-email-field">
                <label htmlFor="share-email">Email</label>
                <input
                  id="share-email"
                  type="email"
                  autoComplete="off"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value)
                    setInviteError(null)
                  }}
                  aria-invalid={inviteError ? true : undefined}
                  aria-describedby={inviteError ? 'share-error' : undefined}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="share-role">Role</label>
                <select
                  id="share-role"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as InviteRole)}
                >
                  {INVITE_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </div>
              <button type="submit" disabled={inviting}>
                {inviting ? 'Inviting…' : 'Invite'}
              </button>
            </div>
            {inviteError && (
              <p id="share-error" role="alert" className="field-error">
                {inviteError}
              </p>
            )}
            {message && (
              <div className="share-sent" role="status">
                <p>
                  Invited {sentTo}. We don't send emails yet, so let them know:
                </p>
                <textarea
                  readOnly
                  rows={3}
                  value={message}
                  aria-label="Message to send"
                  onFocus={(e) => e.target.select()}
                />
                <button type="button" onClick={copyMessage}>
                  {copied ? 'Copied' : 'Copy message'}
                </button>
              </div>
            )}
          </form>
        )}

        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </dialog>
  )
}

/** Members (with display names) and pending invites for a trip. */
async function fetchSharing(
  tripId: string,
  userId: string | undefined,
): Promise<Loaded | { error: string }> {
  const [members, invites] = await Promise.all([
    supabase.from('trip_members').select('user_id, role').eq('trip_id', tripId),
    supabase.from('trip_invites').select('*').eq('trip_id', tripId),
  ])
  const error = members.error ?? invites.error
  if (error) return { error: error.message }
  const ids = (members.data ?? []).map((m) => m.user_id)
  const profiles = await supabase
    .from('profiles')
    .select('id, display_name')
    .in('id', ids)
  if (profiles.error) return { error: profiles.error.message }
  return {
    members: memberRows(members.data ?? [], profiles.data ?? [], userId),
    invites: pendingInvites(invites.data ?? []),
  }
}
