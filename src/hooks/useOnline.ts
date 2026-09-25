import { useSyncExternalStore } from 'react';

const subscribe = (cb: () => void) => {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
};

/**
 * navigator.onLine может соврать в сторону «онлайн» (Wi-Fi есть, интернета нет),
 * но «офлайн» он сообщает надёжно — этого достаточно, чтобы заранее предупредить.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}
