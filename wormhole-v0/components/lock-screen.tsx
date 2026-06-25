"use client"

import type React from "react"

import { useState } from "react"
import { ArrowRight, KeyRound, Loader2, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { verifyToken, API_BASE_URL } from "@/lib/wormhole-api"
import { DEMO_MODE } from "@/lib/wormhole-api"

export function LockScreen({ onUnlock }: { onUnlock: (token: string) => void }) {
  const [token, setToken] = useState("")
  const [status, setStatus] = useState<"idle" | "verifying" | "error">("idle")
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!token.trim() || status === "verifying") return
    setStatus("verifying")
    setError(null)
    const result = await verifyToken(token.trim())
    if (result.ok) {
      onUnlock(token.trim())
    } else {
      setStatus("error")
      setError(result.reason ?? "Verification failed.")
    }
  }

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4">
      {/* ambient portal glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 size-[36rem] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-60 blur-3xl"
        style={{
          background:
            "radial-gradient(circle, var(--side-a-soft) 0%, var(--side-b-soft) 45%, transparent 70%)",
        }}
      />

      <div className="fade-rise relative w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="relative mb-5 flex size-16 items-center justify-center rounded-2xl border border-border bg-card shadow-sm">
            <div
              aria-hidden
              className="absolute inset-0 rounded-2xl opacity-70"
              style={{
                background:
                  "linear-gradient(135deg, var(--side-a-soft), transparent 40%, var(--side-b-soft))",
              }}
            />
            <KeyRound className="relative size-7 text-primary" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-balance">Wormhole</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground text-pretty">
            A private channel between two sides. Enter your access token to open the link.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-border bg-card p-5 shadow-sm"
        >
          <label htmlFor="token" className="mb-2 block text-sm font-medium">
            Access token
          </label>
          <Input
            id="token"
            type="password"
            autoComplete="off"
            autoFocus
            placeholder="paste your static token"
            value={token}
            onChange={(e) => {
              setToken(e.target.value)
              if (status === "error") setStatus("idle")
            }}
            className="h-10 font-mono text-sm"
            aria-invalid={status === "error"}
          />

          {error ? (
            <p className="mt-2 text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="size-3.5" />
              Verified directly against your server.
            </p>
          )}

          <Button
            type="submit"
            size="lg"
            className="mt-4 h-10 w-full"
            disabled={!token.trim() || status === "verifying"}
          >
            {status === "verifying" ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Verifying
              </>
            ) : (
              <>
                Open wormhole
                <ArrowRight className="size-4" />
              </>
            )}
          </Button>
        </form>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          {API_BASE_URL ? (
            <>
              Connected to <span className="font-mono">{API_BASE_URL}</span>
            </>
          ) : (
            <>Connecting to the current origin</>
          )}
        </p>

        {DEMO_MODE && (
          <button
            type="button"
            onClick={() => {
              setToken("demo")
              setStatus("idle")
              setError(null)
            }}
            className="mt-3 w-full text-center text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            No server handy? Use the token{" "}
            <span className="font-mono font-medium text-primary">demo</span> to explore an offline
            sandbox.
          </button>
        )}
      </div>
    </main>
  )
}
