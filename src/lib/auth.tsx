// ---------------------------------------------------------------------------
// Open-source build: no auth. The hook exists only so legacy call sites
// (`useAuth().isTencent`, `.record(...)`, etc.) continue to type-check without
// edits. Every viewer is a guest.
// ---------------------------------------------------------------------------
import { createContext, useContext, useState, type ReactNode } from 'react'

export type Account = { kind: 'guest' }

interface AuthCtx {
  user: Account | null
  isTencent: boolean
  loginTencent: (name: string, password: string) => boolean
  continueAsGuest: () => void
  logout: () => void
  record: (event: Record<string, unknown>) => void
  activity: Record<string, unknown>[]
}

const noop = () => {}
const Ctx = createContext<AuthCtx>({
  user: { kind: 'guest' },
  isTencent: false,
  loginTencent: () => false,
  continueAsGuest: noop,
  logout: noop,
  record: noop,
  activity: [],
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [activity] = useState<Record<string, unknown>[]>([])
  return (
    <Ctx.Provider
      value={{
        user: { kind: 'guest' },
        isTencent: false,
        loginTencent: () => false,
        continueAsGuest: noop,
        logout: noop,
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
