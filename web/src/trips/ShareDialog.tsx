import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useAuth } from '../auth/useAuth'
import type { Trip, TripInvite, TripRole } from '../lib/database.types'
import { supabase } from '../lib/supabase'
import {
  duplicateInviteMessage,
  INVITE_ROLES,
  inviteMessage,
  isDuplicateInvite,
  memberRows,
  parseInvite,
  pendingInvites,
  ROLE_LABELS,
  type InviteRole,
  type MemberRow,
} from './share'

type Props = {
  trip: Trip
  role: TripRole
  onClose: () => void
}

type Loaded = { members: MemberRow[]; invites: TripInvite[] }

/** Modal listing a trip's members and pending invites; owners can invite. */
export function ShareDialog({ trip, role, onClose }: Props) {
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
                {loaded.members.map((m) => (
                  <li key={m.userId}>
                    <span>
                      {m.name}
                      {m.isYou && <span className="muted"> (you)</span>}
                    </span>
                    <span className="muted">{ROLE_LABELS[m.role]}</span>
                  </li>
                ))}
              </ul>
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
                      <span className="muted">{ROLE_LABELS[i.role]}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
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
