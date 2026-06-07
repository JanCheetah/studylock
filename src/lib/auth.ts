import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from './supabaseClient'

export type AuthState = {
  configured: boolean
  authenticated: boolean
  email: string | null
  label: string
  detail: string
}

type AuthClient = Pick<SupabaseClient, 'auth'> | { auth: {
  getUser?: () => Promise<{ data?: { user?: { email?: string | null } | null }, error?: Error | null }>
  signInWithOtp?: (args: { email: string, options: { emailRedirectTo: string } }) => Promise<{ error?: Error | null }>
  signOut?: () => Promise<{ error?: Error | null }>
  onAuthStateChange?: (callback: () => void) => { data: { subscription: { unsubscribe: () => void } } }
} }

export async function getAuthState(client: AuthClient | null = supabase): Promise<AuthState> {
  if (!client) {
    return {
      configured: false,
      authenticated: false,
      email: null,
      label: 'Cloud Login aus',
      detail: 'Keine Supabase Env gesetzt. StudyLock bleibt lokal nutzbar.',
    }
  }

  const { data, error } = await client.auth.getUser!()
  if (error) throw error
  const email = data?.user?.email ?? null
  return {
    configured: true,
    authenticated: Boolean(data?.user),
    email,
    label: data?.user ? 'Eingeloggt' : 'Magic-Link Login bereit',
    detail: data?.user
      ? `${email ?? 'User'} kann lokale Daten jetzt in die Cloud synchronisieren.`
      : 'Sende dir einen Magic Link. Bis dahin bleibt alles lokal gespeichert.',
  }
}

export async function sendMagicLink(email: string, client: AuthClient | null = supabase, redirectTo = window.location.origin): Promise<void> {
  if (!client) throw new Error('Supabase ist nicht konfiguriert')
  const normalizedEmail = email.trim().toLowerCase()
  if (!normalizedEmail.includes('@')) throw new Error('Bitte eine gültige E-Mail eingeben')
  const { error } = await client.auth.signInWithOtp!({
    email: normalizedEmail,
    options: { emailRedirectTo: redirectTo },
  })
  if (error) throw error
}

export async function signOut(client: AuthClient | null = supabase): Promise<void> {
  if (!client) return
  const { error } = await client.auth.signOut!()
  if (error) throw error
}

export function subscribeToAuthChanges(onChange: () => void, client: AuthClient | null = supabase): () => void {
  if (!client || !client.auth.onAuthStateChange) return () => undefined
  const { data } = client.auth.onAuthStateChange(onChange)
  return () => data.subscription.unsubscribe()
}
