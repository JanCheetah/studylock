import { describe, expect, it, vi } from 'vitest'
import { getAuthState, sendMagicLink } from './auth'

describe('auth helpers', () => {
  it('reports unconfigured auth when no Supabase client exists', async () => {
    await expect(getAuthState(null)).resolves.toMatchObject({
      configured: false,
      authenticated: false,
      email: null,
      label: 'Cloud Login aus',
    })
  })

  it('sends a magic link with the current origin as redirect target', async () => {
    const signInWithOtp = vi.fn().mockResolvedValue({ error: null })
    const client = { auth: { signInWithOtp } }

    await sendMagicLink(' jan@example.com ', client, 'https://studylock.test/app')

    expect(signInWithOtp).toHaveBeenCalledWith({
      email: 'jan@example.com',
      options: { emailRedirectTo: 'https://studylock.test/app' },
    })
  })

  it('surfaces magic-link errors instead of silently pretending success', async () => {
    const signInWithOtp = vi.fn().mockResolvedValue({ error: new Error('rate limited') })
    const client = { auth: { signInWithOtp } }

    await expect(sendMagicLink('jan@example.com', client, 'https://studylock.test')).rejects.toThrow('rate limited')
  })
})
