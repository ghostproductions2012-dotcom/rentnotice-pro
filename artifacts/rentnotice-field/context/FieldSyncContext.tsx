import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  addFieldEvidence,
  listFieldAssignments,
  updateFieldAssignment,
  type AddFieldEvidenceRequest,
  type FieldAssignmentSync,
  type FieldEvidenceSync,
  type UpdateFieldAssignmentRequest,
} from "@workspace/api-client-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

const CACHE_KEY = "rnf.assignments.cache.v1";
const QUEUE_KEY = "rnf.mutation.queue.v1";

type QueueEntry =
  | {
      type: "update";
      assignmentId: string;
      payload: UpdateFieldAssignmentRequest;
      queuedAt: string;
    }
  | {
      type: "evidence";
      assignmentId: string;
      payload: AddFieldEvidenceRequest;
      queuedAt: string;
    };

interface FieldSyncValue {
  assignments: FieldAssignmentSync[];
  isOffline: boolean;
  isSyncing: boolean;
  isHydrated: boolean;
  pendingCount: number;
  syncNow: () => Promise<void>;
  refresh: () => Promise<void>;
  updateAssignment: (
    id: string,
    payload: Omit<UpdateFieldAssignmentRequest, "updatedAt">,
  ) => void;
  addEvidence: (id: string, evidence: AddFieldEvidenceRequest) => void;
  getAssignment: (id: string) => FieldAssignmentSync | undefined;
}

const FieldSyncContext = createContext<FieldSyncValue | null>(null);

function applyQueue(
  base: FieldAssignmentSync[],
  queue: QueueEntry[],
): FieldAssignmentSync[] {
  if (queue.length === 0) return base;
  const map = new Map(base.map((a) => [a.id, { ...a }]));

  for (const entry of queue) {
    const current = map.get(entry.assignmentId);
    if (!current) continue;

    if (entry.type === "update") {
      map.set(entry.assignmentId, {
        ...current,
        ...(entry.payload.status !== undefined
          ? { status: entry.payload.status }
          : {}),
        ...(entry.payload.serviceMethod !== undefined
          ? { serviceMethod: entry.payload.serviceMethod }
          : {}),
        ...(entry.payload.completedAt !== undefined
          ? { completedAt: entry.payload.completedAt }
          : {}),
        ...(entry.payload.serverNotes !== undefined
          ? { serverNotes: entry.payload.serverNotes }
          : {}),
        updatedAt: entry.payload.updatedAt,
      });
    } else {
      const exists = current.evidence.some((e) => e.id === entry.payload.id);
      if (exists) continue;
      const evidenceItem: FieldEvidenceSync = {
        id: entry.payload.id,
        photoDataUrl: entry.payload.photoDataUrl,
        latitude: entry.payload.latitude ?? null,
        longitude: entry.payload.longitude ?? null,
        accuracyMeters: entry.payload.accuracyMeters ?? null,
        capturedAt: entry.payload.capturedAt,
        note: entry.payload.note ?? "",
      };
      map.set(entry.assignmentId, {
        ...current,
        evidence: [...current.evidence, evidenceItem],
      });
    }
  }

  return Array.from(map.values());
}

export function FieldSyncProvider({ children }: { children: ReactNode }) {
  const [baseAssignments, setBaseAssignments] = useState<FieldAssignmentSync[]>(
    [],
  );
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [isOffline, setIsOffline] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);

  const queueRef = useRef<QueueEntry[]>([]);
  const flushingRef = useRef(false);

  const persistQueue = useCallback(async (next: QueueEntry[]) => {
    queueRef.current = next;
    setQueue(next);
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(next));
  }, []);

  const persistBase = useCallback(async (next: FieldAssignmentSync[]) => {
    setBaseAssignments(next);
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(next));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const data = await listFieldAssignments();
      await persistBase(data);
      setIsOffline(false);
    } catch {
      setIsOffline(true);
    }
  }, [persistBase]);

  const flush = useCallback(async () => {
    if (flushingRef.current) return;
    flushingRef.current = true;
    try {
      let remaining = [...queueRef.current];
      while (remaining.length > 0) {
        const entry = remaining[0];
        try {
          if (entry.type === "update") {
            await updateFieldAssignment(entry.assignmentId, entry.payload);
          } else {
            await addFieldEvidence(entry.assignmentId, entry.payload);
          }
          remaining = remaining.slice(1);
          await persistQueue(remaining);
          setIsOffline(false);
        } catch (err) {
          const status = (err as { status?: number } | undefined)?.status;
          if (status === 404) {
            // Assignment no longer exists — drop this entry and continue.
            remaining = remaining.slice(1);
            await persistQueue(remaining);
            continue;
          }
          if (status === undefined) {
            // Network failure — keep the queue and stop.
            setIsOffline(true);
          }
          return;
        }
      }
    } finally {
      flushingRef.current = false;
    }
  }, [persistQueue]);

  const syncNow = useCallback(async () => {
    setIsSyncing(true);
    try {
      await flush();
      await refresh();
    } finally {
      setIsSyncing(false);
    }
  }, [flush, refresh]);

  // Hydrate from AsyncStorage on startup, then attempt a sync.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cachedRaw, queueRaw] = await Promise.all([
          AsyncStorage.getItem(CACHE_KEY),
          AsyncStorage.getItem(QUEUE_KEY),
        ]);
        if (!cancelled && cachedRaw) {
          setBaseAssignments(JSON.parse(cachedRaw) as FieldAssignmentSync[]);
        }
        if (!cancelled && queueRaw) {
          const parsed = JSON.parse(queueRaw) as QueueEntry[];
          queueRef.current = parsed;
          setQueue(parsed);
        }
      } catch {
        // ignore corrupt cache
      } finally {
        if (!cancelled) setIsHydrated(true);
      }
      if (!cancelled) await syncNow();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateAssignment = useCallback(
    (id: string, payload: Omit<UpdateFieldAssignmentRequest, "updatedAt">) => {
      const entry: QueueEntry = {
        type: "update",
        assignmentId: id,
        payload: { ...payload, updatedAt: new Date().toISOString() },
        queuedAt: new Date().toISOString(),
      };
      const next = [...queueRef.current, entry];
      void persistQueue(next);
      void flush();
    },
    [persistQueue, flush],
  );

  const addEvidence = useCallback(
    (id: string, evidence: AddFieldEvidenceRequest) => {
      const entry: QueueEntry = {
        type: "evidence",
        assignmentId: id,
        payload: evidence,
        queuedAt: new Date().toISOString(),
      };
      const next = [...queueRef.current, entry];
      void persistQueue(next);
      void flush();
    },
    [persistQueue, flush],
  );

  const assignments = useMemo(
    () => applyQueue(baseAssignments, queue),
    [baseAssignments, queue],
  );

  const getAssignment = useCallback(
    (id: string) => assignments.find((a) => a.id === id),
    [assignments],
  );

  const value = useMemo<FieldSyncValue>(
    () => ({
      assignments,
      isOffline,
      isSyncing,
      isHydrated,
      pendingCount: queue.length,
      syncNow,
      refresh,
      updateAssignment,
      addEvidence,
      getAssignment,
    }),
    [
      assignments,
      isOffline,
      isSyncing,
      isHydrated,
      queue.length,
      syncNow,
      refresh,
      updateAssignment,
      addEvidence,
      getAssignment,
    ],
  );

  return (
    <FieldSyncContext.Provider value={value}>
      {children}
    </FieldSyncContext.Provider>
  );
}

export function useFieldSync() {
  const ctx = useContext(FieldSyncContext);
  if (!ctx) {
    throw new Error("useFieldSync must be used within a FieldSyncProvider");
  }
  return ctx;
}
