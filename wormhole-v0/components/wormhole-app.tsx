"use client"

import { useEffect, useState } from "react"
import { LogOut, Orbit } from "lucide-react"
import { Button } from "@/components/ui/button"
import { LockScreen } from "@/components/lock-screen"
import { WormholePane } from "@/components/wormhole-pane"
import type { Channel } from "@/lib/wormhole-api"

const SESSION_KEY = "wormhole_token"

const SIDES: { channel: Channel; label: string; dot: string; soft: string }[] = [
  { channel: "a", label: "Side A", dot: "var(--side-a)", soft: "var(--side-a-soft)" },
  { channel: "b", label: "Side B", dot: "var(--side-b)", soft: "var(--side-b-soft)" },
]

export function WormholeApp() {
  const [token, setToken] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(SESSION_KEY)
      if (saved) setToken(saved)
    } catch {
      // ignore
    }
    setReady(true)
  }, [])

  function unlock(t: string) {
    try {
      sessionStorage.setItem(SESSION_KEY, t)
    } catch {
      // ignore
    }
    setToken(t)
  }

  function lock() {
    try {
      sessionStorage.removeItem(SESSION_KEY)
    } catch {
      // ignore
    }
    setToken(null)
  }

  if (!ready) return <div className="min-h-dvh bg-background" />

  if (!token) return <LockScreen onUnlock={unlock} />

  return (
    <main className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-lg border border-border bg-card">
            <Orbit className="size-4 text-primary" />
          </div>
          <div className="leading-tight">
            <h1 className="text-sm font-semibold">Wormhole</h1>
            <p className="text-xs text-muted-foreground">Link open</p>
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={lock}>
          <LogOut />
          Lock
        </Button>
      </header>

      <div className="relative flex flex-1 flex-col gap-4 p-4 sm:p-6 lg:flex-row lg:gap-0">
        {/* Side A */}
        <div className="fade-rise min-h-0 flex-1 lg:pr-6">
          <WormholePane side={SIDES[0]} token={token} />
        </div>

        {/* portal divider */}
        <div
          aria-hidden
          className="relative hidden w-px shrink-0 items-stretch justify-center lg:flex"
        >
          <div
            className="portal-beam absolute inset-y-6 w-px"
            style={{
              background:
                "linear-gradient(180deg, transparent, var(--side-a), var(--side-b), transparent)",
              boxShadow: "0 0 18px 2px var(--side-a-soft)",
            }}
          />
          <div className="absolute top-1/2 left-1/2 size-9 -translate-x-1/2 -translate-y-1/2 rounded-full border border-border bg-card shadow-sm" />
          <div
            className="portal-beam absolute top-1/2 left-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              background: "radial-gradient(circle, var(--side-a), var(--side-b))",
            }}
          />
        </div>

        {/* Side B */}
        <div className="fade-rise min-h-0 flex-1 lg:pl-6">
          <WormholePane side={SIDES[1]} token={token} />
        </div>
      </div>
    </main>
  )
}
