import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>(
    'idle',
  )
  const [error, setError] = useState<string | null>(null)

  async function sendLink(event: FormEvent) {
    event.preventDefault()
    setStatus('sending')
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: window.location.origin },
    })
    if (error) {
      setError(error.message)
      setStatus('error')
    } else {
      setStatus('sent')
    }
  }

  async function signInWithGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
    if (error) {
      setError(error.message)
      setStatus('error')
    }
  }

  return (
    <main className="login">
      <h1>Glovebox</h1>
      <p>Plan road trips together.</p>

      {status === 'sent' ? (
        <p role="status">
          Check <strong>{email}</strong> for a sign-in link.
        </p>
      ) : (
        <form onSubmit={sendLink}>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button type="submit" disabled={status === 'sending'}>
            {status === 'sending' ? 'Sending…' : 'Email me a sign-in link'}
          </button>
        </form>
      )}

      <div className="divider">or</div>
      <button type="button" onClick={signInWithGoogle}>
        Continue with Google
      </button>

      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </main>
  )
}
