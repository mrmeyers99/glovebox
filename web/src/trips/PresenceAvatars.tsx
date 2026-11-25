import type { CSSProperties } from 'react'
import { initials, listNames, presenceColorVar, type Peer } from './presence'

/** Initials of everyone else viewing the trip, for the trip header. */
export function PresenceAvatars({ peers }: { peers: Peer[] }) {
  if (peers.length === 0) return null
  const label = `Also viewing: ${listNames(peers)}`
  return (
    <ul className="presence-avatars" aria-label={label} title={label}>
      {peers.map((peer) => (
        <li key={peer.userId}>
          <Avatar peer={peer} />
        </li>
      ))}
    </ul>
  )
}

/**
 * Small avatars on a stop or day someone else is editing, with a label for
 * screen readers, e.g. "Pat is editing".
 */
export function EditingBadges({
  peers,
  verb,
}: {
  peers: Peer[]
  verb: string
}) {
  const label = `${listNames(peers)} ${peers.length === 1 ? 'is' : 'are'} ${verb}`
  return (
    <span className="presence-editing" title={label}>
      <span className="visually-hidden">{label}</span>
      {peers.map((peer) => (
        <Avatar key={peer.userId} peer={peer} small />
      ))}
    </span>
  )
}

function Avatar({ peer, small }: { peer: Peer; small?: boolean }) {
  return (
    <span
      className="presence-avatar"
      data-small={small || undefined}
      aria-hidden="true"
      style={
        { '--presence-color': presenceColorVar(peer.color) } as CSSProperties
      }
      title={small ? undefined : peer.name}
    >
      {initials(peer.name)}
    </span>
  )
}
