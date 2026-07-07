import { useAuditLog } from "@/lib/api/hooks";
import { Card, CardContent } from "@/components/ui/card";
import { History } from "lucide-react";

export default function AuditPage() {
  const { data: audit, isLoading } = useAuditLog();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-serif font-bold tracking-tight">Audit Log</h1>
        <p className="text-muted-foreground mt-1">Immutable record of all system activity and data changes.</p>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="divide-y">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground">Loading audit trail...</div>
            ) : audit?.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">No activity recorded yet.</div>
            ) : (
              audit?.slice(0, 50).map(entry => (
                <div key={entry.id} className="p-4 flex items-start gap-4 hover:bg-muted/30">
                  <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                    <History className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div>
                    <div className="text-sm font-medium">{entry.summary}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {new Date(entry.timestamp).toLocaleString()} • User: {entry.userName} • Action: {entry.action}
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
