const DB_NAME = "pathshift";
const STORE_NAME = "autosave";
const KEY = "document";
const HISTORY_KEY = "recovery-history";
export const RECOVERY_LIMIT = 20;
export const RECOVERY_INTERVAL_MS = 30000;
export interface RecoveryCheckpoint {
  savedAt: number;
  payload: unknown;
}
export class AutosaveConflictError extends Error {
  constructor() {
    super(
      "Another tab saved a newer document. Export your current edits before reopening the latest save.",
    );
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME))
        request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Local storage is blocked by another tab."));
  });
}

export function retainRecoveryCheckpoint(
  history: RecoveryCheckpoint[],
  previous: unknown,
  now: number,
  force = false,
): RecoveryCheckpoint[] {
  if (previous == null) return history;
  if (!force && history[0] && now - history[0].savedAt < RECOVERY_INTERVAL_MS) return history;
  return [{ savedAt: now, payload: previous }, ...history].slice(0, RECOVERY_LIMIT);
}

/** Read/compare/write and checkpoint are one IndexedDB transaction across tabs. */
export async function writeAutosave(
  payload: unknown,
  expectedSignature: string | null,
  forceCheckpoint = false,
) {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      let conflict: AutosaveConflictError | null = null;
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(conflict ?? tx.error);
      tx.onabort = () => reject(conflict ?? tx.error);
      const current = store.get(KEY);
      current.onsuccess = () => {
        const value = current.result ?? null;
        if ((value == null ? null : JSON.stringify(value)) !== expectedSignature) {
          conflict = new AutosaveConflictError();
          tx.abort();
          return;
        }
        const history = store.get(HISTORY_KEY);
        history.onsuccess = () => {
          const retained = retainRecoveryCheckpoint(
            Array.isArray(history.result) ? history.result : [],
            value,
            Date.now(),
            forceCheckpoint,
          );
          if (retained.length) store.put(retained, HISTORY_KEY);
          store.put(payload, KEY);
        };
      };
    });
  } finally {
    db.close();
  }
}

async function readRecord(key: string): Promise<unknown | null> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export const readAutosave = () => readRecord(KEY);
export async function readRecoveryCheckpoints(): Promise<RecoveryCheckpoint[]> {
  const record = await readRecord(HISTORY_KEY);
  return Array.isArray(record)
    ? record.filter(
        (entry) =>
          entry &&
          Number.isFinite(entry.savedAt) &&
          entry.savedAt >= 0 &&
          entry.savedAt < 8640000000000000 &&
          entry.payload != null,
      )
    : [];
}
