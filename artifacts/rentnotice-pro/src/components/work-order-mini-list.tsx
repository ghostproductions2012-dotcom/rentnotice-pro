import { useWorkOrders } from "@/lib/api/hooks";
import type { WorkOrderFilters, WorkOrderPriority, WorkOrderStatus } from "@/lib/types";
import {
  WORK_ORDER_CATEGORY_LABELS,
  WORK_ORDER_PRIORITY_LABELS,
  WORK_ORDER_STATUS_LABELS,
  formatCents,
} from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Wrench } from "lucide-react";
import { Link } from "wouter";

const STATUS_VARIANT: Record<WorkOrderStatus, string> = {
  new: "bg-accent text-accent-foreground",
  assigned: "bg-blue-600 text-white",
  in_progress: "bg-primary text-primary-foreground",
  on_hold: "bg-amber-500 text-white",
  completed: "bg-green-600 text-white",
  cancelled: "bg-muted text-muted-foreground",
};

const PRIORITY_VARIANT: Record<WorkOrderPriority, string> = {
  low: "bg-muted text-muted-foreground",
  normal: "bg-secondary text-secondary-foreground",
  high: "bg-amber-500 text-white",
  emergency: "bg-destructive text-destructive-foreground",
};

/**
 * Compact read-only work-order list embedded in property and tenant views.
 * Management (create/edit/status) happens on the Maintenance page.
 */
export function WorkOrderMiniList({ filters }: { filters: WorkOrderFilters }) {
  const { data: workOrders, isLoading } = useWorkOrders(filters);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" asChild data-testid="button-open-maintenance">
          <Link href="/maintenance">
            <Wrench className="w-4 h-4 mr-2" />
            Open Maintenance
          </Link>
        </Button>
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="divide-y">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground">Loading…</div>
            ) : !workOrders?.length ? (
              <div className="p-8 text-center text-muted-foreground">
                No work orders recorded yet.
              </div>
            ) : (
              workOrders.map((w) => (
                <div key={w.id} className="p-4" data-testid={`row-work-order-${w.id}`}>
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded ${STATUS_VARIANT[w.status]}`}>
                          {WORK_ORDER_STATUS_LABELS[w.status]}
                        </span>
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded ${PRIORITY_VARIANT[w.priority]}`}>
                          {WORK_ORDER_PRIORITY_LABELS[w.priority]}
                        </span>
                        <span className="font-medium">{w.title}</span>
                        <Badge variant="outline">{WORK_ORDER_CATEGORY_LABELS[w.category]}</Badge>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {w.unit ? `Unit ${w.unit} • ` : ""}
                        {w.dueDate ? `Due ${w.dueDate} • ` : ""}
                        Created {new Date(w.createdAt).toLocaleDateString()}
                        {w.assigneeName ? ` • Assigned to ${w.assigneeName}` : ""}
                        {w.vendorName ? ` • Vendor ${w.vendorName}` : ""}
                      </div>
                    </div>
                    <div className="text-right shrink-0 text-sm">
                      {w.costActualCents != null ? (
                        <div className="font-medium">{formatCents(w.costActualCents)}</div>
                      ) : w.costEstimateCents != null ? (
                        <div className="text-muted-foreground">
                          Est. {formatCents(w.costEstimateCents)}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
