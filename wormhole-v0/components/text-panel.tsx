"use client"

import { useEffect, useRef, useState } from "react"
import { Check, ClipboardPaste, Copy, Loader2, Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { type Channel, getText, setText } from "@/lib/wormhole-api"
import { cn } from "@/lib/utils"

export function TextPanel({
  channel,
  token,
  accent,
}: {
  channel: Channel
  token: string
  accent: string
}) {
  const [value, setValue] = useState("")
  const [saved, setSaved] = useState("")
  const [state, setState] = useState<"loading" | "idle" | "saving" | "done">("loading")
  const [flash, setFlash] = useState<"pasted" | "copied" | null>(null)
  const [clipError, setClipError] = useState<string | null>(null)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let active = true
    getText(channel, token)
      .then((t) => {
        if (!active) return
        setValue(t)
        setSaved(t)
        setState("idle")
      })
      .catch(() => active && setState("idle"))
    return () => {
      active = false
    }
  }, [channel, token])

  const dirty = value !== saved
  const hasContent = value.trim().length > 0

  function flashLabel(kind: "pasted" | "copied") {
    setFlash(kind)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlash(null), 1800)
  }

  async function persist(next: string) {
    setState("saving")
    try {
      await setText(channel, token, next)
      setSaved(next)
      setState("done")
      if (savedTimer.current) clearTimeout(savedTimer.current)
      savedTimer.current = setTimeout(() => setState("idle"), 1800)
      return true
    } catch {
      setState("idle")
      return false
    }
  }

  async function save() {
    if (!dirty || state === "saving") return
    await persist(value)
  }

  // Pull whatever is on the clipboard straight into the node, replacing its
  // contents, and save immediately.
  async function pasteFromClipboard() {
    setClipError(null)
    try {
      const text = await navigator.clipboard.readText()
      setValue(text)
      const ok = await persist(text)
      if (ok) flashLabel("pasted")
    } catch {
      setClipError("Clipboard read blocked — paste into the box manually.")
    }
  }

  // Yank the node's contents out into the clipboard.
  async function copyToClipboard() {
    setClipError(null)
    try {
      await navigator.clipboard.writeText(value)
      flashLabel("copied")
    } catch {
      setClipError("Clipboard write blocked by the browser.")
    }
  }

  return (
    <div className="flex flex-col">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Note
        </h3>
        <div className="flex items-center gap-1.5">
          {flash ? (
            <span className="flex items-center gap-1 text-[11px] font-medium text-primary">
              <Check className="size-3" /> {flash}
            </span>
          ) : dirty ? (
            <span className="text-[11px] font-medium" style={{ color: accent }}>
              unsaved
            </span>
          ) : state === "done" ? (
            <span className="flex items-center gap-1 text-[11px] font-medium text-primary">
              <Check className="size-3" /> saved
            </span>
          ) : null}

          {/* Copy/yank — primary when the node already holds something */}
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={copyToClipboard}
            disabled={!hasContent || state === "loading"}
            title="Copy note to clipboard"
            aria-label="Copy note to clipboard"
            className={cn(hasContent && "text-primary hover:text-primary")}
          >
            <Copy />
          </Button>

          {/* Paste — primary when the node is empty */}
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={pasteFromClipboard}
            disabled={state === "loading" || state === "saving"}
            title="Replace note with clipboard and save"
            aria-label="Paste clipboard into note"
            className={cn(!hasContent && "text-primary hover:text-primary")}
          >
            <ClipboardPaste />
          </Button>
        </div>
      </div>
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={state === "loading" ? "Loading…" : "Type or paste text to share on this side…"}
        disabled={state === "loading"}
        className="min-h-24 resize-y font-mono text-sm"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") save()
        }}
      />
      {clipError ? (
        <p className="mt-1.5 text-[11px] text-destructive" role="alert">
          {clipError}
        </p>
      ) : null}
      <div className="mt-2 flex justify-end">
        <Button size="sm" variant="outline" onClick={save} disabled={!dirty || state === "saving"}>
          {state === "saving" ? <Loader2 className="animate-spin" /> : <Save />}
          Save note
        </Button>
      </div>
    </div>
  )
}
