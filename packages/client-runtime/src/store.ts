/** A minimal observable value. React reads it with `useSyncExternalStore`; other clients can too. */
export interface ReadableStore<A> {
  readonly get: () => A;
  readonly subscribe: (listener: () => void) => () => void;
}

export interface Store<A> extends ReadableStore<A> {
  readonly set: (value: A) => void;
}

export const makeStore = <A>(
  initial: A,
  lifecycle?: { readonly onFirstListener: () => void; readonly onLastListener: () => void },
): Store<A> => {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      if (Object.is(next, value)) return;
      value = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      if (listeners.size === 1) lifecycle?.onFirstListener();
      return () => {
        if (!listeners.delete(listener)) return;
        if (listeners.size === 0) lifecycle?.onLastListener();
      };
    },
  };
};
