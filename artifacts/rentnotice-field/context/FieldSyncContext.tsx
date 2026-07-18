import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  addFieldEvidence,
  addWorkOrderPhoto,
  listFieldAssignments,
  listWorkOrderAssignments,
  updateFieldAssignment,
  updateWorkOrderAssignment,
  type AddFieldEvidenceRequest,
  type AddWorkOrderPhotoRequest,
  type FieldAssignmentSync,
  type FieldEvidenceSync,
  type UpdateFieldAssignmentRequest,
  type UpdateWorkOrderRequest,
  type WorkOrderPhotoSync,
  type WorkOrderSync,
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
const WO_CACHE_KEY = "rnf.workorders.cache.v1";
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
    }
  | {
      type: "wo-update";
      workOrderId: string;
      payload: UpdateWorkOrderRequest;
      queuedAt: string;
    }
  | {
      type: "wo-photo";
      workOrderId: string;
      payload: AddWorkOrderPhotoRequest;
      queuedAt: string;
    };

interface FieldSyncValue {
  assignments: FieldAssignmentSync[];
  workOrders: WorkOrderSync[];
  isOffline: boolean;
  // The relay rejected our credentials (missing, mistyped, or revoked
  // device access code) — the user needs to update it in Sync Settings.
  isUnauthorized: boolean;
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
  updateWorkOrder: (
    id: string,
    payload: Omit<UpdateWorkOrderRequest, "updatedAt">,
  ) => void;
  addWorkOrderPhoto: (id: string, photo: AddWorkOrderPhotoRequest) => void;
  getWorkOrder: (id: string) => WorkOrderSync | undefined;
}

const FieldSyncContext = createContext<FieldSyncValue | null>(null);

function applyWorkOrderQueue(
  base: WorkOrderSync[],
  queue: QueueEntry[],
): WorkOrderSync[] {
  if (queue.length === 0) return base;
  const map = new Map(base.map((w) => [w.id, { ...w }]));

  for (const entry of queue) {
    if (entry.type !== "wo-update" && entry.type !== "wo-photo") continue;
    const current = map.get(entry.workOrderId);
    if (!current) continue;

    if (entry.type === "wo-update") {
      map.set(entry.workOrderId, {
        ...current,
        ...(entry.payload.status !== undefined
          ? { status: entry.payload.status }
          : {}),
        ...(entry.payload.completedAt !== undefined
          ? { completedAt: entry.payload.completedAt }
          : {}),
        ...(entry.payload.fieldNotes !== undefined
          ? { fieldNotes: entry.payload.fieldNotes }
          : {}),
        updatedAt: entry.payload.updatedAt,
      });
    } else {
      const exists = current.photos.some((p) => p.id === entry.payload.id);
      if (exists) continue;
      const photo: WorkOrderPhotoSync = {
        id: entry.payload.id,
        photoDataUrl: entry.payload.photoDataUrl,
        latitude: entry.payload.latitude ?? null,
        longitude: entry.payload.longitude ?? null,
        accuracyMeters: entry.payload.accuracyMeters ?? null,
        capturedAt: entry.payload.capturedAt,
        note: entry.payload.note ?? "",
      };
      map.set(entry.workOrderId, {
        ...current,
        photos: [...current.photos, photo],
      });
    }
  }

  return Array.from(map.values());
}

function applyQueue(
  base: FieldAssignmentSync[],
  queue: QueueEntry[],
): FieldAssignmentSync[] {
  if (queue.length === 0) return base;
  const map = new Map(base.map((a) => [a.id, { ...a }]));

  for (const entry of queue) {
    if (entry.type !== "update" && entry.type !== "evidence") continue;
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
  const [baseWorkOrders, setBaseWorkOrders] = useState<WorkOrderSync[]>([]);
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [isOffline, setIsOffline] = useState(false);
  const [isUnauthorized, setIsUnauthorized] = useState(false);
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

  const persistWorkOrders = useCallback(async (next: WorkOrderSync[]) => {
    setBaseWorkOrders(next);
    await AsyncStorage.setItem(WO_CACHE_KEY, JSON.stringify(next));
  }, []);

  const refresh = useCallback(async () => {
    const [assignmentsResult, workOrdersResult] = await Promise.allSettled([
      listFieldAssignments(),
      listWorkOrderAssignments(),
    ]);
    if (assignmentsResult.status === "fulfilled") {
      await persistBase(assignmentsResult.value);
    }
    if (workOrdersResult.status === "fulfilled") {
      await persistWorkOrders(workOrdersResult.value);
    }
    const statusOf = (r: PromiseSettledResult<unknown>) =>
      r.status === "rejected"
        ? (r.reason as { status?: number } | undefined)?.status
        : undefined;
    const unauthorized =
      statusOf(assignmentsResult) === 401 || statusOf(workOrdersResult) === 401;
    setIsUnauthorized(unauthorized);
    setIsOffline(
      !unauthorized &&
        assignmentsResult.status === "rejected" &&
        workOrdersResult.status === "rejected",
    );
  }, [persistBase, persistWorkOrders]);

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
          } else if (entry.type === "evidence") {
            await addFieldEvidence(entry.assignmentId, entry.payload);
          } else if (entry.type === "wo-update") {
            await updateWorkOrderAssignment(entry.workOrderId, entry.payload);
          } else {
            await addWorkOrderPhoto(entry.workOrderId, entry.payload);
          }
          remaining = remaining.slice(1);
          await persistQueue(remaining);
          setIsOffline(false);
          setIsUnauthorized(false);
        } catch (err) {
          const status = (err as { status?: number } | undefined)?.status;
          if (status === 404) {
            // Assignment no longer exists — drop this entry and continue.
            remaining = remaining.slice(1);
            await persistQueue(remaining);
            continue;
          }
          if (status === 401) {
            // Missing/revoked access code — keep the queue so nothing is
            // lost; the user must fix the code in Sync Settings.
            setIsUnauthorized(true);
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
        const [cachedRaw, woCachedRaw, queueRaw] = await Promise.all([
          AsyncStorage.getItem(CACHE_KEY),
          AsyncStorage.getItem(WO_CACHE_KEY),
          AsyncStorage.getItem(QUEUE_KEY),
        ]);
        if (!cancelled && cachedRaw) {
          setBaseAssignments(JSON.parse(cachedRaw) as FieldAssignmentSync[]);
        }
        if (!cancelled && woCachedRaw) {
          setBaseWorkOrders(JSON.parse(woCachedRaw) as WorkOrderSync[]);
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

  const updateWorkOrder = useCallback(
    (id: string, payload: Omit<UpdateWorkOrderRequest, "updatedAt">) => {
      const entry: QueueEntry = {
        type: "wo-update",
        workOrderId: id,
        payload: { ...payload, updatedAt: new Date().toISOString() },
        queuedAt: new Date().toISOString(),
      };
      const next = [...queueRef.current, entry];
      void persistQueue(next);
      void flush();
    },
    [persistQueue, flush],
  );

  const addPhoto = useCallback(
    (id: string, photo: AddWorkOrderPhotoRequest) => {
      const entry: QueueEntry = {
        type: "wo-photo",
        workOrderId: id,
        payload: photo,
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

  const workOrders = useMemo(
    () => applyWorkOrderQueue(baseWorkOrders, queue),
    [baseWorkOrders, queue],
  );

  const getAssignment = useCallback(
    (id: string) => assignments.find((a) => a.id === id),
    [assignments],
  );

  const getWorkOrder = useCallback(
    (id: string) => workOrders.find((w) => w.id === id),
    [workOrders],
  );

  const value = useMemo<FieldSyncValue>(
    () => ({
      assignments,
      workOrders,
      isOffline,
      isUnauthorized,
      isSyncing,
      isHydrated,
      pendingCount: queue.length,
      syncNow,
      refresh,
      updateAssignment,
      addEvidence,
      getAssignment,
      updateWorkOrder,
      addWorkOrderPhoto: addPhoto,
      getWorkOrder,
    }),
    [
      assignments,
      workOrders,
      isOffline,
      isUnauthorized,
      isSyncing,
      isHydrated,
      queue.length,
      syncNow,
      refresh,
      updateAssignment,
      addEvidence,
      getAssignment,
      updateWorkOrder,
      addPhoto,
      getWorkOrder,
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
