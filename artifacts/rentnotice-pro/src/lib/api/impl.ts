// ---------------------------------------------------------------------------
// AppServices implementation — composition layer over the real local stack:
//   db/        sql.js persistence (IndexedDB-backed) + repositories
//   import/    CSV / Excel / PDF / OCR ledger parsing + vendor presets
//   engine/    classification, rent-only calculation, validation, deadlines
//   documents/ PDF generation (notices, proofs, packets)
//
// The database opens lazily on first service call; nothing here runs at
// module top level except factory registration.
// ---------------------------------------------------------------------------

import type {
  Attachment,
  AuditAction,
  AuditEntry,
  BackupMeta,
  CalculationResult,
  CompanyProfile,
  DashboardData,
  DeadlineResult,
  DuplicateCheckResult,
  ExternalPropertyUpsert,
  ExternalTenantUpsert,
  FieldAssignment,
  FieldEvidence,
  GenerateDocumentsInput,
  Holiday,
  Id,
  ImportLedgerInput,
  Ledger,
  LedgerTransaction,
  LicenseBlockReason,
  MailTracking,
  MailTrackingEvent,
  Notice,
  NoticeDocument,
  NoticeFilters,
  NoticeInput,
  NoticeStatus,
  NoticeTemplate,
  NoticeType,
  PaymentProfile,
  Property,
  ReportKind,
  ReportResult,
  SampleDataOptions,
  SampleDataState,
  ServiceRecord,
  SessionInfo,
  Tenant,
  User,
  ValidationResult,
  WorkOrder,
  WorkOrderStatus,
  WorkspaceState,
} from "../types";
import { LICENSE_BLOCK_MESSAGES, NOTICE_STATUS_LABELS, NOTICE_TYPE_LABELS } from "../types";
import type {
  AppServices,
  ClassificationOverrideInput,
  LedgerDetail,
} from "./services";
import { registerServicesFactory } from "./services";
import {
  issueChatToken,
  logTenantCommunication,
  replaceChatDirectory,
} from "@workspace/api-client-react";
import { type Permission, checkPermission } from "./permissions";
import {
  type AppDatabase,
  attachmentsRepo,
  activationRepo,
  attorneyReferralLinksRepo,
  auditRepo,
  base64ToBytes,
  calculationsRepo,
  clearPersistedDatabase,
  companyRepo,
  dataUrlToBytes,
  documentsRepo,
  exportBackup as exportDbBackup,
  fieldAssignmentsRepo,
  getWorkspaceMode,
  holidaysRepo,
  importBackup as importDbBackup,
  initDatabase,
  ledgersRepo,
  attorneyContactsRepo,
  mailTrackingRepo,
  mappingPresetsRepo,
  noticesRepo,
  nowIso,
  propertiesRepo,
  seedDatabase,
  seedReferenceData,
  setWorkspaceMode,
  settingsRepo,
  stateRuleReviewsRepo,
  sha256Hex,
  statusHistoryRepo,
  templatesRepo,
  tenantsRepo,
  todayIso,
  uid,
  usersRepo,
  validationResultsRepo,
  workOrdersRepo,
} from "../db";
import {
  countRealProperties,
  isSampleDataLoaded,
  loadSamplePortfolio,
  removeSamplePortfolio,
} from "../db/samplePortfolio";
import {
  getLicensingClient,
  LicenseInvalidError,
  LicensingUnavailableError,
} from "../licensing";
import type { DirectoryUser, LicenseSummary } from "../licensing/types";
import { evaluateLicenseGate, type LicenseGate } from "../licensing/gate";
import {
  isPriorBalanceDescription,
  looksLikeExcelSerialDate,
  parseDateToIso,
  parseExcelSerialStringToIso,
  parseFile,
  parseMoneyToCents,
  shouldInterpretExcelSerialDates,
  toParsedLedgerFile,
} from "../import";
import {
  STATE_RULES,
  addDays,
  calculateRentOnly,
  classifyRow,
  computeDeadline as computeDeadlineEngine,
  confidenceToUnit,
  getRulePack,
  unacknowledgedWarnings,
  validateNotice as validateNoticeEngine,
} from "../engine";
import {
  assemblePacket,
  bytesToBlob,
  generateDocument,
  packetContents,
  type DocumentContext,
  type GeneratedDocument,
  type KindedDocument,
} from "../documents";
import { extractMergeFields } from "../documents/merge";
import { downscalePhotoDataUrl } from "../images";

// ------------------------------- lazy database ------------------------------

let dbPromise: Promise<AppDatabase> | null = null;

function getDb(): Promise<AppDatabase> {
  // A failed open/migration deliberately STICKS: every caller sees the same
  // rejection so the UI can show the startup error screen instead of each
  // query silently re-running (and re-failing) the whole init. Recovery is
  // explicit via retryDatabaseInit() (the error screen's Retry button).
  if (!dbPromise) {
    dbPromise = initDatabase();
  }
  return dbPromise;
}

// ------------------------------- session ------------------------------------

const session: SessionInfo = { user: null, locked: false };

// --------------------------- license gate -----------------------------------

// Computed from the local activation record; refreshed on boot (via
// getWorkspaceState), after every sync, and after activation. When blocked,
// the workspace becomes view-only: reads succeed, writes throw.
let licenseGate: LicenseGate = { blocked: false, reason: null };

function refreshLicenseGate(db: AppDatabase): LicenseGate {
  licenseGate = evaluateLicenseGate(getWorkspaceMode(db), activationRepo.get(db));
  return licenseGate;
}

function workspaceState(db: AppDatabase): WorkspaceState {
  const gate = refreshLicenseGate(db);
  return {
    mode: getWorkspaceMode(db),
    activation: activationRepo.get(db),
    licenseBlocked: gate.blocked,
    licenseBlockReason: gate.reason,
  };
}

// Authoritative RBAC gate. Every state-changing service method calls this
// before touching the database; the UI mirrors the same rules (see
// usePermissions) but the enforcement here is the source of truth.
function requirePermission(permission: Permission): void {
  if (licenseGate.blocked && licenseGate.reason) {
    throw new Error(LICENSE_BLOCK_MESSAGES[licenseGate.reason]);
  }
  checkPermission({ role: session.user?.role, locked: session.locked }, permission);
}

// Sample data may only be loaded into an empty-ish workspace: a handful of
// hand-created properties is fine, a real portfolio is not.
const SAMPLE_MAX_REAL_PROPERTIES = 5;

// Sample data management is deliberately admin-only (beyond settings.manage,
// which managers also hold): it inserts/deletes thousands of records.
function requireSampleDataAdmin(): void {
  requirePermission("settings.manage");
  if (session.user?.role !== "admin") {
    throw new Error("Only administrators can load or remove sample data.");
  }
}

// Object URLs are session-scoped; rebuild them from stored bytes on demand.
const blobUrlCache = new Map<Id, string>();

// ------------------------------- helpers ------------------------------------

function logAudit(
  db: AppDatabase,
  action: AuditAction,
  entityType: string,
  entityId: Id | null,
  summary: string,
  opts: { previousValue?: string | null; newValue?: string | null; reason?: string | null } = {},
): void {
  auditRepo.create(db, {
    id: uid("audit"),
    timestamp: nowIso(),
    userId: session.user?.id ?? null,
    userName: session.user?.name ?? "System",
    action,
    entityType,
    entityId,
    summary,
    previousValue: opts.previousValue ?? null,
    newValue: opts.newValue ?? null,
    reason: opts.reason ?? null,
  });
}

function requireCompany(db: AppDatabase): CompanyProfile {
  const company = companyRepo.get(db);
  if (!company) throw new Error("Company profile is not configured yet.");
  return company;
}

function customHolidays(db: AppDatabase): Holiday[] {
  return holidaysRepo.list(db).filter((h) => !h.builtIn);
}

function emptyService(): ServiceRecord {
  return {
    dateServed: null,
    timeServed: null,
    method: null,
    servedBy: "",
    serverNotes: "",
    mailedDate: null,
  };
}

function defaultPayment(company: CompanyProfile | null): PaymentProfile {
  return {
    payToName: company?.name ?? "",
    payToPerson: "",
    paymentAddress: company?.address ?? "",
    phone: company?.phone ?? "",
    acceptedMethods: ["personal_check", "cashiers_check", "money_order"],
    inPersonAllowed: true,
    officeHours: "Mon\u2013Fri 9:00 AM \u2013 5:00 PM",
    paymentDays: "Monday through Friday",
    electronicInstructions: "",
  };
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .slice(0, 2)
    .join("");
}

/**
 * A raw (not-yet-hashed) sign-in secret: a password of at least 8 characters.
 * Stored values are SHA-256 hex digests, which we never re-hash. Accounts
 * created before the password-only policy may still carry hashes of short
 * numeric secrets — those keep signing in unchanged (login hashes whatever is
 * typed and compares), but newly set or changed credentials must be proper
 * passwords.
 */
function isStoredSecretHash(value: string): boolean {
  return /^[0-9a-f]{64}$/i.test(value);
}

function looksLikeRawSecret(secret: string | null | undefined): secret is string {
  if (typeof secret !== "string") return false;
  if (isStoredSecretHash(secret)) return false; // already a stored hash
  return secret.length >= 8;
}

const INVALID_SECRET_MESSAGE = "Password must be at least 8 characters";

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function normalizeEmail(email: string | null | undefined): string | null {
  const e = (email ?? "").trim().toLowerCase();
  return e.length > 0 ? e : null;
}

function singleLineAddress(property: Property): string {
  return [
    property.addressLine1,
    property.addressLine2,
    `${property.city}, ${property.state} ${property.zip}`,
  ]
    .filter(Boolean)
    .join(", ");
}

// Best-effort mirror of served-notice and work-order events into the cloud
// tenant communication history (Communications hub). Local operations must
// never fail or block because the cloud is unreachable, so this is strictly
// fire-and-forget: any error is swallowed and the local audit log remains
// the authoritative record.
function logTenantHistoryCloud(
  db: AppDatabase,
  entry: {
    tenantId: Id;
    kind: "notice_served" | "work_order";
    subject: string;
    bodyText?: string;
    /** Skip the server-side webhook dispatch (event already sent elsewhere). */
    suppressEvent?: boolean;
  },
): void {
  try {
    if (getWorkspaceMode(db) !== "activated") return;
    const licenseKey = activationRepo.get(db)?.licenseKey;
    if (!licenseKey) return;
    const tenant = tenantsRepo.get(db, entry.tenantId);
    const property = tenant?.propertyId ? propertiesRepo.get(db, tenant.propertyId) : null;
    void logTenantCommunication(
      {
        tenantId: entry.tenantId,
        kind: entry.kind,
        tenantName: tenant?.names.join(", ") ?? "",
        tenantEmail: tenant?.email ?? "",
        propertyAddress: property ? singleLineAddress(property) : "",
        subject: entry.subject,
        bodyText: entry.bodyText ?? "",
        createdByKey: session.user ? (session.user.cloudUserId ?? session.user.id) : "",
        createdByName: session.user?.name ?? "",
        ...(entry.suppressEvent ? { suppressEvent: true } : {}),
      },
      { headers: { "x-license-key": licenseKey } },
    ).catch(() => {
      // Cloud history is best-effort; ignore network/auth failures.
    });
  } catch {
    // Never let history mirroring break the local operation.
  }
}

// Best-effort replication of the local user directory to the communications
// hub so the server can validate chat identities. Cloud-account members are
// already known server-side; this pushes the local-only members (those
// created directly in the desktop app, cloudUserId = null). Fire-and-forget:
// chat directory replication must never block or fail local user management.
function pushChatDirectoryCloud(db: AppDatabase): void {
  try {
    if (getWorkspaceMode(db) !== "activated") return;
    const licenseKey = activationRepo.get(db)?.licenseKey;
    if (!licenseKey) return;
    const members = usersRepo
      .list(db)
      .filter((u) => !u.cloudUserId)
      .map((u) => ({
        memberKey: u.id,
        name: u.name,
        username: u.username,
        email: u.email ?? "",
        role: u.role,
        active: u.active,
        // pin already stores the SHA-256 hex of the password; empty = no
        // secret set, which the server treats as "cannot mint chat tokens".
        secretHash: u.pin ?? "",
      }));
    void replaceChatDirectory(
      { members },
      { headers: { "x-license-key": licenseKey } },
    ).catch(() => {
      // Best-effort; the next sync or user change retries.
    });
  } catch {
    // Never let directory replication break the local operation.
  }
}

// Best-effort fetch of a chat member token right after the user proved their
// password (the only moment the raw secret is in hand). The token is cached
// on the local user row and attached to /api/comms/* calls; without it the
// Communications page shows guidance instead of chat.
async function fetchChatTokenCloud(
  db: AppDatabase,
  userId: Id,
  identifier: string,
  secret: string,
): Promise<void> {
  try {
    if (getWorkspaceMode(db) !== "activated") return;
    const licenseKey = activationRepo.get(db)?.licenseKey;
    if (!licenseKey || !identifier || !secret) return;
    // Local-only members must exist in the cloud directory before the server
    // can validate their credentials.
    pushChatDirectoryCloud(db);
    const result = await issueChatToken(
      { identifier, secret },
      { headers: { "x-license-key": licenseKey } },
    );
    const updated = usersRepo.update(db, userId, { chatToken: result.token });
    if (session.user?.id === userId) session.user = updated;
    await db.flush();
  } catch {
    // Offline or the hub is unreachable: sign-in proceeds; chat shows
    // guidance until a later online sign-in succeeds.
  }
}

function freshCalculation(db: AppDatabase, ledgerId: Id): CalculationResult {
  const txns = ledgersRepo.listTransactions(db, ledgerId);
  const result = calculateRentOnly(ledgerId, txns);
  calculationsRepo.upsert(db, result);
  return result;
}

function statusChange(db: AppDatabase, notice: Notice, toStatus: NoticeStatus, reason = ""): Notice {
  const from = notice.status;
  const next = noticesRepo.update(db, notice.id, { status: toStatus });
  statusHistoryRepo.create(db, {
    id: uid("sh"),
    noticeId: notice.id,
    fromStatus: from,
    toStatus,
    changedBy: session.user?.id ?? null,
    changedAt: nowIso(),
    reason,
  });
  logAudit(
    db,
    toStatus === "sent_to_attorney" ? "sent_to_attorney" : "status_changed",
    "notice",
    notice.id,
    `Status changed: ${NOTICE_STATUS_LABELS[from]} \u2192 ${NOTICE_STATUS_LABELS[toStatus]}`,
    { previousValue: from, newValue: toStatus, reason: reason || null },
  );
  return next;
}

function runValidation(db: AppDatabase, notice: Notice): ValidationResult {
  const tenant = tenantsRepo.get(db, notice.tenantId);
  const property = propertiesRepo.get(db, notice.propertyId);
  const company = companyRepo.get(db);
  const settings = settingsRepo.get(db);
  const transactions = notice.ledgerId ? ledgersRepo.listTransactions(db, notice.ledgerId) : [];
  const calculation = notice.ledgerId
    ? calculationsRepo.get(db, notice.ledgerId) ??
      calculateRentOnly(notice.ledgerId, transactions)
    : null;
  const template = notice.templateId ? templatesRepo.get(db, notice.templateId) : null;
  const result = validateNoticeEngine({
    notice,
    tenant,
    property,
    company,
    calculation,
    transactions,
    existingNotices: noticesRepo.list(db).filter((n) => n.id !== notice.id),
    template: template ? { attorneyReviewed: template.attorneyReviewed } : null,
    settings: settings
      ? {
          requireAttorneyReviewedTemplate: settings.requireAttorneyReviewedTemplate,
          allowAdminTemplateOverride: settings.allowAdminTemplateOverride,
        }
      : undefined,
    currentUserRole: session.user?.role,
    stateRuleReview: notice.jurisdiction
      ? stateRuleReviewsRepo.get(db, notice.jurisdiction)
      : null,
  });
  validationResultsRepo.upsert(db, result);
  return result;
}

function applyNoticeFilters(list: Notice[], filters?: NoticeFilters): Notice[] {
  let out = list;
  if (filters) {
    const f = filters;
    if (f.search) {
      const q = f.search.toLowerCase();
      out = out.filter(
        (n) =>
          n.tenantNames.some((x) => x.toLowerCase().includes(q)) ||
          n.propertyAddress.toLowerCase().includes(q) ||
          n.unit.toLowerCase().includes(q),
      );
    }
    if (f.status && f.status !== "all") out = out.filter((n) => n.status === f.status);
    if (f.noticeType && f.noticeType !== "all")
      out = out.filter((n) => n.noticeType === f.noticeType);
    if (f.propertyId && f.propertyId !== "all")
      out = out.filter((n) => n.propertyId === f.propertyId);
    if (f.tenantId) out = out.filter((n) => n.tenantId === f.tenantId);
    if (f.month) out = out.filter((n) => n.months.some((m) => m.month === f.month));
    if (f.createdFrom) out = out.filter((n) => n.createdAt >= f.createdFrom!);
    if (f.createdTo) out = out.filter((n) => n.createdAt <= `${f.createdTo}T23:59:59`);
    if (f.servedFrom) out = out.filter((n) => (n.service.dateServed ?? "") >= f.servedFrom!);
    if (f.servedTo) out = out.filter((n) => (n.service.dateServed ?? "9999") <= f.servedTo!);
    if (f.amountMinCents != null) out = out.filter((n) => n.totalAmountCents >= f.amountMinCents!);
    if (f.amountMaxCents != null) out = out.filter((n) => n.totalAmountCents <= f.amountMaxCents!);
    if (f.preparedBy && f.preparedBy !== "all") out = out.filter((n) => n.preparedBy === f.preparedBy);
  }
  return [...out].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function hydrateDocument(db: AppDatabase, doc: NoticeDocument): NoticeDocument {
  let url = blobUrlCache.get(doc.id);
  if (!url) {
    const bytes = documentsRepo.getBytes(db, doc.id);
    if (bytes) {
      // Attorney uploads may be images; type the blob by the stored mime.
      const mime = doc.mimeType || "application/pdf";
      const blob =
        mime === "application/pdf"
          ? bytesToBlob(bytes)
          : new Blob([new Uint8Array(bytes)], { type: mime });
      url = URL.createObjectURL(blob);
      blobUrlCache.set(doc.id, url);
    }
  }
  return { ...doc, blobUrl: url ?? "" };
}

// ------------------------------- services -----------------------------------

/**
 * Provisions a clean activated workspace from the cloud company directory and
 * signs the given member in. Shared by license-key activation and invite-code
 * redemption; any demo/leftover local data is wiped first.
 */
async function provisionActivatedWorkspace(opts: {
  licenseKey: string;
  license: LicenseSummary;
  directory: DirectoryUser[];
  me: DirectoryUser;
  /** sha256 hash of the secret the signing-in member just used online. */
  myHash: string;
  /** Raw credentials the member just verified online, used once to mint a chat token. */
  identifier: string;
  secret: string;
}): Promise<SessionInfo> {
  const { licenseKey, license, directory, me, myHash, identifier, secret } = opts;

  // Activation always provisions a clean workspace: wipe demo/leftover data.
  let db = await getDb();
  if (getWorkspaceMode(db) !== "unset" || usersRepo.count(db) > 0) {
    db.close();
    dbPromise = null;
    await clearPersistedDatabase();
    db = await getDb();
  }

  const now = nowIso();
  db.transaction(() => {
    companyRepo.create(db, {
      id: "company-1",
      name: license.companyName,
      address: "",
      phone: "",
      email: "",
      logoDataUrl: null,
      notes: "",
      createdAt: now,
      updatedAt: now,
    });
    settingsRepo.create(db, {
      id: "app",
      companyProfileId: "company-1",
      defaultJurisdiction: "CA",
      requireAttorneyReviewedTemplate: true,
      allowAdminTemplateOverride: false,
      pinLockEnabled: true,
      autoLockMinutes: 15,
      aiAssistEnabled: false,
      aiConsentAcknowledged: false,
      syncEnabled: false,
      syncEndpoint: "",
      disclaimerAcknowledgedAt: null,
      onboardingCompleted: false,
      buildiumClientId: "",
      buildiumClientSecret: "",
      buildiumConnectedAt: null,
      buildiumLastSyncAt: null,
      updatedAt: now,
    });
    seedReferenceData(db);
    for (const member of directory) {
      const localUser: User = {
        id: uid("user"),
        name: member.name,
        initials: initialsOf(member.name),
        username: member.username,
        email: member.email,
        role: member.role,
        // Only the member who just verified online gets a cached secret;
        // everyone else verifies online on their own first sign-in.
        pin: member.cloudUserId === me.cloudUserId ? myHash : null,
        active: member.active,
        createdAt: now,
        cloudUserId: member.cloudUserId,
        chatToken: null,
      };
      usersRepo.create(db, localUser);
    }
    activationRepo.set(db, {
      licenseKey,
      companyId: license.companyId,
      companyName: license.companyName,
      licenseStatus: license.status,
      statusReason: license.statusReason,
      plan: license.plan,
      activatedAt: now,
      lastVerifiedAt: now,
      graceDays: license.graceDays,
      directorySyncedAt: now,
    });
    setWorkspaceMode(db, "activated");
  });
  const currentUser = usersRepo.list(db).find((u) => u.cloudUserId === me.cloudUserId);
  if (!currentUser) {
    throw new Error("Activation failed: your account was not found in the company directory.");
  }
  session.user = currentUser;
  session.locked = false;
  refreshLicenseGate(db);
  logAudit(
    db,
    "workspace_activated",
    "settings",
    "activation",
    `Workspace activated for ${license.companyName}`,
  );
  logAudit(db, "login", "user", currentUser.id, `${currentUser.name} signed in`);
  await db.flush();
  await fetchChatTokenCloud(db, currentUser.id, identifier, secret);
  return { user: session.user ? { ...session.user } : { ...currentUser }, locked: false };
}

function createServices(): AppServices {
  const services = {
    // --- session & users ---
    async getSession(): Promise<SessionInfo> {
      await getDb();
      return { user: session.user ? { ...session.user } : null, locked: session.locked };
    },
    async listUsers(): Promise<User[]> {
      const db = await getDb();
      return usersRepo.list(db);
    },
    async login(identifier: string, secret: string): Promise<SessionInfo> {
      const db = await getDb();
      // One generic error for every failure mode so the login form never
      // reveals which accounts exist.
      const invalidCredentials = () => new Error("Invalid email or password");
      let user = usersRepo.findByIdentifier(db, identifier);
      if (!user || !user.active) throw invalidCredentials();
      if (user.pin) {
        if (!secret) throw invalidCredentials();
        const hash = await sha256Hex(secret);
        if (hash !== user.pin) throw invalidCredentials();
      } else if (user.cloudUserId && getWorkspaceMode(db) === "activated") {
        // Activated workspace, first sign-in on this device: verify against
        // the cloud directory once, then cache a local hash for offline use.
        const activation = activationRepo.get(db);
        if (!activation) throw invalidCredentials();
        try {
          await getLicensingClient().verifyCredentials(activation.licenseKey, identifier, secret);
        } catch (err) {
          if (err instanceof LicensingUnavailableError) {
            throw new Error(
              "Your first sign-in on this device requires an internet connection. Reconnect and try again — afterwards you can sign in offline.",
            );
          }
          throw invalidCredentials();
        }
        user = usersRepo.update(db, user.id, { pin: await sha256Hex(secret) });
      }
      session.user = user;
      session.locked = false;
      logAudit(db, "login", "user", user.id, `${user.name} signed in`);
      // Rotate the chat member token while the raw secret is in hand:
      // tokens expire server-side, so every online sign-in silently
      // re-mints a fresh one (best-effort; offline sign-in still works and
      // keeps the cached token, chat shows guidance if it has expired).
      await fetchChatTokenCloud(db, user.id, identifier, secret);
      const fresh = session.user ?? user;
      return { user: { ...fresh }, locked: false };
    },
    async lockApp(): Promise<SessionInfo> {
      await getDb();
      session.locked = true;
      return { user: session.user ? { ...session.user } : null, locked: true };
    },
    async clearChatToken(): Promise<SessionInfo> {
      const db = await getDb();
      if (session.user?.chatToken) {
        const updated = usersRepo.update(db, session.user.id, { chatToken: null });
        session.user = updated;
        await db.flush();
      }
      return {
        user: session.user ? { ...session.user } : null,
        locked: session.locked,
      };
    },
    async createUser(input): Promise<User> {
      requirePermission("user.manage");
      const db = await getDb();
      const username = normalizeUsername(input.username);
      if (!username) throw new Error("Username is required");
      if (username.includes("@")) throw new Error("Username cannot contain '@'");
      const email = normalizeEmail(input.email);
      if (usersRepo.findByIdentifier(db, username))
        throw new Error("Username is already in use");
      if (email && usersRepo.findByIdentifier(db, email))
        throw new Error("Email is already in use");
      let pinHash: string | null = null;
      if (input.pin !== undefined && input.pin !== null && input.pin !== "") {
        if (!looksLikeRawSecret(input.pin)) throw new Error(INVALID_SECRET_MESSAGE);
        pinHash = await sha256Hex(input.pin);
      }
      const user: User = {
        id: uid("user"),
        name: input.name,
        initials: initialsOf(input.name),
        username,
        email,
        role: input.role,
        pin: pinHash,
        active: true,
        createdAt: nowIso(),
        cloudUserId: null,
        chatToken: null,
      };
      usersRepo.create(db, user);
      logAudit(db, "user_created", "user", user.id, `Created user ${user.name} (${user.role})`);
      pushChatDirectoryCloud(db);
      return user;
    },
    async updateUser(id, patch): Promise<User> {
      requirePermission("user.manage");
      const db = await getDb();
      const next = { ...patch };
      // next.pin may be: undefined (no change), null/"" (clear), an existing
      // stored hash (pass through), or a raw password (hash it). Anything
      // else is an invalid raw secret and must be rejected — never stored.
      if (typeof next.pin === "string" && !isStoredSecretHash(next.pin)) {
        if (next.pin === "") next.pin = null;
        else if (looksLikeRawSecret(next.pin)) next.pin = await sha256Hex(next.pin);
        else throw new Error(INVALID_SECRET_MESSAGE);
      }
      if (next.name) next.initials = patch.initials ?? initialsOf(next.name);
      if (next.username !== undefined) {
        const username = normalizeUsername(next.username ?? "");
        if (!username) throw new Error("Username is required");
        if (username.includes("@")) throw new Error("Username cannot contain '@'");
        const clash = usersRepo.findByIdentifier(db, username);
        if (clash && clash.id !== id) throw new Error("Username is already in use");
        next.username = username;
      }
      if (next.email !== undefined) {
        const email = normalizeEmail(next.email);
        if (email) {
          const clash = usersRepo.findByIdentifier(db, email);
          if (clash && clash.id !== id) throw new Error("Email is already in use");
        }
        next.email = email;
      }
      const user = usersRepo.update(db, id, next);
      if (session.user?.id === id) session.user = user;
      logAudit(db, "user_updated", "user", id, `Updated user ${user.name}`);
      pushChatDirectoryCloud(db);
      return user;
    },
    async changeMyPassword({ currentPassword, newPassword }): Promise<User> {
      const db = await getDb();
      if (!session.user || session.locked) {
        throw new Error("Sign in to change your password.");
      }
      const me = usersRepo.get(db, session.user.id);
      if (!me || !me.active) throw new Error("Your account is no longer available.");
      if (!looksLikeRawSecret(newPassword)) throw new Error(INVALID_SECRET_MESSAGE);

      // Verify the current password against the locally cached hash. Legacy
      // accounts may still carry a hash of a short numeric secret — comparing
      // hashes accepts whatever they currently sign in with. Accounts without
      // any stored secret (local-only, never set one) skip this check.
      if (me.pin) {
        const currentHash = await sha256Hex(currentPassword);
        if (currentHash !== me.pin) throw new Error("Current password is incorrect");
      }

      // Activated workspaces: the cloud directory is the source of truth for
      // credentials (same password as the customer website), so update it
      // first — if the service is unreachable, change nothing locally either.
      if (getWorkspaceMode(db) === "activated" && me.cloudUserId) {
        const activation = activationRepo.get(db);
        if (!activation) throw new Error("This workspace is missing its license activation.");
        if (!me.email) {
          throw new Error(
            "Your account has no email on file. Ask your company admin to update it on the customer website first.",
          );
        }
        try {
          await getLicensingClient().changePassword(
            activation.licenseKey,
            me.email,
            currentPassword,
            newPassword,
          );
        } catch (err) {
          if (err instanceof LicensingUnavailableError) {
            throw new Error(
              "Changing your password requires an internet connection so your company account stays in sync. Reconnect and try again.",
            );
          }
          throw err;
        }
      }

      // Refresh the local hash so offline sign-in works with the new password.
      const updated = usersRepo.update(db, me.id, { pin: await sha256Hex(newPassword) });
      session.user = updated;
      logAudit(db, "user_updated", "user", me.id, `${me.name} changed their password`);
      await db.flush();
      // The new password invalidates the credentials the chat token was
      // minted with; refresh it while the raw secret is in hand.
      await fetchChatTokenCloud(db, me.id, me.email ?? me.username, newPassword);
      return session.user ?? updated;
    },

    // --- workspace activation ---
    async getWorkspaceState() {
      const db = await getDb();
      return workspaceState(db);
    },
    async enterDemoMode(): Promise<void> {
      const db = await getDb();
      if (getWorkspaceMode(db) === "activated")
        throw new Error("This workspace is already activated with a company license.");
      await seedDatabase(db);
      setWorkspaceMode(db, "demo");
      await db.flush();
    },

    // --- sample data ---
    async getSampleDataState(): Promise<SampleDataState> {
      const db = await getDb();
      const active = isSampleDataLoaded(db);
      let blockedReason: string | null = null;
      if (active) {
        blockedReason = "Sample data is already loaded.";
      } else if (!session.user || session.locked) {
        blockedReason = "Sign in to manage sample data.";
      } else if (session.user.role !== "admin") {
        blockedReason = "Only administrators can load sample data.";
      } else if (licenseGate.blocked && licenseGate.reason) {
        blockedReason = LICENSE_BLOCK_MESSAGES[licenseGate.reason];
      } else if (
        // Demo workspaces are playgrounds — the seeded demo records aren't
        // real data, so the "empty-ish" guard only applies once activated.
        getWorkspaceMode(db) !== "demo" &&
        countRealProperties(db) >= SAMPLE_MAX_REAL_PROPERTIES
      ) {
        blockedReason =
          "This workspace already contains real property records. Sample data can only be loaded into an empty (or nearly empty) workspace.";
      }
      return { active, canLoad: blockedReason === null, blockedReason };
    },
    async loadSampleData(options?: SampleDataOptions | null, onProgress?): Promise<void> {
      const db = await getDb();
      requireSampleDataAdmin();
      if (isSampleDataLoaded(db)) throw new Error("Sample data is already loaded.");
      if (
        getWorkspaceMode(db) !== "demo" &&
        countRealProperties(db) >= SAMPLE_MAX_REAL_PROPERTIES
      ) {
        throw new Error(
          "This workspace already contains real property records. Sample data can only be loaded into an empty (or nearly empty) workspace.",
        );
      }
      const stats = await loadSamplePortfolio(db, session.user?.id ?? "", options, onProgress);
      logAudit(
        db,
        "sample_data_loaded",
        "settings",
        null,
        `Loaded sample portfolio: ${stats.properties} properties, ${stats.units} units, ${stats.tenants} tenants, ${stats.notices} notices`,
      );
      await db.flush();
    },
    async removeSampleData(): Promise<void> {
      const db = await getDb();
      requireSampleDataAdmin();
      if (!isSampleDataLoaded(db)) throw new Error("No sample data is loaded.");
      await removeSamplePortfolio(db);
      logAudit(db, "sample_data_removed", "settings", null, "Removed all sample portfolio data");
      await db.flush();
    },
    async validateLicenseKey(licenseKey: string) {
      const key = licenseKey.trim();
      if (!key) throw new Error("Enter your license key");
      return getLicensingClient().validateKey(key);
    },
    async activateWorkspace(input): Promise<SessionInfo> {
      const key = input.licenseKey.trim();
      if (!key) throw new Error("Enter your license key");
      const client = getLicensingClient();
      const license = await client.validateKey(key);
      if (license.status !== "active") {
        throw new Error(
          license.status === "paused"
            ? "This license is currently paused (check the subscription billing). It cannot activate new devices."
            : "This license has been cancelled and can no longer activate devices.",
        );
      }
      const me = await client.verifyCredentials(key, input.identifier, input.secret);
      const directory = await client.fetchDirectory(key);
      if (!me.active) throw new Error("Your account has been deactivated by your company admin.");
      return provisionActivatedWorkspace({
        licenseKey: key,
        license,
        directory,
        me,
        myHash: await sha256Hex(input.secret),
        identifier: input.identifier,
        secret: input.secret,
      });
    },
    async redeemInviteCode(input): Promise<SessionInfo> {
      const code = input.inviteCode.trim();
      if (!code) throw new Error("Enter your invite code");
      const name = input.name.trim();
      if (!name) throw new Error("Enter your name");
      if (input.password.length < 8) throw new Error("Password must be at least 8 characters");
      const redemption = await getLicensingClient().redeemInvite({
        inviteCode: code,
        name,
        password: input.password,
      });
      return provisionActivatedWorkspace({
        licenseKey: redemption.licenseKey,
        license: redemption.license,
        directory: redemption.directory,
        me: redemption.me,
        myHash: await sha256Hex(input.password),
        identifier: redemption.me.email || redemption.me.username,
        secret: input.password,
      });
    },
    async syncLicense(): Promise<WorkspaceState> {
      const db = await getDb();
      if (getWorkspaceMode(db) !== "activated") return workspaceState(db);
      const activation = activationRepo.get(db);
      if (!activation) return workspaceState(db);
      try {
        // Acquired inside the try: an unconfigured build throws
        // LicensingUnavailableError synchronously, which must mean
        // "keep cached state", not a rejected sync.
        const client = getLicensingClient();
        const status = await client.checkStatus(activation.licenseKey);
        const directory = await client.fetchDirectory(activation.licenseKey);
        const now = nowIso();
        db.transaction(() => {
          const locals = usersRepo.list(db);
          const byCloudId = new Map(
            locals.filter((u) => u.cloudUserId).map((u) => [u.cloudUserId as string, u]),
          );
          for (const member of directory) {
            const existing = byCloudId.get(member.cloudUserId);
            if (existing) {
              // Cloud is the source of truth for identity and role; the
              // locally cached secret (pin) is deliberately left untouched.
              usersRepo.update(db, existing.id, {
                name: member.name,
                initials: initialsOf(member.name),
                username: member.username,
                email: member.email,
                role: member.role,
                active: member.active,
              });
            } else {
              usersRepo.create(db, {
                id: uid("user"),
                name: member.name,
                initials: initialsOf(member.name),
                username: member.username,
                email: member.email,
                role: member.role,
                pin: null, // verified online on their first sign-in
                active: member.active,
                createdAt: now,
                cloudUserId: member.cloudUserId,
                chatToken: null,
              });
            }
          }
          // Members removed from the cloud directory lose access here too.
          const cloudIds = new Set(directory.map((m) => m.cloudUserId));
          for (const u of locals) {
            if (u.cloudUserId && !cloudIds.has(u.cloudUserId) && u.active) {
              usersRepo.update(db, u.id, { active: false });
            }
          }
          activationRepo.update(db, {
            licenseStatus: status.status,
            statusReason: status.statusReason,
            plan: status.plan,
            companyName: status.companyName,
            graceDays: status.graceDays,
            lastVerifiedAt: now,
            directorySyncedAt: now,
          });
        });
        // Keep the in-memory session consistent with directory changes.
        if (session.user) {
          const fresh = usersRepo.list(db).find((u) => u.id === session.user?.id);
          session.user = fresh && fresh.active ? fresh : null;
        }
        logAudit(
          db,
          "directory_synced",
          "settings",
          "activation",
          `License verified and directory synced (${directory.length} members)`,
        );
        await db.flush();
        pushChatDirectoryCloud(db);
      } catch (err) {
        if (err instanceof LicenseInvalidError) {
          // The key was revoked or no longer exists upstream.
          activationRepo.update(db, {
            licenseStatus: "cancelled",
            statusReason: "This license key is no longer recognized by the licensing service.",
          });
          await db.flush();
        } else if (!(err instanceof LicensingUnavailableError)) {
          throw err;
        }
        // Service unreachable: keep cached state; the grace period governs lockout.
      }
      return workspaceState(db);
    },

    // --- company & settings ---
    async getCompanyProfile(): Promise<CompanyProfile> {
      const db = await getDb();
      return requireCompany(db);
    },
    async updateCompanyProfile(patch): Promise<CompanyProfile> {
      requirePermission("settings.manage");
      const db = await getDb();
      const current = requireCompany(db);
      const next = companyRepo.update(db, current.id, patch);
      logAudit(db, "settings_changed", "company", current.id, "Updated company profile");
      return next;
    },
    async getSettings() {
      const db = await getDb();
      const settings = settingsRepo.get(db);
      if (!settings) throw new Error("Application settings are not initialized.");
      return settings;
    },
    async updateSettings(patch) {
      requirePermission("settings.manage");
      const db = await getDb();
      const next = settingsRepo.update(db, patch);
      logAudit(db, "settings_changed", "settings", "app", "Updated application settings");
      return next;
    },

    // --- properties ---
    async listProperties(search?: string): Promise<Property[]> {
      const db = await getDb();
      return propertiesRepo.list(db, search);
    },
    async getProperty(id: Id): Promise<Property | null> {
      const db = await getDb();
      return propertiesRepo.get(db, id);
    },
    async createProperty(input): Promise<Property> {
      requirePermission("property.manage");
      const db = await getDb();
      const t = nowIso();
      const property: Property = {
        id: uid("prop"),
        nickname: input.nickname,
        addressLine1: input.addressLine1,
        addressLine2: input.addressLine2 ?? "",
        city: input.city,
        state: input.state,
        zip: input.zip,
        county: input.county ?? "",
        bedrooms: input.bedrooms ?? null,
        units: input.units ?? [],
        ownerName: input.ownerName,
        managementCompany: input.managementCompany ?? "",
        managerContact: input.managerContact ?? "",
        payment: { ...defaultPayment(companyRepo.get(db)), ...(input.payment ?? {}) },
        isLosAngelesCity: input.isLosAngelesCity ?? false,
        notes: input.notes ?? "",
        externalSource: null,
        externalId: null,
        createdAt: t,
        updatedAt: t,
      };
      propertiesRepo.create(db, property);
      logAudit(db, "property_created", "property", property.id, `Added property ${property.nickname}`);
      return property;
    },
    async updateProperty(id, patch): Promise<Property> {
      requirePermission("property.manage");
      const db = await getDb();
      const next = propertiesRepo.update(db, id, patch);
      logAudit(db, "property_updated", "property", id, `Updated property ${next.nickname}`);
      return next;
    },
    async deleteProperty(id: Id): Promise<void> {
      requirePermission("property.manage");
      const db = await getDb();
      const property = propertiesRepo.get(db, id);
      propertiesRepo.remove(db, id);
      logAudit(db, "property_deleted", "property", id, `Deleted property ${property?.nickname ?? id}`);
    },
    async upsertExternalProperty(
      input: ExternalPropertyUpsert,
    ): Promise<{ property: Property; created: boolean }> {
      requirePermission("property.manage");
      const db = await getDb();
      const existing = propertiesRepo.findByExternal(db, input.externalSource, input.externalId);
      if (existing) {
        // Refresh imported fields; keep user-entered data (payment profile,
        // notes, LA-city flag, county, manager contacts) untouched.
        const next = propertiesRepo.update(db, existing.id, {
          nickname: input.nickname,
          addressLine1: input.addressLine1,
          addressLine2: input.addressLine2,
          city: input.city,
          state: input.state,
          zip: input.zip,
          units: input.units,
          // Buildium doesn't expose the owner name on rentals; never blank
          // out a value the user typed in by hand.
          ...(input.ownerName ? { ownerName: input.ownerName } : {}),
        });
        logAudit(
          db,
          "property_updated",
          "property",
          next.id,
          `Refreshed property ${next.nickname} from ${input.externalSource}`,
        );
        return { property: next, created: false };
      }
      const t = nowIso();
      const property: Property = {
        id: uid("prop"),
        nickname: input.nickname,
        addressLine1: input.addressLine1,
        addressLine2: input.addressLine2,
        city: input.city,
        state: input.state,
        zip: input.zip,
        county: "",
        bedrooms: null,
        units: input.units,
        ownerName: input.ownerName,
        managementCompany: "",
        managerContact: "",
        payment: defaultPayment(companyRepo.get(db)),
        isLosAngelesCity: false,
        notes: "",
        externalSource: input.externalSource,
        externalId: input.externalId,
        createdAt: t,
        updatedAt: t,
      };
      propertiesRepo.create(db, property);
      logAudit(
        db,
        "property_created",
        "property",
        property.id,
        `Imported property ${property.nickname} from ${input.externalSource}`,
      );
      return { property, created: true };
    },

    // --- tenants ---
    async listTenants(search?: string, propertyId?: Id): Promise<Tenant[]> {
      const db = await getDb();
      return tenantsRepo.list(db, search, propertyId);
    },
    async getTenant(id: Id): Promise<Tenant | null> {
      const db = await getDb();
      return tenantsRepo.get(db, id);
    },
    async createTenant(input): Promise<Tenant> {
      requirePermission("tenant.manage");
      const db = await getDb();
      const t = nowIso();
      const tenant: Tenant = {
        id: uid("tenant"),
        names: input.names,
        propertyId: input.propertyId,
        unit: input.unit ?? "",
        email: input.email ?? "",
        phone: input.phone ?? "",
        monthlyRentCents: input.monthlyRentCents ?? null,
        leaseStart: input.leaseStart ?? null,
        moveOutDate: null,
        notes: input.notes ?? "",
        archived: false,
        externalSource: null,
        externalId: null,
        createdAt: t,
        updatedAt: t,
      };
      tenantsRepo.create(db, tenant);
      logAudit(db, "tenant_created", "tenant", tenant.id, `Added tenant ${tenant.names.join(", ")}`);
      return tenant;
    },
    async upsertExternalTenant(
      input: ExternalTenantUpsert,
    ): Promise<{ tenant: Tenant; created: boolean }> {
      requirePermission("tenant.manage");
      const db = await getDb();
      const existing = tenantsRepo.findByExternal(db, input.externalSource, input.externalId);
      if (existing) {
        // Refresh imported fields; keep notes/archived state untouched.
        const next = tenantsRepo.update(db, existing.id, {
          names: input.names,
          propertyId: input.propertyId,
          unit: input.unit,
          email: input.email,
          phone: input.phone,
          monthlyRentCents: input.monthlyRentCents,
          leaseStart: input.leaseStart,
        });
        logAudit(
          db,
          "tenant_updated",
          "tenant",
          next.id,
          `Refreshed tenant ${next.names.join(", ")} from ${input.externalSource}`,
        );
        return { tenant: next, created: false };
      }
      const t = nowIso();
      const tenant: Tenant = {
        id: uid("tenant"),
        names: input.names,
        propertyId: input.propertyId,
        unit: input.unit,
        email: input.email,
        phone: input.phone,
        monthlyRentCents: input.monthlyRentCents,
        leaseStart: input.leaseStart,
        moveOutDate: null,
        notes: "",
        archived: false,
        externalSource: input.externalSource,
        externalId: input.externalId,
        createdAt: t,
        updatedAt: t,
      };
      tenantsRepo.create(db, tenant);
      logAudit(
        db,
        "tenant_created",
        "tenant",
        tenant.id,
        `Imported tenant ${tenant.names.join(", ")} from ${input.externalSource}`,
      );
      return { tenant, created: true };
    },
    async updateTenant(id, patch): Promise<Tenant> {
      requirePermission("tenant.manage");
      const db = await getDb();
      const next = tenantsRepo.update(db, id, patch);
      logAudit(db, "tenant_updated", "tenant", id, `Updated tenant ${next.names.join(", ")}`);
      return next;
    },
    async deleteTenant(id: Id): Promise<void> {
      requirePermission("tenant.manage");
      const db = await getDb();
      const tenant = tenantsRepo.get(db, id);
      tenantsRepo.remove(db, id);
      logAudit(db, "tenant_deleted", "tenant", id, `Deleted tenant ${tenant?.names.join(", ") ?? id}`);
    },

    // --- ledgers & import ---
    async listLedgers(tenantId?: Id): Promise<Ledger[]> {
      const db = await getDb();
      return ledgersRepo.list(db, tenantId);
    },
    async getLedger(id: Id): Promise<LedgerDetail | null> {
      const db = await getDb();
      return ledgersRepo.getDetail(db, id);
    },
    async parseLedgerFile(file: File) {
      await getDb();
      const parsed = await parseFile(file);
      return toParsedLedgerFile(file.name, parsed);
    },
    async importLedger(input: ImportLedgerInput): Promise<Ledger> {
      requirePermission("ledger.manage");
      const db = await getDb();
      const t = nowIso();
      const ledger: Ledger = {
        id: uid("ledger"),
        tenantId: input.tenantId,
        name: input.name,
        sourceType: input.sourceType,
        sourceFileName: input.fileName,
        vendor: input.vendor,
        mappingUsed: input.mapping,
        importedAt: t,
        importedBy: session.user?.id ?? null,
        transactionCount: 0,
        periodStart: null,
        periodEnd: null,
        notes: "",
      };
      const txns: LedgerTransaction[] = [];

      const pushTxn = (
        date: string,
        description: string,
        category: string,
        memo: string,
        amountCents: number,
        rowIndex: number,
        balance: number | null,
        transactionType = "",
      ) => {
        const cls = classifyRow({ description, category, memo, transactionType, amountCents });
        txns.push({
          id: uid("txn"),
          ledgerId: ledger.id,
          rowIndex,
          date,
          month: date.slice(0, 7),
          description,
          originalCategory: category,
          memo,
          kind: cls.kind,
          amountCents,
          balanceCents: balance,
          systemClass: cls.category,
          confidence: confidenceToUnit(cls.confidence),
          includedInNotice: cls.includedInNotice,
          classReason: cls.reason,
          userOverrideClass: null,
          overrideReason: null,
          overriddenBy: null,
          flagged: cls.needsReview,
          flagReason: cls.needsReview ? cls.reason : null,
        });
      };

      const m = input.mapping;
      if (input.manualTransactions?.length) {
        input.manualTransactions.forEach((mt, i) =>
          pushTxn(mt.date, mt.description, mt.category, mt.memo ?? "", mt.amountCents, i + 1, null),
        );
      } else if (m) {
        // Match normalizeRecords: a date column full of unformatted Excel
        // serial numbers ("46204") is interpreted as serial dates so the
        // final import keeps the same rows the mapping preview showed.
        const interpretSerialDates = shouldInterpretExcelSerialDates(
          input.rows.map((row) => (m.date ? row[m.date] ?? "" : "")),
        );
        input.rows.forEach((row, i) => {
          const rawDate = m.date ? row[m.date] ?? "" : "";
          let date = parseDateToIso(rawDate);
          if (!date && interpretSerialDates && looksLikeExcelSerialDate(rawDate)) {
            date = parseExcelSerialStringToIso(rawDate);
          }
          if (!date) return;
          const description = (m.description ? row[m.description] : "") ?? "";
          const category = (m.category ? row[m.category] : "") ?? "";
          const memo = (m.memo ? row[m.memo] : "") ?? "";
          const txnType = (m.transactionType ? row[m.transactionType] : "") ?? "";
          const balance = m.balance ? parseMoneyToCents(row[m.balance] ?? "") : null;
          const charge = m.chargeAmount ? parseMoneyToCents(row[m.chargeAmount] ?? "") : null;
          const payment = m.paymentAmount ? parseMoneyToCents(row[m.paymentAmount] ?? "") : null;
          const credit = m.creditAmount ? parseMoneyToCents(row[m.creditAmount] ?? "") : null;
          const single = m.amount ? parseMoneyToCents(row[m.amount] ?? "") : null;
          if (charge && charge !== 0)
            pushTxn(date, description, category, memo, Math.abs(charge), i + 1, balance, txnType);
          if (payment && payment !== 0)
            pushTxn(date, description || "Payment", category, memo, -Math.abs(payment), i + 1, balance, txnType);
          if (credit && credit !== 0)
            pushTxn(date, description || "Credit", category, memo, -Math.abs(credit), i + 1, balance, txnType);
          if (!charge && !payment && !credit && single != null && single !== 0) {
            const typeLower = txnType.toLowerCase();
            const negative =
              typeLower.includes("payment") || typeLower.includes("credit")
                ? -Math.abs(single)
                : single;
            pushTxn(date, description, category, memo, negative, i + 1, balance, txnType);
          }
          // "Previous balance" statement rows carry no amount cell — mirror
          // normalizeRecords and treat the running balance as the
          // carried-forward amount owed at the start of the period.
          if (
            !charge &&
            !payment &&
            !credit &&
            single == null &&
            balance != null &&
            balance !== 0 &&
            isPriorBalanceDescription(description)
          ) {
            pushTxn(date, description, category, memo, balance, i + 1, balance, txnType);
          }
        });
      }

      ledger.transactionCount = txns.length;
      const dates = txns.map((x) => x.date).sort();
      ledger.periodStart = dates[0] ?? null;
      ledger.periodEnd = dates[dates.length - 1] ?? null;

      ledgersRepo.create(db, ledger, txns);

      if (input.savePresetName && input.mapping) {
        mappingPresetsRepo.create(db, {
          id: uid("preset"),
          name: input.savePresetName,
          vendor: input.vendor,
          mapping: input.mapping,
          createdAt: t,
        });
      }
      logAudit(
        db,
        "ledger_imported",
        "ledger",
        ledger.id,
        `Imported ledger "${ledger.name}" (${txns.length} transactions)`,
      );
      return ledger;
    },
    async deleteLedger(id: Id): Promise<void> {
      requirePermission("ledger.manage");
      const db = await getDb();
      calculationsRepo.remove(db, id);
      ledgersRepo.remove(db, id);
      logAudit(db, "ledger_deleted", "ledger", id, "Deleted ledger");
    },
    async overrideClassification(input: ClassificationOverrideInput): Promise<LedgerTransaction> {
      requirePermission("ledger.manage");
      const db = await getDb();
      if (!input.reason.trim()) throw new Error("A reason is required for manual overrides");
      const current = ledgersRepo.getTransaction(db, input.transactionId);
      if (!current) throw new Error("Transaction not found");
      const prev = `${current.userOverrideClass ?? current.systemClass}/${current.includedInNotice ? "included" : "excluded"}`;
      const next = ledgersRepo.overrideClassification(db, input, session.user?.id ?? null);
      const nextLabel = `${next.userOverrideClass ?? next.systemClass}/${next.includedInNotice ? "included" : "excluded"}`;
      // Invalidate the cached calculation for this ledger.
      calculationsRepo.remove(db, current.ledgerId);
      logAudit(db, "manual_override", "transaction", next.id, `Reclassified "${next.description}"`, {
        previousValue: prev,
        newValue: nextLabel,
        reason: input.reason,
      });
      return next;
    },
    async listMappingPresets() {
      const db = await getDb();
      return mappingPresetsRepo.list(db);
    },
    async saveMappingPreset(preset) {
      requirePermission("ledger.manage");
      const db = await getDb();
      return mappingPresetsRepo.create(db, { ...preset, id: uid("preset"), createdAt: nowIso() });
    },
    async deleteMappingPreset(id: Id): Promise<void> {
      requirePermission("ledger.manage");
      const db = await getDb();
      mappingPresetsRepo.remove(db, id);
    },

    // --- attorney contacts ---
    async listAttorneyContacts() {
      const db = await getDb();
      return attorneyContactsRepo.list(db);
    },
    async saveAttorneyContact(input) {
      requirePermission("notice.create");
      const db = await getDb();
      const name = input.name.trim();
      const email = input.email.trim();
      if (!email) throw new Error("Attorney email is required");
      const existing = attorneyContactsRepo.findByEmail(db, email);
      if (existing) {
        return name && name !== existing.name
          ? attorneyContactsRepo.updateName(db, existing.id, name)
          : existing;
      }
      return attorneyContactsRepo.create(db, {
        id: uid("attorney"),
        name,
        email,
        createdAt: nowIso(),
      });
    },
    async deleteAttorneyContact(id: Id): Promise<void> {
      requirePermission("notice.create");
      const db = await getDb();
      attorneyContactsRepo.remove(db, id);
    },

    // --- calculation ---
    async calculateLedger(ledgerId: Id): Promise<CalculationResult> {
      const db = await getDb();
      return freshCalculation(db, ledgerId);
    },

    // --- notices ---
    async listNotices(filters?: NoticeFilters): Promise<Notice[]> {
      const db = await getDb();
      return applyNoticeFilters(noticesRepo.list(db), filters);
    },
    async getNotice(id: Id): Promise<Notice | null> {
      const db = await getDb();
      return noticesRepo.get(db, id);
    },
    async checkDuplicateNotice(params): Promise<DuplicateCheckResult> {
      const db = await getDb();
      return noticesRepo.checkDuplicate(db, params);
    },
    async createNotice(input: NoticeInput): Promise<Notice> {
      requirePermission("notice.create");
      const db = await getDb();
      const tenant = tenantsRepo.get(db, input.tenantId);
      const property = propertiesRepo.get(db, input.propertyId);
      if (!tenant || !property) throw new Error("Tenant and property are required");
      const t = nowIso();
      const template = input.templateId ? templatesRepo.get(db, input.templateId) : null;
      const notice: Notice = {
        id: uid("notice"),
        noticeType: input.noticeType,
        jurisdiction: input.jurisdiction,
        status: "draft",
        tenantId: input.tenantId,
        propertyId: input.propertyId,
        unit: input.unit,
        tenantNames: [...tenant.names],
        propertyAddress: singleLineAddress(property),
        ledgerId: input.ledgerId,
        months: input.months,
        totalAmountCents: input.months.reduce((s, m) => s + m.selectedAmountCents, 0),
        payment: input.payment,
        templateId: input.templateId,
        templateVersion: template?.currentVersion ?? null,
        includeLahdLetter: input.includeLahdLetter,
        covenantDescription: input.covenantDescription ?? "",
        courtDate: null,
        courtCaseNumber: "",
        courtNotes: "",
        entryDate: input.entryDate ?? null,
        entryTimeWindow: input.entryTimeWindow ?? "",
        entryReason: input.entryReason ?? "",
        terminationDate: input.terminationDate ?? null,
        rentIncreaseNewAmountCents: input.rentIncreaseNewAmountCents ?? null,
        rentIncreaseEffectiveDate: input.rentIncreaseEffectiveDate ?? null,
        version: 1,
        revisedFromId: null,
        reviewerApprovedBy: null,
        reviewerApprovedAt: null,
        finalizedBy: null,
        finalizedAt: null,
        rentOnlyAttestedBy: null,
        rentOnlyAttestedAt: null,
        localOverlayVerifiedBy: null,
        localOverlayVerifiedAt: null,
        attorneyExportFlag: false,
        prereqCompleted: input.prereqCompleted ?? {},
        ruleCardKey: input.ruleCardKey ?? null,
        electronicServiceConsent: input.electronicServiceConsent ?? false,
        service: emptyService(),
        deadlineDate: null,
        internalNotes: input.internalNotes ?? "",
        preparedBy: session.user?.id ?? null,
        createdAt: t,
        updatedAt: t,
      };
      noticesRepo.create(db, notice);
      statusHistoryRepo.create(db, {
        id: uid("sh"),
        noticeId: notice.id,
        fromStatus: null,
        toStatus: "draft",
        changedBy: session.user?.id ?? null,
        changedAt: t,
        reason: input.duplicateOverrideReason ?? "",
      });
      logAudit(
        db,
        "notice_created",
        "notice",
        notice.id,
        `Created ${NOTICE_TYPE_LABELS[notice.noticeType]} draft for ${notice.tenantNames.join(", ")}`,
        { reason: input.duplicateOverrideReason ?? null },
      );
      return notice;
    },
    async updateNotice(id, patch): Promise<Notice> {
      requirePermission("notice.create");
      const db = await getDb();
      const n = noticesRepo.get(db, id);
      if (!n) throw new Error("Notice not found");
      if (["finalized", "served", "mailed", "expired", "paid", "sent_to_attorney"].includes(n.status))
        throw new Error("Finalized notices cannot be edited. Create a revised version instead.");
      const p: Partial<Omit<Notice, "id" | "createdAt">> = {};
      if (patch.months) {
        p.months = patch.months;
        p.totalAmountCents = patch.months.reduce((s, m) => s + m.selectedAmountCents, 0);
      }
      if (patch.payment) p.payment = patch.payment;
      if (patch.templateId !== undefined) {
        p.templateId = patch.templateId;
        p.templateVersion = patch.templateId
          ? templatesRepo.get(db, patch.templateId)?.currentVersion ?? null
          : null;
      }
      if (patch.includeLahdLetter !== undefined) p.includeLahdLetter = patch.includeLahdLetter;
      if (patch.unit !== undefined) p.unit = patch.unit;
      if (patch.covenantDescription !== undefined) p.covenantDescription = patch.covenantDescription;
      if (patch.terminationDate !== undefined) p.terminationDate = patch.terminationDate ?? null;
      if (patch.entryDate !== undefined) p.entryDate = patch.entryDate ?? null;
      if (patch.entryTimeWindow !== undefined) p.entryTimeWindow = patch.entryTimeWindow;
      if (patch.entryReason !== undefined) p.entryReason = patch.entryReason;
      if (patch.rentIncreaseNewAmountCents !== undefined)
        p.rentIncreaseNewAmountCents = patch.rentIncreaseNewAmountCents ?? null;
      if (patch.rentIncreaseEffectiveDate !== undefined)
        p.rentIncreaseEffectiveDate = patch.rentIncreaseEffectiveDate ?? null;
      if (patch.internalNotes !== undefined) p.internalNotes = patch.internalNotes;
      if (patch.prereqCompleted !== undefined) p.prereqCompleted = patch.prereqCompleted ?? {};
      if (patch.ruleCardKey !== undefined) p.ruleCardKey = patch.ruleCardKey ?? null;
      if (patch.electronicServiceConsent !== undefined)
        p.electronicServiceConsent = patch.electronicServiceConsent ?? false;
      const next = noticesRepo.update(db, id, p);
      logAudit(db, "notice_updated", "notice", id, "Updated notice draft");
      return next;
    },
    async deleteNotice(id: Id, reason: string): Promise<void> {
      requirePermission("notice.delete");
      const db = await getDb();
      const n = noticesRepo.get(db, id);
      if (!n) return;
      if (n.status !== "draft" && n.status !== "needs_review")
        throw new Error("Only drafts can be deleted");
      noticesRepo.remove(db, id);
      logAudit(db, "draft_deleted", "notice", id, `Deleted draft for ${n.tenantNames.join(", ")}`, {
        reason,
      });
    },
    async validateNotice(id: Id): Promise<ValidationResult> {
      const db = await getDb();
      const n = noticesRepo.get(db, id);
      if (!n) throw new Error("Notice not found");
      return runValidation(db, n);
    },
    async changeNoticeStatus(id, toStatus, reason): Promise<Notice> {
      requirePermission("notice.status");
      if (toStatus === "reviewed") requirePermission("notice.approve");
      if (toStatus === "finalized") requirePermission("notice.finalize");
      const db = await getDb();
      const n = noticesRepo.get(db, id);
      if (!n) throw new Error("Notice not found");
      let next = statusChange(db, n, toStatus, reason ?? "");
      if (toStatus === "sent_to_attorney")
        next = noticesRepo.update(db, id, { attorneyExportFlag: true });
      return next;
    },
    async approveNotice(id: Id): Promise<Notice> {
      requirePermission("notice.approve");
      const db = await getDb();
      const n = noticesRepo.get(db, id);
      if (!n) throw new Error("Notice not found");
      const withApproval = noticesRepo.update(db, id, {
        reviewerApprovedBy: session.user?.id ?? null,
        reviewerApprovedAt: nowIso(),
      });
      return statusChange(db, withApproval, "reviewed", "Reviewer approval");
    },
    async finalizeNotice(id, acknowledgedWarnings, attestation): Promise<Notice> {
      requirePermission("notice.finalize");
      const db = await getDb();
      const n = noticesRepo.get(db, id);
      if (!n) throw new Error("Notice not found");
      const demandsMoney = n.totalAmountCents > 0 || n.months.length > 0;
      if (demandsMoney && !attestation?.rentOnlyConfirmed)
        throw new Error(
          "Cannot finalize: you must confirm the demanded amounts contain scheduled rent only (no late fees, utilities, deposits, or other non-rent charges).",
        );
      const validation = runValidation(db, n);
      if (!validation.passed)
        throw new Error(
          `Cannot finalize: ${validation.blockers} blocking issue(s) must be fixed first.`,
        );
      const unacked = unacknowledgedWarnings(validation.issues, acknowledgedWarnings);
      if (unacked.length > 0)
        throw new Error(
          `All warnings must be acknowledged with a non-empty reason before finalizing (${unacked.length} remaining).`,
        );
      for (const ack of acknowledgedWarnings) {
        logAudit(db, "warning_acknowledged", "notice", id, `Acknowledged warning ${ack.code}`, {
          reason: ack.reason,
        });
      }
      const t = nowIso();
      const withFinal = noticesRepo.update(db, id, {
        finalizedBy: session.user?.id ?? null,
        finalizedAt: t,
        ...(demandsMoney
          ? { rentOnlyAttestedBy: session.user?.id ?? null, rentOnlyAttestedAt: t }
          : {}),
      });
      const next = statusChange(db, withFinal, "finalized", "Notice finalized and locked");
      logAudit(
        db,
        "notice_finalized",
        "notice",
        id,
        `Finalized notice v${next.version} for ${next.tenantNames.join(", ")}`,
      );
      return next;
    },
    async setLocalOverlayVerified(id: Id, verified: boolean): Promise<Notice> {
      requirePermission("notice.status");
      const db = await getDb();
      const n = noticesRepo.get(db, id);
      if (!n) throw new Error("Notice not found");
      if (["finalized", "served", "mailed", "paid", "expired"].includes(n.status))
        throw new Error(
          "Local-ordinance verification cannot be changed after a notice is finalized",
        );
      const t = nowIso();
      const next = noticesRepo.update(db, id, {
        localOverlayVerifiedBy: verified ? session.user?.id ?? null : null,
        localOverlayVerifiedAt: verified ? t : null,
      });
      logAudit(
        db,
        verified ? "local_overlay_verified" : "local_overlay_verification_cleared",
        "notice",
        id,
        verified
          ? `Confirmed local ordinances were verified for ${n.tenantNames.join(", ")}`
          : `Cleared local-ordinance verification for ${n.tenantNames.join(", ")}`,
      );
      return next;
    },
    async reviseNotice(id: Id, reason: string): Promise<Notice> {
      requirePermission("notice.status");
      const db = await getDb();
      const orig = noticesRepo.get(db, id);
      if (!orig) throw new Error("Notice not found");
      const t = nowIso();
      const copy: Notice = {
        ...structuredClone(orig),
        id: uid("notice"),
        status: "draft",
        version: orig.version + 1,
        revisedFromId: orig.id,
        reviewerApprovedBy: null,
        reviewerApprovedAt: null,
        finalizedBy: null,
        finalizedAt: null,
        rentOnlyAttestedBy: null,
        rentOnlyAttestedAt: null,
        localOverlayVerifiedBy: null,
        localOverlayVerifiedAt: null,
        service: emptyService(),
        deadlineDate: null,
        createdAt: t,
        updatedAt: t,
      };
      noticesRepo.create(db, copy);
      statusHistoryRepo.create(db, {
        id: uid("sh"),
        noticeId: copy.id,
        fromStatus: null,
        toStatus: "draft",
        changedBy: session.user?.id ?? null,
        changedAt: t,
        reason: `Revision of notice v${orig.version}`,
      });
      statusChange(db, orig, "revised", reason);
      logAudit(
        db,
        "notice_revised",
        "notice",
        copy.id,
        `Created revision v${copy.version} of notice for ${copy.tenantNames.join(", ")}`,
        { reason },
      );
      return copy;
    },
    async recordService(
      id,
      service: ServiceRecord,
      options?: { source?: "field_sync"; electronicConsent?: boolean },
    ): Promise<Notice> {
      requirePermission("notice.status");
      const db = await getDb();
      const n = noticesRepo.get(db, id);
      if (!n) throw new Error("Notice not found");
      const fromFieldSync = options?.source === "field_sync";
      let next = noticesRepo.update(db, id, {
        service,
        ...(options?.electronicConsent !== undefined
          ? { electronicServiceConsent: options.electronicConsent }
          : {}),
      });
      logAudit(
        db,
        "service_recorded",
        "notice",
        id,
        fromFieldSync
          ? `Service recorded from field sync for ${n.tenantNames.join(", ")} (served by ${service.servedBy || "unknown"})`
          : `Service recorded for ${n.tenantNames.join(", ")}`,
        { reason: fromFieldSync ? "field_sync" : null },
      );
      if (service.dateServed) {
        const tenant = n.noticeType === "rent_increase" ? tenantsRepo.get(db, n.tenantId) : null;
        const deadline = computeDeadlineEngine(service.dateServed, n.noticeType, n.jurisdiction, {
          holidays: customHolidays(db),
          serviceMethod: service.method ?? undefined,
          rentIncrease:
            n.noticeType === "rent_increase"
              ? {
                  newRentCents: n.rentIncreaseNewAmountCents,
                  currentRentCents: tenant?.monthlyRentCents ?? null,
                }
              : undefined,
        });
        next = noticesRepo.update(db, id, { deadlineDate: deadline.expirationDate });
        next = statusChange(
          db,
          next,
          service.method === "post_and_mail" && service.mailedDate ? "mailed" : "served",
          fromFieldSync ? "Service recorded from field sync" : "Service recorded",
        );
        logTenantHistoryCloud(db, {
          tenantId: n.tenantId,
          kind: "notice_served",
          subject: `${NOTICE_TYPE_LABELS[n.noticeType]} served`,
          bodyText: `Served ${service.dateServed} by ${service.servedBy || "unknown"} (${(
            service.method ?? "unknown"
          ).replace(/_/g, " ")}).`,
          // Field-served notices already dispatched a webhook event from the
          // relay when the mobile user recorded service.
          suppressEvent: fromFieldSync,
        });
      }
      // A locked final packet generated before service still shows blank
      // fill-in lines on the Proof of Service. Regenerate it so the proof
      // (and the packet) carry the recorded details. Best-effort: recording
      // service must never fail because PDF regeneration did.
      if (documentsRepo.listByNotice(db, id).some((d) => d.packetKind === "final")) {
        try {
          await services.generateDocuments({ noticeId: id, packetKind: "final" });
        } catch (err) {
          console.warn("Could not refresh the final packet after recording service", err);
        }
      }
      return next;
    },

    // --- documents ---
    async generateDocuments(input: GenerateDocumentsInput): Promise<NoticeDocument[]> {
      requirePermission("notice.generate");
      const db = await getDb();
      const notice = noticesRepo.get(db, input.noticeId);
      if (!notice) throw new Error("Notice not found");
      const company = requireCompany(db);
      const tenant = tenantsRepo.get(db, notice.tenantId);
      const property = propertiesRepo.get(db, notice.propertyId);
      const template = notice.templateId ? templatesRepo.get(db, notice.templateId) : null;
      const transactions = notice.ledgerId
        ? ledgersRepo.listTransactions(db, notice.ledgerId)
        : [];
      const calculation = notice.ledgerId
        ? calculationsRepo.get(db, notice.ledgerId) ??
          calculateRentOnly(notice.ledgerId, transactions)
        : null;
      const auditEntries = auditRepo.list(db, { entityType: "notice", entityId: notice.id });
      const fieldAssignments = fieldAssignmentsRepo.list(db, notice.id);
      const ctx: DocumentContext = {
        notice,
        tenant,
        property,
        calculation,
        companyProfile: company,
        template,
        auditEntries,
        serviceInfo: notice.service,
        fieldAssignments,
      };
      const isDraft = input.packetKind === "draft";
      const opts = isDraft ? { watermark: true } : undefined;

      for (const ack of input.acknowledgedWarnings ?? []) {
        logAudit(db, "warning_acknowledged", "notice", notice.id, `Acknowledged warning ${ack.code}`, {
          reason: ack.reason,
        });
      }

      const hasFieldEvidence = fieldAssignments.some((a) => a.evidence.length > 0);
      const hasPrereqs =
        (getRulePack(notice.jurisdiction)?.nonpayment.prerequisites.length ?? 0) > 0 &&
        notice.noticeType === "pay_or_quit_3day";
      const kinds = packetContents(input.packetKind).filter(
        (k) =>
          (k !== "lahd_letter" || notice.includeLahdLetter) &&
          (k !== "service_evidence" || hasFieldEvidence) &&
          (k !== "state_prereq" || hasPrereqs),
      );
      const generated: KindedDocument[] = [];
      for (const kind of kinds) {
        generated.push({ kind, doc: await generateDocument(kind, ctx, opts) });
      }
      const packet = await assemblePacket(input.packetKind, generated);

      // Revoke and evict blob URLs for the documents being replaced so
      // regenerating a packet does not leak object URLs for the session.
      for (const existing of documentsRepo.listByNotice(db, notice.id)) {
        if (existing.packetKind !== input.packetKind) continue;
        const staleUrl = blobUrlCache.get(existing.id);
        if (staleUrl) {
          URL.revokeObjectURL(staleUrl);
          blobUrlCache.delete(existing.id);
        }
      }
      documentsRepo.removeByNoticeAndPacket(db, notice.id, input.packetKind);
      const t = nowIso();
      const out: NoticeDocument[] = [];
      const saveDoc = (kind: NoticeDocument["kind"], doc: GeneratedDocument) => {
        const record: NoticeDocument = {
          id: uid("doc"),
          noticeId: notice.id,
          kind,
          packetKind: input.packetKind,
          fileName: doc.filename,
          watermarked: isDraft,
          locked: !isDraft,
          pageCount: doc.pageCount,
          sizeBytes: doc.bytes.length,
          generatedAt: t,
          generatedBy: session.user?.id ?? null,
          mimeType: "application/pdf",
          blobUrl: "",
        };
        documentsRepo.create(db, record, doc.bytes);
        const url = URL.createObjectURL(doc.blob);
        blobUrlCache.set(record.id, url);
        out.push({ ...record, blobUrl: url });
      };
      for (const g of generated) saveDoc(g.kind, g.doc);
      saveDoc("packet", packet);
      logAudit(
        db,
        "pdf_exported",
        "notice",
        notice.id,
        `Generated ${input.packetKind.replace(/_/g, " ")} (${out.length} document(s))`,
      );
      return out;
    },
    async listDocuments(noticeId: Id): Promise<NoticeDocument[]> {
      const db = await getDb();
      return documentsRepo.listByNotice(db, noticeId).map((d) => hydrateDocument(db, d));
    },

    // --- attorney secure links ---
    async saveAttorneyReferralLink(entry): Promise<void> {
      const db = await getDb();
      attorneyReferralLinksRepo.save(db, { ...entry, createdAt: nowIso() });
    },
    async getAttorneyReferralLinks(noticeId: Id): Promise<Record<string, string>> {
      const db = await getDb();
      return attorneyReferralLinksRepo.listByNotice(db, noticeId);
    },
    // Imports attorney activity pulled from the sync relay: stamps court
    // hearing details onto the notice and stores attorney uploads as local
    // documents. No permission gate — this mirrors server state that the
    // attorney (not the signed-in user) authored, and it runs automatically
    // when the referral panel refreshes.
    async applyAttorneyActivity(input): Promise<{ courtDateChanged: boolean; importedUploads: number }> {
      const db = await getDb();
      const notice = noticesRepo.get(db, input.noticeId);
      if (!notice) throw new Error("Notice not found");

      let courtDateChanged = false;
      if (
        input.courtDate &&
        (notice.courtDate !== input.courtDate ||
          notice.courtCaseNumber !== input.courtCaseNumber ||
          notice.courtNotes !== input.courtNotes)
      ) {
        noticesRepo.update(db, notice.id, {
          courtDate: input.courtDate,
          courtCaseNumber: input.courtCaseNumber,
          courtNotes: input.courtNotes,
        });
        logAudit(
          db,
          "attorney_court_date_recorded",
          "notice",
          notice.id,
          `Attorney recorded court date ${input.courtDate}${input.courtCaseNumber ? ` (case ${input.courtCaseNumber})` : ""}`,
          { previousValue: notice.courtDate, newValue: input.courtDate },
        );
        courtDateChanged = true;
      }

      let importedUploads = 0;
      const t = nowIso();
      for (const up of input.uploads) {
        // The server upload id doubles as the local document id, so re-runs
        // of the sync never duplicate documents.
        if (documentsRepo.get(db, up.id)) continue;
        // One corrupt payload must not block the rest of the batch: a
        // failed import is skipped (and retried on the next refresh)
        // while the remaining uploads still land.
        try {
          const bytes = base64ToBytes(up.dataBase64);
          documentsRepo.create(
            db,
            {
              id: up.id,
              noticeId: notice.id,
              kind: "attorney_upload",
              packetKind: null,
              fileName: up.fileName,
              watermarked: false,
              locked: true,
              pageCount: 1,
              sizeBytes: bytes.length,
              generatedAt: up.createdAt || t,
              generatedBy: null,
              mimeType: up.mimeType || "application/pdf",
              blobUrl: "",
            },
            bytes,
          );
        } catch (err) {
          console.warn(`Skipping attorney upload "${up.fileName}" (${up.id}): import failed`, err);
          continue;
        }
        logAudit(
          db,
          "attorney_upload_imported",
          "document",
          up.id,
          `Imported attorney upload "${up.fileName}"`,
        );
        importedUploads++;
      }
      return { courtDateChanged, importedUploads };
    },

    // --- templates ---
    async listTemplates(filters): Promise<NoticeTemplate[]> {
      const db = await getDb();
      return templatesRepo.list(db, filters);
    },
    async getTemplate(id: Id): Promise<NoticeTemplate | null> {
      const db = await getDb();
      return templatesRepo.get(db, id);
    },
    async createTemplate(input): Promise<NoticeTemplate> {
      requirePermission("template.manage");
      const db = await getDb();
      const t = nowIso();
      const template: NoticeTemplate = {
        id: uid("tpl"),
        name: input.name,
        noticeType: input.noticeType,
        jurisdiction: input.jurisdiction,
        locality: input.locality ?? null,
        active: true,
        attorneyReviewed: false,
        reviewedBy: "",
        reviewDate: null,
        currentVersion: 1,
        versions: [
          {
            version: 1,
            body: input.body,
            changedBy: session.user?.id ?? null,
            changedAt: t,
            changeNote: "Created",
          },
        ],
        mergeFields: extractMergeFields(input.body),
        builtIn: false,
        createdAt: t,
        updatedAt: t,
      };
      templatesRepo.create(db, template);
      logAudit(db, "template_created", "template", template.id, `Created template "${template.name}"`);
      return template;
    },
    async updateTemplate(id, patch): Promise<NoticeTemplate> {
      requirePermission("template.manage");
      const db = await getDb();
      const current = templatesRepo.get(db, id);
      if (!current) throw new Error("Template not found");
      const p: Partial<Omit<NoticeTemplate, "id" | "createdAt">> = {};
      if (patch.name !== undefined) p.name = patch.name;
      if (patch.active !== undefined) p.active = patch.active;
      if (patch.attorneyReviewed !== undefined) p.attorneyReviewed = patch.attorneyReviewed;
      if (patch.reviewedBy !== undefined) p.reviewedBy = patch.reviewedBy;
      if (patch.reviewDate !== undefined) p.reviewDate = patch.reviewDate;
      if (patch.body !== undefined) {
        const version = current.currentVersion + 1;
        p.versions = [
          ...current.versions,
          {
            version,
            body: patch.body,
            changedBy: session.user?.id ?? null,
            changedAt: nowIso(),
            changeNote: patch.changeNote ?? "",
          },
        ];
        p.currentVersion = version;
        p.mergeFields = extractMergeFields(patch.body);
      }
      const next = templatesRepo.update(db, id, p);
      logAudit(db, "template_updated", "template", id, `Updated template "${next.name}"`, {
        reason: patch.changeNote ?? null,
      });
      return next;
    },

    // --- holidays & deadlines ---
    async listHolidays(year?: number): Promise<Holiday[]> {
      const db = await getDb();
      return holidaysRepo.list(db, year);
    },
    async addHoliday(input): Promise<Holiday> {
      requirePermission("settings.manage");
      const db = await getDb();
      const holiday: Holiday = { ...input, id: uid("holiday"), builtIn: false };
      holidaysRepo.create(db, holiday);
      logAudit(db, "holiday_changed", "holiday", holiday.id, `Added holiday ${holiday.name} (${holiday.date})`);
      return holiday;
    },
    async deleteHoliday(id: Id): Promise<void> {
      requirePermission("settings.manage");
      const db = await getDb();
      const holiday = holidaysRepo.get(db, id);
      if (holiday?.builtIn) throw new Error("Built-in court holidays cannot be removed");
      holidaysRepo.remove(db, id);
      logAudit(db, "holiday_changed", "holiday", id, `Removed holiday ${holiday?.name ?? id}`);
    },
    async computeDeadline(serviceDate, noticeType, jurisdiction, context): Promise<DeadlineResult> {
      const db = await getDb();
      return computeDeadlineEngine(serviceDate, noticeType, jurisdiction, {
        holidays: customHolidays(db),
        rentIncrease: context?.rentIncrease,
      });
    },

    // --- audit ---
    async listAudit(filters): Promise<AuditEntry[]> {
      const db = await getDb();
      return auditRepo.list(db, filters);
    },
    async recordCommsAudit(action, entityId, summary): Promise<void> {
      const db = await getDb();
      const entityType = action === "settings_changed" ? "settings" : "chat_channel";
      logAudit(db, action, entityType, entityId, summary);
    },

    // --- attachments ---
    async listAttachments(entityType, entityId): Promise<Attachment[]> {
      const db = await getDb();
      return attachmentsRepo.list(db, entityType, entityId);
    },
    async addAttachment(input): Promise<Attachment> {
      requirePermission("attachment.manage");
      const db = await getDb();
      let sizeBytes = 0;
      try {
        sizeBytes = dataUrlToBytes(input.dataUrl).bytes.length;
      } catch {
        sizeBytes = Math.floor((input.dataUrl.length * 3) / 4);
      }
      const attachment: Attachment = {
        id: uid("att"),
        entityType: input.entityType,
        entityId: input.entityId,
        kind: input.kind,
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes,
        dataUrl: input.dataUrl,
        uploadedBy: session.user?.id ?? null,
        uploadedAt: nowIso(),
        note: input.note ?? "",
      };
      attachmentsRepo.create(db, attachment);
      logAudit(db, "attachment_added", input.entityType, input.entityId, `Attached ${input.fileName}`);
      return attachment;
    },
    async deleteAttachment(id: Id): Promise<void> {
      requirePermission("attachment.manage");
      const db = await getDb();
      const att = attachmentsRepo.get(db, id);
      attachmentsRepo.remove(db, id);
      logAudit(
        db,
        "attachment_deleted",
        att?.entityType ?? "attachment",
        att?.entityId ?? id,
        `Deleted attachment ${att?.fileName ?? id}`,
      );
    },

    // --- field assignments (mobile companion) ---
    async listFieldAssignments(noticeId?: Id): Promise<FieldAssignment[]> {
      const db = await getDb();
      return fieldAssignmentsRepo.list(db, noticeId);
    },
    async createFieldAssignment(input): Promise<FieldAssignment> {
      requirePermission("field.manage");
      const db = await getDb();
      const t = nowIso();
      const assignment: FieldAssignment = {
        id: uid("fa"),
        noticeId: input.noticeId,
        assigneeName: input.assigneeName,
        instructions: input.instructions ?? "",
        status: "assigned",
        serviceMethod: null,
        completedAt: null,
        evidence: [],
        createdAt: t,
        updatedAt: t,
      };
      fieldAssignmentsRepo.create(db, assignment);
      return assignment;
    },
    async updateFieldAssignment(id, patch): Promise<FieldAssignment> {
      requirePermission("field.manage");
      const db = await getDb();
      return fieldAssignmentsRepo.update(db, id, patch);
    },
    async addFieldEvidence(assignmentId, evidence): Promise<FieldAssignment> {
      requirePermission("field.manage");
      const db = await getDb();
      // Downscale/recompress at ingest so oversized phone photos never bloat
      // the local database or the generated notice packet.
      const photoDataUrl = await downscalePhotoDataUrl(evidence.photoDataUrl);
      const full: FieldEvidence = { ...evidence, photoDataUrl, id: uid("ev") };
      return fieldAssignmentsRepo.addEvidence(db, assignmentId, full);
    },

    // --- maintenance / work orders ---
    async listWorkOrders(filters): Promise<WorkOrder[]> {
      const db = await getDb();
      return workOrdersRepo.list(db, filters);
    },
    async getWorkOrder(id: Id): Promise<WorkOrder | null> {
      const db = await getDb();
      return workOrdersRepo.get(db, id);
    },
    async createWorkOrder(input): Promise<WorkOrder> {
      requirePermission("field.manage");
      const db = await getDb();
      if (!input.title.trim()) throw new Error("A work order title is required.");
      const property = propertiesRepo.get(db, input.propertyId);
      if (!property) throw new Error("Property not found");
      const t = nowIso();
      const id = uid("wo");
      const initialStatus: WorkOrderStatus = input.assigneeName?.trim() ? "assigned" : "new";
      const workOrder: WorkOrder = {
        id,
        propertyId: input.propertyId,
        tenantId: input.tenantId ?? null,
        unit: input.unit ?? "",
        title: input.title.trim(),
        description: input.description ?? "",
        category: input.category,
        priority: input.priority,
        status: initialStatus,
        dueDate: input.dueDate ?? null,
        assigneeName: input.assigneeName?.trim() ?? "",
        vendorName: input.vendorName ?? "",
        vendorContact: input.vendorContact ?? "",
        costEstimateCents: input.costEstimateCents ?? null,
        costActualCents: input.costActualCents ?? null,
        internalNotes: input.internalNotes ?? "",
        completedAt: null,
        statusHistory: [
          {
            id: uid("wosc"),
            workOrderId: id,
            fromStatus: null,
            toStatus: initialStatus,
            changedBy: session.user?.id ?? null,
            changedByName: session.user?.name ?? "",
            note: "Work order created",
            changedAt: t,
          },
        ],
        createdAt: t,
        updatedAt: t,
      };
      workOrdersRepo.create(db, workOrder);
      logAudit(
        db,
        "work_order_created",
        "work_order",
        workOrder.id,
        `Created work order "${workOrder.title}" for ${property.nickname}`,
      );
      if (workOrder.tenantId) {
        logTenantHistoryCloud(db, {
          tenantId: workOrder.tenantId,
          kind: "work_order",
          subject: `Work order opened: ${workOrder.title}`,
          bodyText:
            workOrder.description ||
            `Category: ${workOrder.category.replace(/_/g, " ")}, priority ${workOrder.priority}.`,
        });
      }
      return workOrder;
    },
    async updateWorkOrder(id, patch): Promise<WorkOrder> {
      requirePermission("field.manage");
      const db = await getDb();
      const current = workOrdersRepo.get(db, id);
      if (!current) throw new Error("Work order not found");
      // If an assignee is set while the work order is still new, move it to
      // "assigned" (with a timeline entry) so the board reflects reality.
      const next = workOrdersRepo.update(db, id, patch);
      if (
        current.status === "new" &&
        !current.assigneeName &&
        typeof patch.assigneeName === "string" &&
        patch.assigneeName.trim()
      ) {
        const t = nowIso();
        workOrdersRepo.addStatusChange(db, {
          id: uid("wosc"),
          workOrderId: id,
          fromStatus: "new",
          toStatus: "assigned",
          changedBy: session.user?.id ?? null,
          changedByName: session.user?.name ?? "",
          note: `Assigned to ${patch.assigneeName.trim()}`,
          changedAt: t,
        });
        workOrdersRepo.update(db, id, { status: "assigned", updatedAt: t });
      }
      logAudit(db, "work_order_updated", "work_order", id, `Updated work order "${next.title}"`);
      return workOrdersRepo.get(db, id) ?? next;
    },
    async changeWorkOrderStatus(id, toStatus, note): Promise<WorkOrder> {
      requirePermission("field.manage");
      const db = await getDb();
      const current = workOrdersRepo.get(db, id);
      if (!current) throw new Error("Work order not found");
      if (current.status === toStatus) return current;
      const t = nowIso();
      workOrdersRepo.addStatusChange(db, {
        id: uid("wosc"),
        workOrderId: id,
        fromStatus: current.status,
        toStatus,
        changedBy: session.user?.id ?? null,
        changedByName: session.user?.name ?? "",
        note: note ?? "",
        changedAt: t,
      });
      const next = workOrdersRepo.update(db, id, {
        status: toStatus,
        completedAt: toStatus === "completed" ? t : current.completedAt,
        updatedAt: t,
      });
      logAudit(
        db,
        "work_order_status_changed",
        "work_order",
        id,
        `Work order "${current.title}": ${current.status.replace(/_/g, " ")} → ${toStatus.replace(/_/g, " ")}`,
        { previousValue: current.status, newValue: toStatus, reason: note },
      );
      if (toStatus === "completed" && current.tenantId) {
        logTenantHistoryCloud(db, {
          tenantId: current.tenantId,
          kind: "work_order",
          subject: `Work order completed: ${current.title}`,
          bodyText: note?.trim() || `"${current.title}" was marked completed.`,
        });
      }
      return next;
    },
    async deleteWorkOrder(id, reason): Promise<void> {
      requirePermission("field.manage");
      const db = await getDb();
      const current = workOrdersRepo.get(db, id);
      workOrdersRepo.remove(db, id);
      logAudit(
        db,
        "work_order_deleted",
        "work_order",
        id,
        `Deleted work order "${current?.title ?? id}"`,
        { reason },
      );
    },

    // --- certified mail tracking ---
    async listMailTracking(noticeId?: Id): Promise<MailTracking[]> {
      const db = await getDb();
      return mailTrackingRepo.list(db, noticeId);
    },
    async createMailTracking(input): Promise<MailTracking> {
      requirePermission("mail.manage");
      const db = await getDb();
      const t = nowIso();
      const mailed = input.mailedDate ?? null;
      const tracking: MailTracking = {
        id: uid("mail"),
        noticeId: input.noticeId,
        carrier: input.carrier,
        trackingNumber: input.trackingNumber,
        status: mailed ? "mailed" : "preparing",
        mailedDate: mailed,
        events: mailed ? [{ date: mailed, status: "mailed", note: "Marked as mailed" }] : [],
        createdAt: t,
        updatedAt: t,
      };
      mailTrackingRepo.create(db, tracking);
      return tracking;
    },
    async updateMailTracking(id, patch): Promise<MailTracking> {
      requirePermission("mail.manage");
      const db = await getDb();
      const current = mailTrackingRepo.get(db, id);
      if (!current) throw new Error("Tracking record not found");
      const p = { ...patch };
      if (p.status && p.status !== current.status && !p.events) {
        const event: MailTrackingEvent = { date: todayIso(), status: p.status, note: "" };
        p.events = [...current.events, event];
      }
      return mailTrackingRepo.update(db, id, { ...p, updatedAt: nowIso() });
    },

    // --- dashboard, reports, export ---
    async getDashboard(): Promise<DashboardData> {
      const db = await getDb();
      const notices = noticesRepo.list(db);
      const counts = Object.fromEntries(
        (Object.keys(NOTICE_STATUS_LABELS) as NoticeStatus[]).map((s) => [s, 0]),
      ) as Record<NoticeStatus, number>;
      for (const n of notices) counts[n.status] += 1;

      const soon = addDays(todayIso(), 3);
      const complianceWarnings: DashboardData["complianceWarnings"] = [];
      for (const n of notices) {
        if (!["draft", "needs_review", "reviewed"].includes(n.status)) continue;
        const v = runValidation(db, n);
        if (v.blockers > 0)
          complianceWarnings.push({
            noticeId: n.id,
            tenantNames: n.tenantNames,
            message: `${v.blockers} blocking issue(s): ${v.issues.find((i) => i.level === "blocker")?.message ?? ""}`,
          });
      }
      return {
        countsByStatus: counts,
        expiringSoon: notices.filter(
          (n) => n.deadlineDate && n.deadlineDate <= soon && ["served", "mailed"].includes(n.status),
        ),
        needsReview: notices.filter((n) => n.status === "needs_review"),
        recentImports: ledgersRepo.list(db).slice(0, 5),
        recentActivity: auditRepo.list(db, { limit: 12 }),
        complianceWarnings,
        totals: {
          activeNotices: notices.filter(
            (n) => !["cancelled", "revised", "paid", "expired"].includes(n.status),
          ).length,
          totalDemandedCents: notices
            .filter((n) => !["cancelled", "revised"].includes(n.status))
            .reduce((s, n) => s + n.totalAmountCents, 0),
          paidAfterNoticeCents: notices
            .filter((n) => n.status === "paid")
            .reduce((s, n) => s + n.totalAmountCents, 0),
          tenants: tenantsRepo.list(db).length,
          properties: propertiesRepo.list(db).length,
        },
      };
    },
    async getReport(kind: ReportKind): Promise<ReportResult> {
      const db = await getDb();
      const notices = noticesRepo.list(db);
      const active = notices.filter((n) => !["cancelled", "revised"].includes(n.status));
      const rows: ReportResult["rows"] = [];
      const titleMap: Record<ReportKind, string> = {
        notices_by_month: "Notices Created by Month",
        notices_by_property: "Notices by Property",
        notices_by_status: "Notices by Status",
        amounts_noticed: "Amounts Noticed by Month",
        amounts_paid_after_notice: "Amounts Paid After Notice",
        sent_to_attorney: "Notices Sent to Attorney",
        repeat_delinquencies: "Repeat Tenant Delinquencies",
        excluded_charges: "Excluded Non-Rent Charges",
        staff_activity: "Staff Activity",
        maintenance_summary: "Maintenance Summary",
      };
      const group = <T,>(
        items: T[],
        key: (x: T) => string,
        val: (x: T) => number,
        isMoney: boolean,
      ) => {
        const map = new Map<string, number>();
        for (const item of items) map.set(key(item), (map.get(key(item)) ?? 0) + val(item));
        for (const [label, value] of [...map.entries()].sort()) rows.push({ label, value, isMoney });
      };
      switch (kind) {
        case "notices_by_month":
          group(active, (n) => n.createdAt.slice(0, 7), () => 1, false);
          break;
        case "notices_by_property":
          group(
            active,
            (n) => propertiesRepo.get(db, n.propertyId)?.nickname ?? "Unknown",
            () => 1,
            false,
          );
          break;
        case "notices_by_status":
          group(notices, (n) => n.status, () => 1, false);
          break;
        case "amounts_noticed":
          group(active, (n) => n.createdAt.slice(0, 7), (n) => n.totalAmountCents, true);
          break;
        case "amounts_paid_after_notice":
          group(
            notices.filter((n) => n.status === "paid"),
            (n) => n.createdAt.slice(0, 7),
            (n) => n.totalAmountCents,
            true,
          );
          break;
        case "sent_to_attorney":
          group(
            notices.filter((n) => n.status === "sent_to_attorney" || n.attorneyExportFlag),
            (n) => n.tenantNames.join(", "),
            () => 1,
            false,
          );
          break;
        case "repeat_delinquencies": {
          const byTenant = new Map<string, number>();
          for (const n of active.filter((x) => x.noticeType === "pay_or_quit_3day"))
            byTenant.set(n.tenantNames.join(", "), (byTenant.get(n.tenantNames.join(", ")) ?? 0) + 1);
          for (const [label, value] of [...byTenant.entries()].filter(([, v]) => v > 1))
            rows.push({ label, value, isMoney: false });
          break;
        }
        case "excluded_charges": {
          const byClass = new Map<string, number>();
          for (const ledger of ledgersRepo.list(db)) {
            for (const txn of ledgersRepo.listTransactions(db, ledger.id)) {
              const cls = txn.userOverrideClass ?? txn.systemClass;
              if (cls !== "rent" && cls !== "payment" && cls !== "credit" && txn.amountCents > 0)
                byClass.set(cls, (byClass.get(cls) ?? 0) + txn.amountCents);
            }
          }
          for (const [label, value] of [...byClass.entries()].sort())
            rows.push({ label: label.replace(/_/g, " "), value, isMoney: true });
          break;
        }
        case "staff_activity":
          group(auditRepo.list(db), (a) => a.userName, () => 1, false);
          break;
        case "maintenance_summary": {
          const workOrders = workOrdersRepo.list(db);
          const open = workOrders.filter(
            (w) => !["completed", "cancelled"].includes(w.status),
          );
          const completed = workOrders.filter((w) => w.status === "completed");
          rows.push({ label: "Open work orders", value: open.length, isMoney: false });
          rows.push({
            label: "Completed work orders",
            value: completed.length,
            isMoney: false,
          });

          // Average time to complete (creation → completion), in days.
          const durationsDays = completed
            .map((w) => {
              const done = w.completedAt ?? w.updatedAt;
              return (new Date(done).getTime() - new Date(w.createdAt).getTime()) / 86_400_000;
            })
            .filter((d) => Number.isFinite(d) && d >= 0);
          if (durationsDays.length > 0) {
            const avg =
              durationsDays.reduce((s, d) => s + d, 0) / durationsDays.length;
            rows.push({
              label: "Average days to complete",
              value: Math.round(avg * 10) / 10,
              isMoney: false,
            });
          }

          // Cost totals by property (actual cost when known, otherwise estimate).
          const costByProperty = new Map<string, number>();
          for (const w of workOrders) {
            const cost = w.costActualCents ?? w.costEstimateCents ?? 0;
            if (cost > 0)
              costByProperty.set(w.propertyId, (costByProperty.get(w.propertyId) ?? 0) + cost);
          }
          for (const [propertyId, value] of [...costByProperty.entries()].sort((a, b) => b[1] - a[1]))
            rows.push({
              label: `Cost: ${propertiesRepo.get(db, propertyId)?.nickname ?? "Unknown property"}`,
              value,
              isMoney: true,
            });
          break;
        }
      }
      return { kind, title: titleMap[kind], rows, generatedAt: nowIso() };
    },
    async exportNoticesCsv(filters?: NoticeFilters): Promise<Blob> {
      const db = await getDb();
      const list = applyNoticeFilters(noticesRepo.list(db), filters);
      const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
      const lines = [
        "Tenant,Property,Unit,Type,Status,Months,Total,Created,Served,Deadline",
        ...list.map((n) =>
          [
            esc(n.tenantNames.join("; ")),
            esc(n.propertyAddress),
            esc(n.unit),
            esc(NOTICE_TYPE_LABELS[n.noticeType]),
            esc(n.status),
            esc(n.months.map((m) => m.month).join("; ")),
            (n.totalAmountCents / 100).toFixed(2),
            n.createdAt.slice(0, 10),
            n.service.dateServed ?? "",
            n.deadlineDate ?? "",
          ].join(","),
        ),
      ];
      return new Blob([lines.join("\n")], { type: "text/csv" });
    },

    // --- state rules (50-state reference) ---
    async listStateRules() {
      await getDb();
      return [...STATE_RULES];
    },

    // --- state rule attorney reviews ---
    async listStateRuleReviews() {
      const db = await getDb();
      return stateRuleReviewsRepo.list(db);
    },
    async setStateRuleReview(input) {
      requirePermission("settings.manage");
      const db = await getDb();
      const state = input.state.trim().toUpperCase();
      if (!getRulePack(state)) throw new Error(`Unknown jurisdiction "${input.state}".`);
      const reviewerName = input.reviewerName.trim();
      if (!reviewerName) throw new Error("Reviewer name is required.");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.reviewedAt))
        throw new Error("Review date must be a valid date (YYYY-MM-DD).");
      const existing = stateRuleReviewsRepo.get(db, state);
      const now = nowIso();
      const review = stateRuleReviewsRepo.upsert(db, {
        state,
        reviewerName,
        reviewedAt: input.reviewedAt,
        notes: (input.notes ?? "").trim(),
        recordedBy: session.user?.name ?? null,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
      logAudit(
        db,
        "state_rule_review_changed",
        "state_rule_review",
        state,
        `${existing ? "Updated" : "Recorded"} attorney approval for ${state}: reviewed by ${reviewerName} on ${input.reviewedAt}`,
        {
          previousValue: existing ? JSON.stringify(existing) : null,
          newValue: JSON.stringify(review),
        },
      );
      return review;
    },
    async clearStateRuleReview(state) {
      requirePermission("settings.manage");
      const db = await getDb();
      const code = state.trim().toUpperCase();
      const existing = stateRuleReviewsRepo.get(db, code);
      if (!existing) return;
      stateRuleReviewsRepo.remove(db, code);
      logAudit(
        db,
        "state_rule_review_changed",
        "state_rule_review",
        code,
        `Removed attorney approval for ${code} (was: ${existing.reviewerName}, ${existing.reviewedAt})`,
        { previousValue: JSON.stringify(existing) },
      );
    },

    // --- backup / restore ---
    async exportBackup(): Promise<Blob> {
      requirePermission("settings.manage");
      const db = await getDb();
      logAudit(db, "backup_exported", "settings", null, "Exported local backup");
      const { blob } = await exportDbBackup(db);
      return blob;
    },
    async importBackup(file: File): Promise<BackupMeta> {
      requirePermission("settings.manage");
      const db = await getDb();
      const meta = await importDbBackup(db, file);
      for (const url of blobUrlCache.values()) URL.revokeObjectURL(url);
      blobUrlCache.clear();
      logAudit(db, "backup_restored", "settings", null, `Restored backup from ${meta.exportedAt}`);
      return meta;
    },

    // --- startup recovery ---
    async retryDatabaseInit(): Promise<void> {
      // Drop the failed (stuck) promise and try the full open+migrate again.
      // If the previous attempt actually succeeded, keep it — nothing to do.
      if (dbPromise) {
        try {
          await dbPromise;
          return;
        } catch {
          dbPromise = null;
        }
      }
      await getDb();
    },
    async resetLocalData(): Promise<void> {
      // Destructive last-resort recovery: erase the locally saved database so
      // the app boots fresh. Only offered behind an explicit confirmation.
      if (dbPromise) {
        try {
          const db = await dbPromise;
          db.close();
        } catch {
          // The database never opened — nothing to close.
        }
        dbPromise = null;
      }
      session.user = null;
      session.locked = false;
      await clearPersistedDatabase();
    },
  } satisfies AppServices;

  return services;
}

registerServicesFactory(createServices);
