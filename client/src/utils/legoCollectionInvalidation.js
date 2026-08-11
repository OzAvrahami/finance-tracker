import { useSyncExternalStore } from 'react';

let revision = 0;
const listeners = new Set();

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = () => revision;

export const invalidateLegoCollection = () => {
  revision += 1;
  listeners.forEach((listener) => listener());
};

export const useLegoCollectionRevision = () => useSyncExternalStore(
  subscribe,
  getSnapshot,
  getSnapshot,
);
