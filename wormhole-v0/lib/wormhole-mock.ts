// In-memory fake backend so the UI can be explored without the real Go server.
// Activated when the user logs in with the demo token (see DEMO_TOKEN).
//
// It mirrors the same shapes the real API returns, plus a tiny pub/sub so the
// SSE-style live updates work locally.

import type { Channel, DiffResult, UploadItem, WormholeFile } from "./wormhole-api"

export const DEMO_TOKEN = "demo"

export function isDemoToken(token: string): boolean {
  return token.trim().toLowerCase() === DEMO_TOKEN
}

type FileMeta = { size: number; mtime: number; blob: Blob; hash?: string }

type ChannelState = {
  files: Map<string, FileMeta>
  text: string
}

type Store = Record<Channel, ChannelState>

async function hashBlob(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

function seed(): Store {
  const now = Date.now()
  const mk = (size: number, ageMin: number) => ({
    size,
    mtime: Math.floor((now - ageMin * 60_000) / 1000),
    blob: new Blob(["demo content"], { type: "text/plain" }),
  })
  return {
    a: {
      files: new Map<string, FileMeta>([
        ["briefing.md", mk(2480, 12)],
        ["assets/logo.svg", mk(5310, 48)],
        ["assets/hero.png", mk(184320, 130)],
      ]),
      text: "Drop notes here and they sync to the other side.\n\nThis is the demo channel — try uploading a file or folder.",
    },
    b: {
      files: new Map<string, FileMeta>([["response.txt", mk(640, 5)]]),
      text: "",
    },
  }
}

// Persist across hot reloads within a session.
const g = globalThis as unknown as { __wormholeMock?: Store }
const store: Store = g.__wormholeMock ?? (g.__wormholeMock = seed())

const listeners: Record<Channel, Set<() => void>> = { a: new Set(), b: new Set() }

function emit(channel: Channel) {
  for (const fn of listeners[channel]) fn()
}

// Simulate a little network latency so loading states are visible.
function delay<T>(value: T, ms = 220): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

export const mock = {
  list(channel: Channel): Promise<WormholeFile[]> {
    const files = [...store[channel].files.entries()].map(([path, meta]) => ({
      path,
      size: meta.size,
      mtime: meta.mtime,
    }))
    files.sort((a, b) => a.path.localeCompare(b.path))
    return delay(files)
  },

  async diff(channel: Channel, manifest: Record<string, string>): Promise<DiffResult> {
    const ch = store[channel]
    // Ensure every stored file has a cached content hash.
    for (const meta of ch.files.values()) {
      if (!meta.hash) meta.hash = await hashBlob(meta.blob)
    }
    const client_only: string[] = []
    const different: string[] = []
    const server_only: string[] = []
    let same = 0
    for (const [path, clientHash] of Object.entries(manifest)) {
      const meta = ch.files.get(path)
      if (!meta) client_only.push(path)
      else if (meta.hash !== clientHash) different.push(path)
      else same++
    }
    for (const path of ch.files.keys()) {
      if (!(path in manifest)) server_only.push(path)
    }
    return delay({ client_only, server_only, different, same })
  },

  async upload(
    channel: Channel,
    items: UploadItem[],
  ): Promise<{ uploaded: number; failed: number }> {
    const now = Math.floor(Date.now() / 1000)
    for (const { file, path } of items) {
      const key = (path || file.name).replace(/^\/+/, "")
      store[channel].files.set(key, {
        size: file.size,
        mtime: now,
        blob: file,
        hash: await hashBlob(file),
      })
    }
    emit(channel)
    return delay({ uploaded: items.length, failed: 0 })
  },

  setText(channel: Channel, text: string): Promise<{ saved: boolean }> {
    store[channel].text = text
    emit(channel)
    return delay({ saved: true })
  },

  getText(channel: Channel): Promise<string> {
    return delay(store[channel].text)
  },

  deleteFiles(channel: Channel, paths: string[]): Promise<{ deleted: number }> {
    let deleted = 0
    for (const p of paths) {
      // support directory-style deletes ("dir/")
      if (p.endsWith("/")) {
        for (const key of [...store[channel].files.keys()]) {
          if (key.startsWith(p)) {
            store[channel].files.delete(key)
            deleted++
          }
        }
      } else if (store[channel].files.delete(p)) {
        deleted++
      }
    }
    emit(channel)
    return delay({ deleted })
  },

  clear(channel: Channel): Promise<{ cleared: boolean }> {
    store[channel].files.clear()
    store[channel].text = ""
    emit(channel)
    return delay({ cleared: true })
  },

  download(channel: Channel) {
    // No real zip in demo mode — hand back a small text blob describing it.
    const names = [...store[channel].files.keys()].join("\n") || "(empty)"
    const blob = new Blob([`Demo ZIP for side ${channel.toUpperCase()}:\n\n${names}`], {
      type: "text/plain",
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `${channel}-demo.txt`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  },

  subscribe(channel: Channel, onChange: () => void): () => void {
    listeners[channel].add(onChange)
    return () => listeners[channel].delete(onChange)
  },
}
