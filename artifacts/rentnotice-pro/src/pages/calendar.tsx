import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronLeft, ChevronRight, Landmark, FileText, AlertTriangle, CalendarDays, Gavel } from "lucide-react";
import { useHolidays, useNotices, useSettings, useWorkOrders } from "@/lib/api/hooks";
import type { Holiday, Notice, WorkOrder } from "@/lib/types";
import { WORK_ORDER_PRIORITY_LABELS } from "@/lib/types";
import { computeDeadline } from "@/lib/engine/deadlines";
import { listCaHolidays } from "@/lib/engine/holidays";
import {
  customHolidayApplies,
  hasStateHolidayCalendar,
  listStateHolidays,
  stateHolidayCoverageWarning,
} from "@/lib/engine/stateHolidays";

// ------------------------------ date helpers --------------------------------

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function isoOf(year: number, month1: number, day: number): string {
  return `${year}-${pad2(month1)}-${pad2(day)}`;
}

function todayIso(): string {
  const d = new Date();
  return isoOf(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatIso(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTH_NAMES[m - 1].slice(0, 3)} ${d}, ${y}`;
}

// ------------------------------ data shaping --------------------------------

interface ClosureEntry {
  date: string;
  name: string;
  states: string[];
  builtIn: boolean;
}

/** Built-in holidays for one state and year (CA has its own dataset). */
function builtInHolidaysFor(state: string, year: number): Holiday[] {
  if (state === "CA") return listCaHolidays(year);
  return listStateHolidays(state, year);
}

/** Merge built-in + applicable custom holidays for the states into per-date entries. */
function buildClosures(states: string[], years: number[], customHolidays: Holiday[]): Map<string, ClosureEntry[]> {
  const byKey = new Map<string, ClosureEntry>();
  const add = (h: Holiday, state: string, builtIn: boolean) => {
    const key = `${h.date}|${h.name}|${builtIn ? "b" : "c"}`;
    const existing = byKey.get(key);
    if (existing) {
      if (!existing.states.includes(state)) existing.states.push(state);
    } else {
      byKey.set(key, { date: h.date, name: h.name, states: [state], builtIn });
    }
  };
  for (const state of states) {
    for (const year of years) {
      for (const h of builtInHolidaysFor(state, year)) add(h, state, true);
    }
    for (const h of customHolidays) {
      if (customHolidayApplies(state, h)) add(h, state, false);
    }
  }
  const byDate = new Map<string, ClosureEntry[]>();
  for (const entry of byKey.values()) {
    entry.states.sort();
    const list = byDate.get(entry.date) ?? [];
    list.push(entry);
    byDate.set(entry.date, list);
  }
  return byDate;
}

interface DeadlineEntry {
  notice: Notice;
  date: string; // stored deadlineDate
  /** Holidays skipped/rolled over while counting this notice's deadline. */
  shiftedBy: { date: string; name: string }[];
  /** Weekend days skipped/rolled over. */
  weekendSkips: number;
}

function noticeTypeLabel(t: string): string {
  return t.replace(/_/g, " ").toUpperCase();
}

/** Recompute the deadline breakdown to surface which closures shifted it. */
function buildDeadlineEntries(notices: Notice[], customHolidays: Holiday[]): DeadlineEntry[] {
  const entries: DeadlineEntry[] = [];
  for (const notice of notices) {
    if (!notice.deadlineDate) continue;
    let shiftedBy: DeadlineEntry["shiftedBy"] = [];
    let weekendSkips = 0;
    if (notice.service.dateServed) {
      try {
        const r = computeDeadline(notice.service.dateServed, notice.noticeType, notice.jurisdiction, {
          holidays: customHolidays,
          serviceMethod: notice.service.method,
          rentIncrease: {
            newRentCents: notice.rentIncreaseNewAmountCents,
            currentRentCents: null,
          },
        });
        // Only trust the breakdown when it reproduces the stored deadline.
        if (r.expirationDate === notice.deadlineDate) {
          shiftedBy = r.excludedDates
            .filter((e) => e.reason === "holiday")
            .map((e) => ({ date: e.date, name: e.name ?? "Court holiday" }));
          weekendSkips = r.excludedDates.filter((e) => e.reason === "weekend").length;
        }
      } catch {
        // Engine errors (unknown type/state) — show the stored date without a breakdown.
      }
    }
    entries.push({ notice, date: notice.deadlineDate, shiftedBy, weekendSkips });
  }
  entries.sort((a, b) => a.date.localeCompare(b.date));
  return entries;
}

// --------------------------------- page -------------------------------------

export default function CalendarPage() {
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth() + 1); // 1-12
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const { data: notices, isLoading: noticesLoading } = useNotices();
  const { data: holidays, isLoading: holidaysLoading } = useHolidays();
  const { data: settings } = useSettings();
  const { data: workOrders } = useWorkOrders();

  // Open work orders with a due date, keyed by day.
  const workOrdersByDate = useMemo(() => {
    const m = new Map<string, WorkOrder[]>();
    for (const w of workOrders ?? []) {
      if (!w.dueDate || ["completed", "cancelled"].includes(w.status)) continue;
      const list = m.get(w.dueDate) ?? [];
      list.push(w);
      m.set(w.dueDate, list);
    }
    return m;
  }, [workOrders]);

  // Court hearing dates reported by attorneys, keyed by day.
  const courtDatesByDate = useMemo(() => {
    const m = new Map<string, Notice[]>();
    for (const n of notices ?? []) {
      if (!n.courtDate) continue;
      const list = m.get(n.courtDate) ?? [];
      list.push(n);
      m.set(n.courtDate, list);
    }
    return m;
  }, [notices]);

  const customHolidays = useMemo(
    () => (holidays ?? []).filter((h) => !h.builtIn && h.courtHoliday),
    [holidays],
  );

  // States relevant to this workspace: every notice jurisdiction + the default.
  const relevantStates = useMemo(() => {
    const set = new Set<string>();
    for (const n of notices ?? []) set.add(n.jurisdiction.toUpperCase());
    set.add((settings?.defaultJurisdiction ?? "CA").toUpperCase());
    return [...set].sort();
  }, [notices, settings]);

  const closuresByDate = useMemo(
    () => buildClosures(relevantStates, [viewYear - 1, viewYear, viewYear + 1], customHolidays),
    [relevantStates, viewYear, customHolidays],
  );

  const deadlineEntries = useMemo(
    () => buildDeadlineEntries(notices ?? [], customHolidays),
    [notices, customHolidays],
  );

  const deadlinesByDate = useMemo(() => {
    const m = new Map<string, DeadlineEntry[]>();
    for (const e of deadlineEntries) {
      const list = m.get(e.date) ?? [];
      list.push(e);
      m.set(e.date, list);
    }
    return m;
  }, [deadlineEntries]);

  const monthPrefix = `${viewYear}-${pad2(viewMonth)}-`;
  const today = todayIso();

  const monthClosures = useMemo(() => {
    const list: ClosureEntry[] = [];
    for (const [date, entries] of closuresByDate) {
      if (date.startsWith(monthPrefix)) list.push(...entries);
    }
    list.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
    return list;
  }, [closuresByDate, monthPrefix]);

  const monthDeadlines = useMemo(
    () => deadlineEntries.filter((e) => e.date.startsWith(monthPrefix)),
    [deadlineEntries, monthPrefix],
  );

  const upcomingDeadlines = useMemo(
    () => deadlineEntries.filter((e) => e.date >= today).slice(0, 8),
    [deadlineEntries, today],
  );

  const statesWithoutCalendar = relevantStates.filter(
    (s) => s !== "CA" && !hasStateHolidayCalendar(s),
  );

  const coverageWarnings = useMemo(() => {
    const years = [viewYear];
    return relevantStates
      .map((s) => stateHolidayCoverageWarning(s, years))
      .filter((w): w is string => !!w);
  }, [relevantStates, viewYear]);

  // Calendar grid cells for the viewed month.
  const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
  const firstDow = new Date(viewYear, viewMonth - 1, 1).getDay();
  const cells: (string | null)[] = [
    ...Array.from({ length: firstDow }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => isoOf(viewYear, viewMonth, i + 1)),
  ];

  const goMonth = (delta: number) => {
    let m = viewMonth + delta;
    let y = viewYear;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    setViewMonth(m);
    setViewYear(y);
    setSelectedDay(null);
  };

  const isLoading = noticesLoading || holidaysLoading;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-serif font-bold tracking-tight">Deadline Calendar</h1>
        <p className="text-muted-foreground mt-1">
          Notice expiration dates alongside the court closures that shifted them.
          Showing holidays for {relevantStates.join(", ")}.
        </p>
      </div>

      {(coverageWarnings.length > 0 || statesWithoutCalendar.length > 0) && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-4 space-y-1" data-testid="text-coverage-warning">
          {statesWithoutCalendar.length > 0 && (
            <p className="text-sm text-amber-800 dark:text-amber-300 flex gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                No bundled court-holiday calendar exists for {statesWithoutCalendar.join(", ")}.
                Only custom holidays added in Settings are shown for {statesWithoutCalendar.length === 1 ? "that state" : "those states"}.
              </span>
            </p>
          )}
          {coverageWarnings.map((w, i) => (
            <p key={i} className="text-sm text-amber-800 dark:text-amber-300 flex gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{w}</span>
            </p>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="h-96 bg-muted rounded-xl animate-pulse" />
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          {/* ------------------------- month grid ------------------------- */}
          <Card className="lg:col-span-2">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
              <CardTitle className="font-serif text-xl" data-testid="text-month-title">
                {MONTH_NAMES[viewMonth - 1]} {viewYear}
              </CardTitle>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="icon" onClick={() => goMonth(-1)} data-testid="button-prev-month" aria-label="Previous month">
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setViewYear(now.getFullYear()); setViewMonth(now.getMonth() + 1); setSelectedDay(null); }}
                  data-testid="button-today"
                >
                  Today
                </Button>
                <Button variant="outline" size="icon" onClick={() => goMonth(1)} data-testid="button-next-month" aria-label="Next month">
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-7 text-center text-sm font-medium uppercase tracking-wider text-muted-foreground mb-2">
                {DOW_LABELS.map((d) => <div key={d} className="py-1">{d}</div>)}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {cells.map((iso, idx) => {
                  if (!iso) return <div key={`empty-${idx}`} />;
                  const closures = closuresByDate.get(iso) ?? [];
                  const deadlines = deadlinesByDate.get(iso) ?? [];
                  const dueWorkOrders = workOrdersByDate.get(iso) ?? [];
                  const courtHearings = courtDatesByDate.get(iso) ?? [];
                  const isToday = iso === today;
                  const isSelected = selectedDay === iso;
                  return (
                    <Popover
                      key={iso}
                      open={isSelected}
                      onOpenChange={(open) => setSelectedDay(open ? iso : null)}
                    >
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          data-testid={`cell-day-${iso}`}
                          className={`min-h-24 w-full rounded-lg border p-2 text-left cursor-pointer transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                            isToday ? "border-primary bg-primary/5" : "border-border/60"
                          } ${closures.length > 0 ? "bg-amber-50 dark:bg-amber-950/20" : ""} ${
                            isSelected ? "ring-2 ring-ring" : ""
                          }`}
                          aria-label={`Details for ${formatIso(iso)}`}
                        >
                          <div className={`text-sm font-semibold ${isToday ? "text-primary" : ""}`}>
                            {Number(iso.slice(8))}
                          </div>
                          <div className="mt-1 space-y-0.5">
                            {closures.slice(0, 2).map((c, i) => (
                              <div key={i} className="truncate text-xs leading-tight text-amber-800 dark:text-amber-300" data-testid={`text-holiday-${iso}`}>
                                {c.name}
                              </div>
                            ))}
                            {closures.length > 2 && (
                              <div className="text-xs text-amber-700/70">+{closures.length - 2} more</div>
                            )}
                            {deadlines.slice(0, 2).map((d) => (
                              <div
                                key={d.notice.id}
                                className="truncate text-xs leading-tight font-medium text-red-700 dark:text-red-400"
                                data-testid={`link-deadline-${d.notice.id}`}
                              >
                                {d.notice.tenantNames.join(" & ")}
                              </div>
                            ))}
                            {deadlines.length > 2 && (
                              <div className="text-xs text-red-700/70">+{deadlines.length - 2} more</div>
                            )}
                            {courtHearings.slice(0, 2).map((n) => (
                              <div
                                key={`court-${n.id}`}
                                className="truncate text-[10px] leading-tight font-medium text-purple-700 dark:text-purple-400"
                                data-testid={`text-court-hearing-${n.id}`}
                              >
                                ⚖ {n.tenantNames.join(" & ")}
                              </div>
                            ))}
                            {courtHearings.length > 2 && (
                              <div className="text-[10px] text-purple-700/70">+{courtHearings.length - 2} more</div>
                            )}
                            {dueWorkOrders.slice(0, 2).map((w) => (
                              <div
                                key={w.id}
                                className="truncate text-xs leading-tight font-medium text-blue-700 dark:text-blue-400"
                                data-testid={`text-work-order-${w.id}`}
                              >
                                🔧 {w.title}
                              </div>
                            ))}
                            {dueWorkOrders.length > 2 && (
                              <div className="text-xs text-blue-700/70">+{dueWorkOrders.length - 2} more</div>
                            )}
                          </div>
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-80" align="start" data-testid={`popover-day-${iso}`}>
                        <DayDetails iso={iso} closures={closures} deadlines={deadlines} workOrders={dueWorkOrders} courtHearings={courtHearings} />
                      </PopoverContent>
                    </Popover>
                  );
                })}
              </div>
              <div className="flex items-center gap-4 mt-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded bg-amber-100 dark:bg-amber-950/40 border border-amber-300 inline-block" />
                  Court closure
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded border border-red-400 inline-block relative">
                    <span className="absolute inset-0 flex items-center justify-center text-[8px] font-bold text-red-600">•</span>
                  </span>
                  Notice deadline
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded border border-blue-400 inline-block relative">
                    <span className="absolute inset-0 flex items-center justify-center text-[8px] font-bold text-blue-600">•</span>
                  </span>
                  Maintenance due
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded border border-purple-400 inline-block relative">
                    <span className="absolute inset-0 flex items-center justify-center text-[8px] font-bold text-purple-600">•</span>
                  </span>
                  Court hearing
                </span>
              </div>
            </CardContent>
          </Card>

          {/* ----------------------- side lists --------------------------- */}
          <div className="space-y-6">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Landmark className="w-4 h-4 text-amber-600" />
                  Closures in {MONTH_NAMES[viewMonth - 1]}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2" data-testid="list-month-closures">
                {monthClosures.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No court holidays this month.</p>
                ) : (
                  monthClosures.map((c, i) => (
                    <div key={i} className="flex items-start justify-between gap-2 text-sm">
                      <div>
                        <div className="font-medium">{c.name}</div>
                        <div className="text-xs text-muted-foreground">{formatIso(c.date)}</div>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        {c.states.map((s) => (
                          <span key={s} className="text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 bg-muted rounded">
                            {s}
                          </span>
                        ))}
                        {!c.builtIn && (
                          <span className="text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 bg-accent/20 rounded">
                            Custom
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="w-4 h-4 text-red-600" />
                  Deadlines in {MONTH_NAMES[viewMonth - 1]}
                </CardTitle>
              </CardHeader>
              <CardContent data-testid="list-month-deadlines">
                {monthDeadlines.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No notice deadlines this month.</p>
                ) : (
                  <div className="space-y-3">
                    {monthDeadlines.map((e) => <DeadlineRow key={e.notice.id} entry={e} />)}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* ----------------------- upcoming deadlines ----------------------- */}
      {!isLoading && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarDays className="w-4 h-4" />
              Upcoming deadlines
            </CardTitle>
          </CardHeader>
          <CardContent data-testid="list-upcoming-deadlines">
            {upcomingDeadlines.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No upcoming notice deadlines. Deadlines appear here once a notice is served and its
                expiration date is computed.
              </p>
            ) : (
              <div className="divide-y">
                {upcomingDeadlines.map((e) => (
                  <div key={e.notice.id} className="py-3 first:pt-0 last:pb-0">
                    <DeadlineRow entry={e} showAddress />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function DayDetails({
  iso,
  closures,
  deadlines,
  workOrders,
  courtHearings,
}: {
  iso: string;
  closures: ClosureEntry[];
  deadlines: DeadlineEntry[];
  workOrders: WorkOrder[];
  courtHearings: Notice[];
}) {
  return (
    <div className="space-y-3">
      <div className="font-serif font-semibold text-sm">{formatIso(iso)}</div>
      {closures.length === 0 && deadlines.length === 0 && workOrders.length === 0 && courtHearings.length === 0 ? (
        <p className="text-sm text-muted-foreground">No court closures, notice deadlines, court hearings, or maintenance due on this day.</p>
      ) : (
        <>
          {closures.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Landmark className="w-3.5 h-3.5 text-amber-600" />
                Court closures
              </div>
              {closures.map((c, i) => (
                <div key={i} className="flex items-start justify-between gap-2 text-sm" data-testid={`popover-closure-${iso}-${i}`}>
                  <span className="min-w-0">{c.name}</span>
                  <span className="flex gap-1 shrink-0 flex-wrap justify-end">
                    {c.states.map((s) => (
                      <span key={s} className="text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 bg-muted rounded">
                        {s}
                      </span>
                    ))}
                    {!c.builtIn && (
                      <span className="text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 bg-accent/20 rounded">
                        Custom
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
          {deadlines.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-red-600" />
                Notice deadlines
              </div>
              {deadlines.map((d) => (
                <div key={d.notice.id} data-testid={`popover-deadline-${d.notice.id}`}>
                  <Link
                    href={`/notices/${d.notice.id}`}
                    className="font-medium text-sm hover:underline text-red-700 dark:text-red-400"
                  >
                    {d.notice.tenantNames.join(" & ")}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {noticeTypeLabel(d.notice.noticeType)} • {d.notice.jurisdiction.toUpperCase()} •{" "}
                    {d.notice.status.replace(/_/g, " ")}
                  </div>
                </div>
              ))}
            </div>
          )}
          {courtHearings.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Gavel className="w-3.5 h-3.5 text-purple-600" />
                Court hearings
              </div>
              {courtHearings.map((n) => (
                <div key={n.id} data-testid={`popover-court-hearing-${n.id}`}>
                  <Link
                    href={`/notices/${n.id}`}
                    className="font-medium text-sm hover:underline text-purple-700 dark:text-purple-400"
                  >
                    {n.tenantNames.join(" & ")}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {n.courtCaseNumber ? `Case ${n.courtCaseNumber} • ` : ""}
                    {noticeTypeLabel(n.noticeType)} • {n.jurisdiction.toUpperCase()}
                  </div>
                  {n.courtNotes && (
                    <div className="text-xs text-muted-foreground mt-0.5">{n.courtNotes}</div>
                  )}
                </div>
              ))}
            </div>
          )}
          {workOrders.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-blue-600" />
                Maintenance due
              </div>
              {workOrders.map((w) => (
                <div key={w.id} data-testid={`popover-work-order-${w.id}`}>
                  <Link
                    href="/maintenance"
                    className="font-medium text-sm hover:underline text-blue-700 dark:text-blue-400"
                  >
                    {w.title}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {WORK_ORDER_PRIORITY_LABELS[w.priority]} priority • {w.status.replace(/_/g, " ")}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function DeadlineRow({ entry, showAddress = false }: { entry: DeadlineEntry; showAddress?: boolean }) {
  const { notice, date, shiftedBy, weekendSkips } = entry;
  return (
    <div data-testid={`row-deadline-${notice.id}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link href={`/notices/${notice.id}`} className="font-medium text-sm hover:underline">
            {notice.tenantNames.join(" & ")}
          </Link>
          <div className="text-xs text-muted-foreground">
            {noticeTypeLabel(notice.noticeType)} • {notice.jurisdiction.toUpperCase()}
            {showAddress && <> • {notice.propertyAddress}{notice.unit ? `, Unit ${notice.unit}` : ""}</>}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-sm font-serif font-medium" data-testid={`text-deadline-date-${notice.id}`}>
            {formatIso(date)}
          </div>
          <div className="text-[10px] font-medium uppercase tracking-wider mt-0.5 px-1.5 py-0.5 bg-muted rounded inline-block">
            {notice.status.replace(/_/g, " ")}
          </div>
        </div>
      </div>
      {(shiftedBy.length > 0 || weekendSkips > 0) && (
        <div className="mt-1.5 text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 rounded-md px-2 py-1.5" data-testid={`text-shifted-by-${notice.id}`}>
          Deadline shifted past{" "}
          {[
            ...shiftedBy.map((s) => `${s.name} (${formatIso(s.date)})`),
            ...(weekendSkips > 0 ? [`${weekendSkips} weekend day${weekendSkips === 1 ? "" : "s"}`] : []),
          ].join(", ")}
          .
        </div>
      )}
    </div>
  );
}
