import { Card, CardContent } from "@/components/ui/card";
import { Calendar as CalendarIcon, AlertCircle } from "lucide-react";

export default function CalendarPage() {
  return (
    <div className="space-y-6 h-full flex flex-col">
      <div>
        <h1 className="text-3xl font-serif font-bold tracking-tight">Deadline Calendar</h1>
        <p className="text-muted-foreground mt-1">Track notice expiration dates, court holidays, and service deadlines.</p>
      </div>

      <div className="flex-1 min-h-[500px]">
        <Card className="h-full border-dashed bg-muted/10 flex flex-col items-center justify-center text-center p-8">
          <CalendarIcon className="w-12 h-12 text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-medium">Calendar functionality coming soon</h3>
          <p className="text-muted-foreground mt-2 max-w-sm">
            This module will automatically calculate jurisdictional deadlines incorporating court holidays and weekends.
          </p>
        </Card>
      </div>
    </div>
  );
}
