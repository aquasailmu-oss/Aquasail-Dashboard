const DB_NAME = "aquasail-island";
const DB_VERSION = 1;
const MANIFEST_STORE = "manifest";
const QUEUE_STORE = "queue";

export type ManifestBooking = {
  booking_id: string;
  token_hash: string | null;
  reference: string;
  surname: string;
  client_first_initial: string;
  adults: number;
  children: number;
  infants: number;
  service_date: string;
  departure_time: string | null;
  meeting_point: string | null;
  checked_in_at: string | null;
  entitlements: {
    booking_activity_id: string;
    activity_code: string;
    activity_name: string;
    quantity: number;
    already_redeemed: number;
  }[];
};

export type ManifestData = {
  generated_at: string;
  business_date: string;
  bookings: ManifestBooking[];
};

export type QueueItemType = "redeem" | "check_in";

export type QueueItem = {
  id: string;
  type: QueueItemType;
  client_uuid: string;
  payload: Record<string, unknown>;
  created_at: string;
  occurred_at_device: string;
  synced?: boolean;
  sync_result?: string;
  sync_reason?: string;
};

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(MANIFEST_STORE)) {
        db.createObjectStore(MANIFEST_STORE);
      }
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        const qs = db.createObjectStore(QUEUE_STORE, { keyPath: "id" });
        qs.createIndex("synced", "synced");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveManifest(data: ManifestData): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MANIFEST_STORE, "readwrite");
    tx.objectStore(MANIFEST_STORE).put(data, "current");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadManifest(): Promise<ManifestData | null> {
  try {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(MANIFEST_STORE, "readonly");
      const req = tx.objectStore(MANIFEST_STORE).get("current");
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function enqueue(item: QueueItem): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readwrite");
    tx.objectStore(QUEUE_STORE).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function pendingItems(): Promise<QueueItem[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readonly");
    const req = tx.objectStore(QUEUE_STORE).getAll();
    req.onsuccess = () => resolve((req.result as QueueItem[]).filter((i) => !i.synced));
    req.onerror = () => reject(req.error);
  });
}

export async function allItems(): Promise<QueueItem[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readonly");
    const req = tx.objectStore(QUEUE_STORE).getAll();
    req.onsuccess = () => resolve(req.result as QueueItem[]);
    req.onerror = () => reject(req.error);
  });
}

export async function markSynced(id: string, result: string, reason?: string): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readwrite");
    const store = tx.objectStore(QUEUE_STORE);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const item = getReq.result as QueueItem | undefined;
      if (item) {
        item.synced = true;
        item.sync_result = result;
        item.sync_reason = reason;
        store.put(item);
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearSynced(): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, "readwrite");
    const store = tx.objectStore(QUEUE_STORE);
    const req = store.getAll();
    req.onsuccess = () => {
      for (const item of req.result as QueueItem[]) {
        if (item.synced && item.sync_result !== "rejected") {
          store.delete(item.id);
        }
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function queueDepth(): Promise<number> {
  return (await pendingItems()).length;
}
