// The server's output on disk, plus its tail for error dialogs. Adapted from T3 Code's
// apps/desktop/src/backend/DesktopBackendManager.ts (MIT).
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const MAX_LOG_BYTES = 5 * 1024 * 1024;
const TAIL_CHARS = 4_000;

/** Appends to a size-capped file and keeps the previous one beside it as `<file>.1`. */
export class ServerLog {
  readonly path: string;
  readonly #maxBytes: number;
  #fd: number | undefined;
  #size = 0;
  #tail = "";
  #failed = false;

  constructor(path: string, maxBytes = MAX_LOG_BYTES) {
    this.path = path;
    this.#maxBytes = maxBytes;
  }

  write(text: string) {
    this.#tail = (this.#tail + text).slice(-TAIL_CHARS);
    if (this.#failed) return;
    try {
      const bytes = Buffer.byteLength(text);
      let fd = this.#fd ?? this.#open();
      if (this.#size > 0 && this.#size + bytes > this.#maxBytes) {
        this.close();
        NodeFS.renameSync(this.path, `${this.path}.1`);
        fd = this.#open();
      }
      NodeFS.writeSync(fd, text);
      this.#size += bytes;
    } catch {
      // A full disk or an unwritable profile must not take the app down; the tail still works.
      this.#failed = true;
      this.close();
    }
  }

  /** The last few thousand characters, cut so no half of a surrogate pair remains. */
  tail() {
    return this.#tail.toWellFormed();
  }

  close() {
    if (this.#fd === undefined) return;
    try {
      NodeFS.closeSync(this.#fd);
    } finally {
      this.#fd = undefined;
    }
  }

  #open() {
    NodeFS.mkdirSync(NodePath.dirname(this.path), { recursive: true });
    const fd = NodeFS.openSync(this.path, "a");
    this.#fd = fd;
    this.#size = NodeFS.fstatSync(fd).size;
    return fd;
  }
}
