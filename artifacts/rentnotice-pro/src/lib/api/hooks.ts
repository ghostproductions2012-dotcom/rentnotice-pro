// ---------------------------------------------------------------------------
// React Query hooks — the ONLY way UI code should access data.
// Mutations already invalidate all affected caches; pages never need to
// call queryClient.invalidateQueries themselves.
// ---------------------------------------------------------------------------

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import "./impl"; // registers the AppServices implementation
import { getServices } from "./services";
import { type Permission, can } from "./permissions";
import type {
  ActivateWorkspaceInput,
  AddAttachmentInput,
  ClassificationOverrideInput,
  CreateFieldAssignmentInput,
  CreateMailTrackingInput,
  CreatePropertyInput,
  CreateTemplateInput,
  CreateTenantInput,
  CreateUserInput,
  DeadlineContext,
  FinalizeAttestation,
} from "./services";
import type {
  AppSettings,
  Attachment,
  AuditFilters,
  CompanyProfile,
  FieldAssignment,
  FieldEvidence,
  GenerateDocumentsInput,
  Holiday,
  Id,
  ImportLedgerInput,
  MailTracking,
  MappingPreset,
  NoticeFilters,
  NoticeInput,
  NoticeStatus,
  NoticeType,
  Property,
  ReportKind,
  ServiceRecord,
  TemplateUpdateInput,
  Tenant,
  User,
} from "../types";

// --------------------------------- keys -----------------------------------

export const qk = {
  session: ["session"] as const,
  workspace: ["workspace"] as const,
  users: ["users"] as const,
  company: ["company"] as const,
  settings: ["settings"] as const,
  properties: (search?: string) => ["properties", search ?? ""] as const,
  property: (id: Id) => ["property", id] as const,
  tenants: (search?: string, propertyId?: Id) =>
    ["tenants", search ?? "", propertyId ?? ""] as const,
  tenant: (id: Id) => ["tenant", id] as const,
  ledgers: (tenantId?: Id) => ["ledgers", tenantId ?? ""] as const,
  ledger: (id: Id) => ["ledger", id] as const,
  mappingPresets: ["mappingPresets"] as const,
  calculation: (ledgerId: Id) => ["calculation", ledgerId] as const,
  notices: (filters?: NoticeFilters) => ["notices", filters ?? {}] as const,
  notice: (id: Id) => ["notice", id] as const,
  validation: (id: Id) => ["validation", id] as const,
  documents: (noticeId: Id) => ["documents", noticeId] as const,
  templates: (f?: { noticeType?: NoticeType; jurisdiction?: string }) =>
    ["templates", f ?? {}] as const,
  template: (id: Id) => ["template", id] as const,
  holidays: (year?: number) => ["holidays", year ?? 0] as const,
  deadline: (
    serviceDate: string,
    noticeType: NoticeType,
    jurisdiction: string,
    context?: DeadlineContext,
  ) => ["deadline", serviceDate, noticeType, jurisdiction, context ?? {}] as const,
  audit: (filters?: AuditFilters) => ["audit", filters ?? {}] as const,
  attachments: (entityType: Attachment["entityType"], entityId: Id) =>
    ["attachments", entityType, entityId] as const,
  fieldAssignments: (noticeId?: Id) => ["fieldAssignments", noticeId ?? ""] as const,
  mailTracking: (noticeId?: Id) => ["mailTracking", noticeId ?? ""] as const,
  dashboard: ["dashboard"] as const,
  report: (kind: ReportKind) => ["report", kind] as const,
  stateRules: ["stateRules"] as const,
};

function invalidate(qc: QueryClient, roots: string[]) {
  for (const root of roots) {
    qc.invalidateQueries({ queryKey: [root] });
  }
}

// A mutation that touches notices affects most derived views.
const NOTICE_ROOTS = [
  "notices",
  "notice",
  "validation",
  "documents",
  "dashboard",
  "audit",
  "report",
  "fieldAssignments",
  "mailTracking",
];

// ------------------------------ session/users ------------------------------

export function useSession() {
  return useQuery({ queryKey: qk.session, queryFn: () => getServices().getSession() });
}

/**
 * Frontend view of the RBAC rules enforced in the service layer. Use `can(...)`
 * to hide or disable privileged controls. The backend remains the source of
 * truth — every gated action is also enforced in impl.ts.
 */
export function usePermissions() {
  const { data: session } = useSession();
  const role = session?.user?.role ?? null;
  const locked = session?.locked ?? false;
  return {
    role,
    isReadOnly: role === "readonly",
    can: (permission: Permission) => !locked && can(role, permission),
  };
}

export function useUsers() {
  return useQuery({ queryKey: qk.users, queryFn: () => getServices().listUsers() });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ identifier, secret }: { identifier: string; secret: string }) =>
      getServices().login(identifier, secret),
    onSuccess: () => invalidate(qc, ["session", "audit", "dashboard"]),
  });
}

// --- workspace activation ---

export function useWorkspaceState() {
  return useQuery({
    queryKey: qk.workspace,
    queryFn: () => getServices().getWorkspaceState(),
  });
}

export function useEnterDemoMode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => getServices().enterDemoMode(),
    // Seeding touches every table — refresh everything.
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function useValidateLicenseKey() {
  return useMutation({
    mutationFn: (licenseKey: string) => getServices().validateLicenseKey(licenseKey),
  });
}

export function useActivateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ActivateWorkspaceInput) => getServices().activateWorkspace(input),
    // Activation may wipe and re-provision the entire database.
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function useSyncLicense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => getServices().syncLicense(),
    onSuccess: () => invalidate(qc, ["workspace", "users", "session", "audit", "dashboard"]),
  });
}

export function useLockApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => getServices().lockApp(),
    onSuccess: () => invalidate(qc, ["session"]),
  });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateUserInput) => getServices().createUser(input),
    onSuccess: () => invalidate(qc, ["users", "audit"]),
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: Id; patch: Partial<Omit<User, "id" | "createdAt">> }) =>
      getServices().updateUser(id, patch),
    onSuccess: () => invalidate(qc, ["users", "session", "audit"]),
  });
}

// ------------------------------ company/settings ---------------------------

export function useCompanyProfile() {
  return useQuery({ queryKey: qk.company, queryFn: () => getServices().getCompanyProfile() });
}

export function useUpdateCompanyProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Omit<CompanyProfile, "id">>) =>
      getServices().updateCompanyProfile(patch),
    onSuccess: () => invalidate(qc, ["company", "audit"]),
  });
}

export function useSettings() {
  return useQuery({ queryKey: qk.settings, queryFn: () => getServices().getSettings() });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Omit<AppSettings, "id">>) => getServices().updateSettings(patch),
    onSuccess: () => invalidate(qc, ["settings", "session", "audit", "dashboard"]),
  });
}

// ------------------------------ properties ---------------------------------

export function useProperties(search?: string) {
  return useQuery({
    queryKey: qk.properties(search),
    queryFn: () => getServices().listProperties(search),
  });
}

export function useProperty(id: Id | null | undefined) {
  return useQuery({
    queryKey: qk.property(id ?? "none"),
    queryFn: () => getServices().getProperty(id as Id),
    enabled: !!id,
  });
}

export function useCreateProperty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePropertyInput) => getServices().createProperty(input),
    onSuccess: () => invalidate(qc, ["properties", "property", "dashboard", "audit"]),
  });
}

export function useUpdateProperty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: Id;
      patch: Partial<Omit<Property, "id" | "createdAt">>;
    }) => getServices().updateProperty(id, patch),
    onSuccess: () => invalidate(qc, ["properties", "property", "tenants", "tenant", "audit"]),
  });
}

export function useDeleteProperty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: Id) => getServices().deleteProperty(id),
    onSuccess: () =>
      invalidate(qc, ["properties", "property", "tenants", "tenant", "dashboard", "audit"]),
  });
}

// ------------------------------ tenants ------------------------------------

export function useTenants(search?: string, propertyId?: Id) {
  return useQuery({
    queryKey: qk.tenants(search, propertyId),
    queryFn: () => getServices().listTenants(search, propertyId),
  });
}

export function useTenant(id: Id | null | undefined) {
  return useQuery({
    queryKey: qk.tenant(id ?? "none"),
    queryFn: () => getServices().getTenant(id as Id),
    enabled: !!id,
  });
}

export function useCreateTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTenantInput) => getServices().createTenant(input),
    onSuccess: () => invalidate(qc, ["tenants", "tenant", "dashboard", "audit"]),
  });
}

export function useUpdateTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: Id; patch: Partial<Omit<Tenant, "id" | "createdAt">> }) =>
      getServices().updateTenant(id, patch),
    onSuccess: () => invalidate(qc, ["tenants", "tenant", "audit"]),
  });
}

export function useDeleteTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: Id) => getServices().deleteTenant(id),
    onSuccess: () => invalidate(qc, ["tenants", "tenant", "ledgers", "dashboard", "audit"]),
  });
}

// ------------------------------ ledgers & import ----------------------------

export function useLedgers(tenantId?: Id) {
  return useQuery({
    queryKey: qk.ledgers(tenantId),
    queryFn: () => getServices().listLedgers(tenantId),
  });
}

export function useLedger(id: Id | null | undefined) {
  return useQuery({
    queryKey: qk.ledger(id ?? "none"),
    queryFn: () => getServices().getLedger(id as Id),
    enabled: !!id,
  });
}

/** Parse an uploaded file (CSV/Excel/PDF). Returns headers, rows, and a suggested mapping. */
export function useParseLedgerFile() {
  return useMutation({
    mutationFn: (file: File) => getServices().parseLedgerFile(file),
  });
}

export function useImportLedger() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ImportLedgerInput) => getServices().importLedger(input),
    onSuccess: () =>
      invalidate(qc, [
        "ledgers",
        "ledger",
        "calculation",
        "tenants",
        "tenant",
        "dashboard",
        "audit",
        "mappingPresets",
      ]),
  });
}

export function useDeleteLedger() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: Id) => getServices().deleteLedger(id),
    onSuccess: () => invalidate(qc, ["ledgers", "ledger", "calculation", "dashboard", "audit"]),
  });
}

export function useOverrideClassification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ClassificationOverrideInput) =>
      getServices().overrideClassification(input),
    onSuccess: () => invalidate(qc, ["ledger", "calculation", "audit"]),
  });
}

export function useMappingPresets() {
  return useQuery({
    queryKey: qk.mappingPresets,
    queryFn: () => getServices().listMappingPresets(),
  });
}

export function useSaveMappingPreset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (preset: Omit<MappingPreset, "id" | "createdAt">) =>
      getServices().saveMappingPreset(preset),
    onSuccess: () => invalidate(qc, ["mappingPresets"]),
  });
}

export function useDeleteMappingPreset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: Id) => getServices().deleteMappingPreset(id),
    onSuccess: () => invalidate(qc, ["mappingPresets"]),
  });
}

// ------------------------------ calculation ---------------------------------

export function useCalculation(ledgerId: Id | null | undefined) {
  return useQuery({
    queryKey: qk.calculation(ledgerId ?? "none"),
    queryFn: () => getServices().calculateLedger(ledgerId as Id),
    enabled: !!ledgerId,
  });
}

// ------------------------------ notices -------------------------------------

export function useNotices(filters?: NoticeFilters) {
  return useQuery({
    queryKey: qk.notices(filters),
    queryFn: () => getServices().listNotices(filters),
  });
}

export function useNotice(id: Id | null | undefined) {
  return useQuery({
    queryKey: qk.notice(id ?? "none"),
    queryFn: () => getServices().getNotice(id as Id),
    enabled: !!id,
  });
}

export function useCheckDuplicateNotice() {
  return useMutation({
    mutationFn: (params: {
      tenantId: Id;
      propertyId: Id;
      unit: string;
      months: string[];
      noticeType: NoticeType;
    }) => getServices().checkDuplicateNotice(params),
  });
}

export function useCreateNotice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NoticeInput) => getServices().createNotice(input),
    onSuccess: () => invalidate(qc, NOTICE_ROOTS),
  });
}

export function useUpdateNotice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: Id;
      patch: Partial<NoticeInput> & { internalNotes?: string };
    }) => getServices().updateNotice(id, patch),
    onSuccess: () => invalidate(qc, NOTICE_ROOTS),
  });
}

export function useDeleteNotice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: Id; reason: string }) =>
      getServices().deleteNotice(id, reason),
    onSuccess: () => invalidate(qc, NOTICE_ROOTS),
  });
}

export function useValidation(noticeId: Id | null | undefined) {
  return useQuery({
    queryKey: qk.validation(noticeId ?? "none"),
    queryFn: () => getServices().validateNotice(noticeId as Id),
    enabled: !!noticeId,
  });
}

export function useChangeNoticeStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, toStatus, reason }: { id: Id; toStatus: NoticeStatus; reason?: string }) =>
      getServices().changeNoticeStatus(id, toStatus, reason),
    onSuccess: () => invalidate(qc, NOTICE_ROOTS),
  });
}

export function useApproveNotice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: Id) => getServices().approveNotice(id),
    onSuccess: () => invalidate(qc, NOTICE_ROOTS),
  });
}

export function useFinalizeNotice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      acknowledgedWarnings,
      attestation,
    }: {
      id: Id;
      acknowledgedWarnings: { code: string; reason: string }[];
      attestation: FinalizeAttestation;
    }) => getServices().finalizeNotice(id, acknowledgedWarnings, attestation),
    onSuccess: () => invalidate(qc, NOTICE_ROOTS),
  });
}

export function useReviseNotice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: Id; reason: string }) =>
      getServices().reviseNotice(id, reason),
    onSuccess: () => invalidate(qc, NOTICE_ROOTS),
  });
}

export function useRecordService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, service }: { id: Id; service: ServiceRecord }) =>
      getServices().recordService(id, service),
    onSuccess: () => invalidate(qc, NOTICE_ROOTS),
  });
}

// ------------------------------ documents -----------------------------------

export function useGenerateDocuments() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: GenerateDocumentsInput) => getServices().generateDocuments(input),
    onSuccess: () => invalidate(qc, ["documents", "notices", "notice", "audit", "dashboard"]),
  });
}

export function useNoticeDocuments(noticeId: Id | null | undefined) {
  return useQuery({
    queryKey: qk.documents(noticeId ?? "none"),
    queryFn: () => getServices().listDocuments(noticeId as Id),
    enabled: !!noticeId,
  });
}

// ------------------------------ templates -----------------------------------

export function useTemplates(filters?: { noticeType?: NoticeType; jurisdiction?: string }) {
  return useQuery({
    queryKey: qk.templates(filters),
    queryFn: () => getServices().listTemplates(filters),
  });
}

export function useTemplate(id: Id | null | undefined) {
  return useQuery({
    queryKey: qk.template(id ?? "none"),
    queryFn: () => getServices().getTemplate(id as Id),
    enabled: !!id,
  });
}

export function useCreateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTemplateInput) => getServices().createTemplate(input),
    onSuccess: () => invalidate(qc, ["templates", "template", "audit"]),
  });
}

export function useUpdateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: Id; patch: TemplateUpdateInput }) =>
      getServices().updateTemplate(id, patch),
    onSuccess: () => invalidate(qc, ["templates", "template", "validation", "audit"]),
  });
}

// ------------------------------ holidays & deadlines ------------------------

export function useHolidays(year?: number) {
  return useQuery({
    queryKey: qk.holidays(year),
    queryFn: () => getServices().listHolidays(year),
  });
}

export function useAddHoliday() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<Holiday, "id" | "builtIn">) => getServices().addHoliday(input),
    onSuccess: () => invalidate(qc, ["holidays", "deadline", "audit"]),
  });
}

export function useDeleteHoliday() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: Id) => getServices().deleteHoliday(id),
    onSuccess: () => invalidate(qc, ["holidays", "deadline", "audit"]),
  });
}

export function useDeadline(
  serviceDate: string | null | undefined,
  noticeType: NoticeType,
  jurisdiction: string,
  context?: DeadlineContext,
) {
  return useQuery({
    queryKey: qk.deadline(serviceDate ?? "none", noticeType, jurisdiction, context),
    queryFn: () =>
      getServices().computeDeadline(serviceDate as string, noticeType, jurisdiction, context),
    enabled: !!serviceDate,
  });
}

// ------------------------------ audit ---------------------------------------

export function useAuditLog(filters?: AuditFilters) {
  return useQuery({
    queryKey: qk.audit(filters),
    queryFn: () => getServices().listAudit(filters),
  });
}

// ------------------------------ attachments ---------------------------------

export function useAttachments(
  entityType: Attachment["entityType"],
  entityId: Id | null | undefined,
) {
  return useQuery({
    queryKey: qk.attachments(entityType, entityId ?? "none"),
    queryFn: () => getServices().listAttachments(entityType, entityId as Id),
    enabled: !!entityId,
  });
}

export function useAddAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AddAttachmentInput) => getServices().addAttachment(input),
    onSuccess: () => invalidate(qc, ["attachments", "audit", "notice", "notices"]),
  });
}

export function useDeleteAttachment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: Id) => getServices().deleteAttachment(id),
    onSuccess: () => invalidate(qc, ["attachments", "audit"]),
  });
}

// ------------------------------ field assignments ---------------------------

export function useFieldAssignments(noticeId?: Id) {
  return useQuery({
    queryKey: qk.fieldAssignments(noticeId),
    queryFn: () => getServices().listFieldAssignments(noticeId),
  });
}

export function useCreateFieldAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateFieldAssignmentInput) =>
      getServices().createFieldAssignment(input),
    onSuccess: () => invalidate(qc, ["fieldAssignments", "audit", "notice", "notices"]),
  });
}

export function useUpdateFieldAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: Id;
      patch: Partial<Omit<FieldAssignment, "id" | "noticeId" | "createdAt">>;
    }) => getServices().updateFieldAssignment(id, patch),
    onSuccess: () => invalidate(qc, ["fieldAssignments", "audit", "notice", "notices"]),
  });
}

export function useAddFieldEvidence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      assignmentId,
      evidence,
    }: {
      assignmentId: Id;
      evidence: Omit<FieldEvidence, "id">;
    }) => getServices().addFieldEvidence(assignmentId, evidence),
    onSuccess: () => invalidate(qc, ["fieldAssignments", "audit"]),
  });
}

// ------------------------------ mail tracking -------------------------------

export function useMailTracking(noticeId?: Id) {
  return useQuery({
    queryKey: qk.mailTracking(noticeId),
    queryFn: () => getServices().listMailTracking(noticeId),
  });
}

export function useCreateMailTracking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateMailTrackingInput) => getServices().createMailTracking(input),
    onSuccess: () => invalidate(qc, ["mailTracking", "audit", "notice", "notices"]),
  });
}

export function useUpdateMailTracking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: Id;
      patch: Partial<Omit<MailTracking, "id" | "noticeId" | "createdAt">>;
    }) => getServices().updateMailTracking(id, patch),
    onSuccess: () => invalidate(qc, ["mailTracking", "audit", "notice", "notices"]),
  });
}

// ------------------------------ dashboard & reports -------------------------

export function useDashboard() {
  return useQuery({ queryKey: qk.dashboard, queryFn: () => getServices().getDashboard() });
}

export function useReport(kind: ReportKind) {
  return useQuery({ queryKey: qk.report(kind), queryFn: () => getServices().getReport(kind) });
}

export function useExportNoticesCsv() {
  return useMutation({
    mutationFn: (filters?: NoticeFilters) => getServices().exportNoticesCsv(filters),
  });
}

// ------------------------------ state rules ---------------------------------

export function useStateRules() {
  return useQuery({ queryKey: qk.stateRules, queryFn: () => getServices().listStateRules() });
}

// ------------------------------ backup --------------------------------------

export function useExportBackup() {
  return useMutation({ mutationFn: () => getServices().exportBackup() });
}

export function useImportBackup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => getServices().importBackup(file),
    onSuccess: () => qc.invalidateQueries(),
  });
}
