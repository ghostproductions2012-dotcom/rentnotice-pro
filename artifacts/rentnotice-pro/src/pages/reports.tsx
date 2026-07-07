import { Card, CardContent } from "@/components/ui/card";
import { BarChart, Download } from "lucide-react";
import { Button } from "@/components/ui/button";

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
        <Card className="min-h-[300px] flex items-center justify-center border-dashed bg-muted/10">
          <div className="text-center text-muted-foreground">
            <BarChart className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>Notice Volume by Property</p>
          </div>
        </Card>
        <Card className="min-h-[300px] flex items-center justify-center border-dashed bg-muted/10">
          <div className="text-center text-muted-foreground">
            <BarChart className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>Compliance & Excluded Charges</p>
          </div>
        </Card>
      </div>
    </div>
  );
}
