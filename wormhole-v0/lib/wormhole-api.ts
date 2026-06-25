// Typed client for the wormhole Go backend.
//
// Contract (all endpoints scoped to a channel "a" | "b" and require the token):
//   GET    /api/{ch}/list        -> WormholeFile[]
//   POST   /api/{ch}/diff        -> { client_only, server_only, different, same }  (body: { files })
//   POST   /api/{ch}/upload      -> { uploaded, failed }   (multipart/form-data)
//   POST   /api/{ch}/text        -> { saved: true }        (body: { text })
//   GET    /api/{ch}/text        -> text/plain (404 if none)
//   GET    /api/{ch}/download    -> application/zip
//   DELETE /api/{ch}/delete      -> { deleted }            (body: { paths })
//   POST   /api/{ch}/clear       -> { cleared: true }
//   GET    /events?channel={ch}  -> SSE { type: "changed" }
//
// Auth: Authorization: Bearer <token>  AND/OR  ?token=<token>

import { isDemoToken, mock } from "./wormhole-mock"

// Enable demo mode only when explicitly allowed via env flag.
export const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "true"

export type Channel = "a" | "b"

export type WormholeFile = {
  path: string
  size: number
  mtime: number
}

export type DiffResult = {
  /** files the client has that the server does not */
  client_only: string[]
  /** files the server has that the client did not include */
  server_only: string[]
  /** files present on both sides whose content hash differs */
  different: string[]
  /** count of files that are byte-for-byte identical */
  same: number
}

// Base URL of the Go server. Defaults to same origin when unset, so the app
// can also be served from behind the same host as the backend.
export const API_BASE_URL =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_WORMHOLE_API_URL) || ""

function buildUrl(channel: Channel, path: string, token: string, query?: Record<string, string>) {
  const base = API_BASE_URL || (typeof window !== "undefined" ? window.location.origin : "")
  const url = new URL(`/api/${channel}/${path}`, base || "http://localhost")
  url.searchParams.set("token", token)
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
  return url.toString()
}

function authHeaders(token: string, extra?: Record<string, string>): Record<string, string> {
  return { Authorization: `Bearer ${token}`, ...extra }
}

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`
    try {
      const data = await res.json()
      if (data?.error) message = String(data.error)
    } catch {
      // ignore non-JSON error bodies
    }
    throw new WormholeError(message, res.status)
  }
  return res.json() as Promise<T>
}

export class WormholeError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = "WormholeError"
    this.status = status
  }
}

/**
 * Verify a token against the backend. There is no dedicated verify endpoint,
 * so we make an authenticated list call: a 2xx means the token is valid, a 401
 * means it is not. Network errors are surfaced separately.
 */
export async function verifyToken(token: string): Promise<{ ok: boolean; reason?: string }> {
  if (DEMO_MODE && isDemoToken(token)) return { ok: true }
  try {
    const res = await fetch(buildUrl("a", "list", token), {
      method: "GET",
      headers: authHeaders(token),
    })
    if (res.ok) return { ok: true }
    if (res.status === 401 || res.status === 403) return { ok: false, reason: "Invalid token." }
    return { ok: false, reason: `Server responded with ${res.status}.` }
  } catch {
    return { ok: false, reason: "Could not reach the server. Check the API URL." }
  }
}

export function listFiles(channel: Channel, token: string): Promise<WormholeFile[]> {
  if (DEMO_MODE && isDemoToken(token)) return mock.list(channel)
  return fetch(buildUrl(channel, "list", token), { headers: authHeaders(token) }).then((r) =>
    asJson<WormholeFile[]>(r),
  )
}

export function getDiff(
  channel: Channel,
  token: string,
  manifest: Record<string, string>,
): Promise<DiffResult> {
  if (DEMO_MODE && isDemoToken(token)) return mock.diff(channel, manifest)
  return fetch(buildUrl(channel, "diff", token), {
    method: "POST",
    headers: authHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ files: manifest }),
  }).then((r) => asJson<DiffResult>(r))
}

/** SHA-256 of an ArrayBuffer as a lowercase hex string (Web Crypto). */
export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

export type SyncResult = { uploaded: number; skipped: number; failed: number }

/**
 * Diff-based upload. Hashes every selected file locally, asks the server which
 * paths are new (client_only) or changed (different), and uploads only those —
 * so re-pushing a large folder/repo only streams what actually changed.
 *
 * `onProgress` reports the hashing phase so the UI can show progress for big trees.
 * Falls back to a full upload if the diff endpoint is unavailable.
 */
export async function syncUpload(
  channel: Channel,
  token: string,
  items: UploadItem[],
  onProgress?: (hashed: number, total: number) => void,
): Promise<SyncResult> {
  if (items.length === 0) return { uploaded: 0, skipped: 0, failed: 0 }

  const manifest: Record<string, string> = {}
  for (let i = 0; i < items.length; i++) {
    manifest[items[i].path] = await sha256Hex(await items[i].file.arrayBuffer())
    onProgress?.(i + 1, items.length)
  }

  let toUpload = items
  let skipped = 0
  try {
    const diff = await getDiff(channel, token, manifest)
    const wanted = new Set([...(diff.client_only ?? []), ...(diff.different ?? [])])
    toUpload = items.filter((it) => wanted.has(it.path))
    skipped = items.length - toUpload.length
  } catch {
    // Diff endpoint unavailable — fall back to uploading everything.
    toUpload = items
    skipped = 0
  }

  if (toUpload.length === 0) return { uploaded: 0, skipped, failed: 0 }
  const res = await uploadFiles(channel, token, toUpload)
  return { uploaded: res.uploaded, skipped, failed: res.failed }
}

export type UploadItem = { file: File; path: string }

export function uploadFiles(
  channel: Channel,
  token: string,
  items: UploadItem[],
): Promise<{ uploaded: number; failed: number }> {
  if (DEMO_MODE && isDemoToken(token)) return mock.upload(channel, items)
  const fd = new FormData()
  for (const { file, path } of items) {
    fd.append("file", file, file.name)
    fd.append("path", path)
  }
  return fetch(buildUrl(channel, "upload", token), {
    method: "POST",
    headers: authHeaders(token),
    body: fd,
  }).then((r) => asJson<{ uploaded: number; failed: number }>(r))
}

export function setText(channel: Channel, token: string, text: string): Promise<{ saved: boolean }> {
  if (DEMO_MODE && isDemoToken(token)) return mock.setText(channel, text)
  return fetch(buildUrl(channel, "text", token), {
    method: "POST",
    headers: authHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ text }),
  }).then((r) => asJson<{ saved: boolean }>(r))
}

export async function getText(channel: Channel, token: string): Promise<string> {
  if (DEMO_MODE && isDemoToken(token)) return mock.getText(channel)
  const res = await fetch(buildUrl(channel, "text", token), { headers: authHeaders(token) })
  if (res.status === 404) return ""
  if (!res.ok) throw new WormholeError(`Failed to load text (${res.status})`, res.status)
  return res.text()
}

export function downloadZip(channel: Channel, token: string) {
  if (DEMO_MODE && isDemoToken(token)) return mock.download(channel)
  const link = document.createElement("a")
  link.href = buildUrl(channel, "download", token)
  link.download = `${channel}.zip`
  document.body.appendChild(link)
  link.click()
  link.remove()
}

export function fileDownloadUrl(channel: Channel, token: string, path: string) {
  // Single-file fetch via the channel download with a path filter is not part
  // of the contract, so we link to the channel zip. For previewing individual
  // files we read them through the standard fetch below instead.
  return buildUrl(channel, "download", token, { path })
}

export function deleteFiles(
  channel: Channel,
  token: string,
  paths: string[],
): Promise<{ deleted: number }> {
  if (DEMO_MODE && isDemoToken(token)) return mock.deleteFiles(channel, paths)
  return fetch(buildUrl(channel, "delete", token), {
    method: "DELETE",
    headers: authHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ paths }),
  }).then((r) => asJson<{ deleted: number }>(r))
}

export function clearChannel(channel: Channel, token: string): Promise<{ cleared: boolean }> {
  if (DEMO_MODE && isDemoToken(token)) return mock.clear(channel)
  return fetch(buildUrl(channel, "clear", token), {
    method: "POST",
    headers: authHeaders(token),
  }).then((r) => asJson<{ cleared: boolean }>(r))
}

/** Subscribe to live change events for a channel. Returns an unsubscribe fn. */
export function subscribe(channel: Channel, token: string, onChange: () => void): () => void {
  if (DEMO_MODE && isDemoToken(token)) return mock.subscribe(channel, onChange)
  const base = API_BASE_URL || (typeof window !== "undefined" ? window.location.origin : "")
  const url = new URL("/events", base || "http://localhost")
  url.searchParams.set("channel", channel)
  url.searchParams.set("token", token)
  const es = new EventSource(url.toString())
  es.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data)
      if (data?.type === "changed") onChange()
    } catch {
      // a bare ping with no JSON still means "something happened"
      onChange()
    }
  }
  return () => es.close()
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ["KB", "MB", "GB", "TB"]
  let value = bytes / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`
}
