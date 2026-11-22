// Adapted from T3 Code (https://github.com/pingdotgg/t3code, MIT).

export interface ConfirmOptions {
  /** A question, such as "Revoke this device?". */
  readonly title: string;
  readonly description?: string;
  /** The verb on the confirm button, such as "Revoke". */
  readonly confirmLabel: string;
  readonly destructive?: boolean;
}

/** `options` outlives `open` while the dialog animates out, so its text does not blank. */
export interface ConfirmDialogState {
  readonly open: boolean;
  readonly options: ConfirmOptions | null;
}

interface Request {
  readonly options: ConfirmOptions;
  readonly resolve: (confirmed: boolean) => void;
}

const closed: ConfirmDialogState = { open: false, options: null };
let state = closed;
let active: Request | null = null;
let queue: Array<Request> = [];
const hosts = new Set<() => void>();

const publish = (next: ConfirmDialogState) => {
  state = next;
  for (const host of hosts) host();
};

const show = (request: Request) => {
  active = request;
  publish({ open: true, options: request.options });
};

/**
 * Asks through the dialog host in the root route, one question at a time. Resolves `false`
 * when no host is mounted, so a destructive action never runs unconfirmed.
 */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  if (hosts.size === 0) return Promise.resolve(false);
  return new Promise((resolve) => {
    const request = { options, resolve };
    if (state === closed) show(request);
    else queue.push(request);
  });
}

export const readConfirmDialog = (): ConfirmDialogState => state;

/** For the host. When the last one unmounts, open and queued questions resolve `false`. */
export function subscribeConfirmDialog(host: () => void): () => void {
  hosts.add(host);
  return () => {
    hosts.delete(host);
    if (hosts.size > 0) return;
    for (const request of [...(active ? [active] : []), ...queue]) request.resolve(false);
    active = null;
    queue = [];
    state = closed;
  };
}

export function respondToConfirm(confirmed: boolean): void {
  if (active === null) return;
  const { options, resolve } = active;
  active = null;
  resolve(confirmed);
  publish({ open: false, options });
}

/** The close animation finished; show the next question. */
export function completeConfirmClose(): void {
  if (state.open) return;
  const next = queue.shift();
  if (next) show(next);
  else if (state !== closed) publish(closed);
}
