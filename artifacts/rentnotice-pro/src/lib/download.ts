/**
 * Download helper that works in both environments this app ships in:
 *
 * - Web (dev preview / browsers): a plain anchor with the `download`
 *   attribute saves the blob directly.
 * - Desktop (Tauri): the macOS WKWebView silently ignores anchor downloads of
 *   blob: URLs, so we hand the bytes to the Rust `save_file` command, which
 *   shows a native "Save as…" dialog and writes the file.
 */

type TauriInvoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

function tauriInvoke(): TauriInvoke | null {
  if (typeof window === "undefined") return null;
  const tauri = (window as { __TAURI__?: { core?: { invoke?: TauriInvoke } } }).__TAURI__;
  return tauri?.core?.invoke ?? null;
}

export type SaveResult = "saved" | "cancelled" | "fallback";

/** Save a generated document. Returns how the save was handled. */
export async function saveDocument(fileName: string, blobUrl: string): Promise<SaveResult> {
  const invoke = tauriInvoke();
  if (invoke) {
    const res = await fetch(blobUrl);
    const bytes = Array.from(new Uint8Array(await res.arrayBuffer()));
    const savedPath = (await invoke("save_file", { fileName, bytes })) as string | null;
    return savedPath ? "saved" : "cancelled";
  }
  const anchor = document.createElement("a");
  anchor.href = blobUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  return "fallback";
}
