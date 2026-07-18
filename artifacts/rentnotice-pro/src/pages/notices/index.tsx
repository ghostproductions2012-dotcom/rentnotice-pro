import { useNotices } from "@/lib/api/hooks";
import { Card, CardContent } from "@/components/ui/card";
import { FileText, Search, Plus, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from "wouter";
import { useState } from "react";
import { formatCents, type NoticeStatus } from "@/lib/types";

const STATUS_BADGE_CLASSES: Record<NoticeStatus, string> = {
  draft: "bg-muted text-muted-foreground border-border",
  needs_review: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800",
  reviewed: "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800",
  finalized: "bg-indigo-100 text-indigo-800 border-indigo-300 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-800",
  served: "bg-green-100 text-green-800 border-green-300 dark:bg-green-950/40 dark:text-green-300 dark:border-green-800",
  mailed: "bg-teal-100 text-teal-800 border-teal-300 dark:bg-teal-950/40 dark:text-teal-300 dark:border-teal-800",
  expired: "bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-800",
  paid: "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800",
  sent_to_attorney: "bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800",
  cancelled: "bg-red-100 text-red-800 border-red-300 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800",
  revised: "bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800",
};

export default function NoticesList() {
  const [search, setSearch] = useState("");
  const { data: notices, isLoading } = useNotices();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight">Notices</h1>
          <p className="text-muted-foreground mt-1">Manage notice pipeline and document workflows.</p>
        </div>
        <Button asChild>
          <Link href="/notices/new">
            <Plus className="w-4 h-4 mr-2" />
            Prepare Notice
          </Link>
        </Button>
      </div>

      <div className="flex gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search notices by tenant or address..." 
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button variant="outline" size="icon">
          <Filter className="w-4 h-4" />
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1,2,3,4].map(i => <div key={i} className="h-20 bg-muted rounded-xl animate-pulse" />)}
        </div>
      ) : notices?.length === 0 ? (
        <Card className="border-dashed bg-muted/20">
          <CardContent className="p-12 text-center">
            <FileText className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-medium">No notices found</h3>
            <p className="text-muted-foreground mb-4">Start preparing your first notice.</p>
            <Button variant="outline" asChild>
              <Link href="/notices/new">Prepare Notice</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="border rounded-xl bg-card overflow-hidden">
          <div className="divide-y">
            {notices?.map(notice => (
              <Link key={notice.id} href={`/notices/${notice.id}`} className="block hover:bg-muted/30 transition-colors p-4 sm:p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-lg">{notice.tenantNames.join(" & ")}</h3>
                    <div className="text-sm text-muted-foreground mt-1">
                      {notice.propertyAddress}, Unit {notice.unit} • {notice.noticeType.replace(/_/g, ' ').toUpperCase()}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-medium font-serif">{formatCents(notice.totalAmountCents)}</div>
                    <div className={`text-xs font-semibold uppercase tracking-wider mt-1 px-2.5 py-1 rounded-full inline-block border ${STATUS_BADGE_CLASSES[notice.status] ?? "bg-muted text-muted-foreground border-transparent"}`}>
                      {notice.status.replace(/_/g, ' ')}
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
