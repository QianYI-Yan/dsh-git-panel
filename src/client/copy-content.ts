/**
 * Eligibility of the file browser's "copy file content" button. The copy
 * applies only to a loaded text preview — documents and code; binary, image,
 * over-cap, and error states carry no copyable body — and only while the
 * file stays strictly under the shared copy envelope, so oversized or
 * non-text files never reach the clipboard.
 */
import { FILE_COPY_MAX_BYTES } from './types.js'

/** Structural face of the Files-tab file state this guard reads. */
export interface CopyableFile {
  readonly kind: string
  readonly size?: number | undefined
  readonly content?: string | undefined
}

export function canCopyContent(file: CopyableFile): boolean {
  if (file.kind !== 'text') return false
  // The host stat size is authoritative; without it (older payload) fall
  // back to the loaded body's UTF-8 length so the envelope still holds.
  if (file.size !== undefined) return file.size < FILE_COPY_MAX_BYTES
  return new TextEncoder().encode(file.content ?? '').length < FILE_COPY_MAX_BYTES
}
