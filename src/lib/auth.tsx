// ---------------------------------------------------------------------------
// Identity hook. The public build of this viewer has no sign-in and no server,
// so every visitor is a "guest" and `isMember` is always false. The hook is
// kept around so a fork that adds real auth (OIDC, OAuth, magic link, …) only
// needs to swap the provider — every call site is already wired up.
// ---------------------------------------------------------------------------
import { createContext, useContext, useState, type ReactNode } from 'react'

export type Account = { kind: 'guest' }

interface AuthCtx {
  user: Account | null
  /** True when the visitor is a signed-in member (gated UI / activity logging). */
  isMember: boolean
  signIn: (name: string, password: string) => boolean
  continueAsGuest: () => void
  signOut: () => void
  /** Record a UI event (label edit, annotation, …). No-op when not signed in. */
  record: (event: Record<string, unknown>) => void
  activity: Record<string, unknown>[]
}

const noop = () => {}
const Ctx = createContext<AuthCtx>({
  user: { kind: 'guest' },
  isMember: false,
  signIn: () => false,
  continueAsGuest: noop,
  signOut: noop,
  record: noop,
  activity: [],
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [activity] = useState<Record<string, unknown>[]>([])
  return (
    <Ctx.Provider
      value={{
        user: { kind: 'guest' },
        isMember: false,
        signIn: () => false,
        continueAsGuest: noop,
        signOut: noop,
        record: noop,
        activity,
      }}
    >
      {children}
    </Ctx.Provider>
  )
}

export function useAuth() {
  return useContext(Ctx)
}
