import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, Download, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useReport } from "@/lib/api/hooks";
import { formatCents } from "@/lib/types";

function MaintenanceSummaryCard() {
  const { data: report, isLoading } = useReport("maintenance_summary");
  return (
    <Card data-testid="card-maintenance-summary">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Wrench className="w-4 h-4" />
          Maintenance Summary
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-muted-foreground py-6 text-center text-sm">
            Loading maintenance summary…
          </div>
        ) : !report || report.rows.length === 0 ? (
          <div className="text-muted-foreground py-6 text-center text-sm">
            No work orders yet. Metrics appear here once maintenance activity is logged.
          </div>
        ) : (
          <div className="divide-y">
            {report.rows.map((row) => (
              <div
                key={row.label}
                className="flex items-center justify-between py-2 text-sm"
                data-testid={`row-report-${row.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
              >
                <span className="text-muted-foreground">{row.label}</span>
                <span className="font-medium tabular-nums">
                  {row.isMoney ? formatCents(row.value) : row.value}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function ReportsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight">Reports & Analytics</h1>
          <p className="text-muted-foreground mt-1">Operational insights and compliance metrics.</p>
        </div>
        <Button variant="outline">
          <Download className="w-4 h-4 mr-2" />
          Export All CSV
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <MaintenanceSummaryCard />
        <Card className="min-h-[300px] flex items-center justify-center border-dashed bg-muted/10">
          <div className="text-center text-muted-foreground">
            <BarChart className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>Notice Volume by Property</p>
          </div>
        </Card>
      </div>
    </div>
  );
}
