"use client"

import type React from "react"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  Download,
  File as FileIcon,
  FilePlus2,
  FolderPlus,
  Loader2,
  Radio,
  Trash2,
  Upload,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  type Channel,
  type UploadItem,
  type WormholeFile,
  clearChannel,
  deleteFiles,
  downloadZip,
  formatBytes,
  listFiles,
  subscribe,
  syncUpload,
} from "@/lib/wormhole-api"
import { TextPanel } from "@/components/text-panel"
import { cn } from "@/lib/utils"

type Side = {
  channel: Channel
  label: string
  dot: string
  soft: string
}

async function readDataTransferItems(items: DataTransferItemList): Promise<UploadItem[]> {
  const out: UploadItem[] = []

  function readEntry(entry: any, prefix: string): Promise<void> {
    return new Promise((resolve) => {
      if (entry.isFile) {
        entry.file((file: File) => {
          out.push({ file, path: prefix ? `${prefix}/${file.name}` : file.name })
          resolve()
        })
      } else if (entry.isDirectory) {
        const reader = entry.createReader()
        const collected: any[] = []
        const readBatch = () => {
          reader.readEntries(async (entries: any[]) => {
            if (entries.length === 0) {
              await Promise.all(
                collected.map((e) =>
                  readEntry(e, prefix ? `${prefix}/${entry.name}` : entry.name),
                ),
              )
              resolve()
            } else {
              collected.push(...entries)
              readBatch()
            }
          })
        }
        readBatch()
      } else {
        resolve()
      }
    })
  }

  const entries: any[] = []
  for (let i = 0; i < items.length; i++) {
    const entry = items[i].webkitGetAsEntry?.()
    if (entry) entries.push(entry)
  }
  await Promise.all(entries.map((e) => readEntry(e, "")))
  return out
}

export function WormholePane({ side, token }: { side: Side; token: string }) {
  const [files, setFiles] = useState<WormholeFile[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [live, setLive] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [phase, setPhase] = useState<{ label: string; done: number; total: number } | null>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    try {
      const list = await listFiles(side.channel, token)
      setFiles(list.filter((f) => f.path !== "text.txt"))
      setError(null)
    } catch (e: any) {
      setError(e?.message ?? "Failed to load files.")
    } finally {
      setLoading(false)
    }
  }, [side.channel, token])

  useEffect(() => {
    refresh()
    let unsub = () => {}
    try {
      unsub = subscribe(side.channel, token, () => {
        setLive(true)
        refresh()
      })
      setLive(true)
    } catch {
      setLive(false)
    }
    return () => unsub()
  }, [refresh, side.channel, token])

  const flashNotice = useCallback((msg: string) => {
    setNotice(msg)
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(null), 4000)
  }, [])

  const handleUpload = useCallback(
    async (items: UploadItem[]) => {
      if (items.length === 0) return
      setBusy(true)
      setError(null)
      setNotice(null)
      try {
        // Hash files locally, then upload only what the server is missing or
        // has an older version of (diff-based upload).
        setPhase({ label: "Hashing", done: 0, total: items.length })
        const res = await syncUpload(side.channel, token, items, (done, total) =>
          setPhase({ label: "Hashing", done, total }),
        )
        setPhase(null)
        await refresh()
        const parts: string[] = []
        if (res.uploaded > 0) parts.push(`${res.uploaded} uploaded`)
        if (res.skipped > 0) parts.push(`${res.skipped} unchanged, skipped`)
        if (res.failed > 0) parts.push(`${res.failed} failed`)
        if (res.uploaded === 0 && res.skipped > 0) {
          flashNotice(`Already up to date — ${res.skipped} identical file${res.skipped === 1 ? "" : "s"} skipped.`)
        } else if (parts.length) {
          flashNotice(parts.join(" · "))
        }
      } catch (e: any) {
        setError(e?.message ?? "Upload failed.")
      } finally {
        setPhase(null)
        setBusy(false)
      }
    },
    [flashNotice, refresh, side.channel, token],
  )

  const onFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files ?? [])
    handleUpload(list.map((file) => ({ file, path: file.webkitRelativePath || file.name })))
    e.target.value = ""
  }

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    if (e.dataTransfer.items?.length) {
      const items = await readDataTransferItems(e.dataTransfer.items)
      handleUpload(items)
    } else {
      handleUpload(Array.from(e.dataTransfer.files).map((file) => ({ file, path: file.name })))
    }
  }

  const onDelete = async (path: string) => {
    setBusy(true)
    try {
      await deleteFiles(side.channel, token, [path])
      await refresh()
    } catch (e: any) {
      setError(e?.message ?? "Delete failed.")
    } finally {
      setBusy(false)
    }
  }

  const onClear = async () => {
    if (!confirm(`Clear everything on ${side.label}? This cannot be undone.`)) return
    setBusy(true)
    try {
      await clearChannel(side.channel, token)
      await refresh()
    } catch (e: any) {
      setError(e?.message ?? "Clear failed.")
    } finally {
      setBusy(false)
    }
  }

  const totalSize = files.reduce((acc, f) => acc + f.size, 0)

  return (
    <section
      className="flex h-full flex-col rounded-2xl border border-border bg-card shadow-sm"
      aria-label={side.label}
    >
      {/* header */}
      <header
        className="flex items-center justify-between gap-3 rounded-t-2xl border-b border-border px-5 py-4"
        style={{ background: `linear-gradient(180deg, ${side.soft}, transparent)` }}
      >
        <div className="flex items-center gap-2.5">
          <span
            className="size-2.5 rounded-full"
            style={{ backgroundColor: side.dot }}
            aria-hidden
          />
          <div>
            <h2 className="text-sm font-semibold leading-none">{side.label}</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {files.length} {files.length === 1 ? "file" : "files"} · {formatBytes(totalSize)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "mr-1 inline-flex items-center gap-1 text-[11px] font-medium",
              live ? "text-primary" : "text-muted-foreground",
            )}
            title={live ? "Live updates active" : "Live updates unavailable"}
          >
            <Radio className={cn("size-3", live && "animate-pulse")} />
            {live ? "live" : "offline"}
          </span>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => downloadZip(side.channel, token)}
            disabled={files.length === 0}
            title="Download all as ZIP"
            aria-label="Download all as ZIP"
          >
            <Download />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={onClear}
            disabled={busy || (files.length === 0 && true)}
            title="Clear channel"
            aria-label="Clear channel"
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 />
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 p-5">
        {/* drop zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            "relative flex flex-col items-center justify-center rounded-xl border border-dashed px-4 py-6 text-center transition-colors",
            dragging ? "border-primary bg-primary/5" : "border-border bg-muted/40",
          )}
        >
          <div className="mb-2 flex size-9 items-center justify-center rounded-full bg-card text-muted-foreground shadow-sm">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          </div>
          <p className="text-sm font-medium">
            {phase
              ? `${phase.label} ${phase.done}/${phase.total}…`
              : busy
                ? "Syncing…"
                : "Drop files or folders"}
          </p>
          <p className="mb-3 text-xs text-muted-foreground">
            {busy ? "Only changed files are uploaded" : "or pick from your device"}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
              <FilePlus2 />
              Files
            </Button>
            <Button size="sm" variant="outline" onClick={() => folderInputRef.current?.click()}>
              <FolderPlus />
              Folder
            </Button>
          </div>
          <input ref={fileInputRef} type="file" multiple hidden onChange={onFilePick} />
          <input
            ref={folderInputRef}
            type="file"
            hidden
            onChange={onFilePick}
            // @ts-expect-error non-standard but widely supported
            webkitdirectory=""
            directory=""
          />
        </div>

        {error ? (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        {notice ? (
          <p
            className="fade-rise rounded-lg bg-primary/10 px-3 py-2 text-xs font-medium text-primary"
            role="status"
          >
            {notice}
          </p>
        ) : null}

        {/* file list */}
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Files
            </h3>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-border">
            {loading ? (
              <div className="flex h-full items-center justify-center py-10 text-sm text-muted-foreground">
                <Loader2 className="mr-2 size-4 animate-spin" />
                Loading
              </div>
            ) : files.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center px-4 py-10 text-center">
                <FileIcon className="mb-2 size-5 text-muted-foreground/60" />
                <p className="text-sm text-muted-foreground">Nothing here yet.</p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {files.map((f) => (
                  <li
                    key={f.path}
                    className="group flex items-center gap-3 px-3 py-2.5 hover:bg-muted/50"
                  >
                    <FileIcon className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium" title={f.path}>
                        {f.path}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatBytes(f.size)} · {new Date(f.mtime * 1000).toLocaleString()}
                      </p>
                    </div>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      className="opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
                      onClick={() => onDelete(f.path)}
                      disabled={busy}
                      aria-label={`Delete ${f.path}`}
                    >
                      <X />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* text panel */}
        <TextPanel channel={side.channel} token={token} accent={side.dot} />
      </div>
    </section>
  )
}
