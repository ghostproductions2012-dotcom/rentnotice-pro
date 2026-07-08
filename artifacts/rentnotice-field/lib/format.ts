import type {
  FieldAssignmentSyncStatus,
  FieldAssignmentSyncServiceMethod,
} from "@workspace/api-client-react";

export const NOTICE_TYPE_LABELS: Record<string, string> = {
  pay_or_quit_3day: "3-Day Notice to Pay Rent or Quit",
  perform_covenant_3day: "3-Day Notice to Perform Covenant or Quit",
  entry_24hr: "24-Hour Notice of Intent to Enter",
  termination_30day: "30-Day Notice of Termination",
  termination_60day: "60-Day Notice of Termination",
  rent_increase: "Notice of Rent Increase",
};

export function noticeTypeLabel(noticeType: string): string {
  return NOTICE_TYPE_LABELS[noticeType] ?? noticeType;
}

export const STATUS_LABELS: Record<FieldAssignmentSyncStatus, string> = {
  assigned: "Assigned",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const SERVICE_METHOD_LABELS: Record<string, string> = {
  personal: "Personal service",
  substitute: "Substitute service",
  post_and_mail: "Post and mail",
  other: "Other",
};

export const SERVICE_METHODS: {
  value: NonNullable<FieldAssignmentSyncServiceMethod>;
  label: string;
}[] = [
  { value: "personal", label: "Personal service" },
  { value: "substitute", label: "Substitute service" },
  { value: "post_and_mail", label: "Post and mail" },
  { value: "other", label: "Other" },
];

export function formatMoney(cents: number | null | undefined): string | null {
  if (cents == null) return null;
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

export function formatDeadline(iso: string | null | undefined): string {
  if (!iso) return "No deadline";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "No deadline";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatCoords(
  latitude: number | null,
  longitude: number | null,
): string {
  if (latitude == null || longitude == null) return "No GPS fix";
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}

/** Client-generated id (React Native safe — no crypto.getRandomValues). */
export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
