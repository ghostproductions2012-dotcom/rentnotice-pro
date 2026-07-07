import { useNotices } from "@/lib/api/hooks";
import { Card, CardContent } from "@/components/ui/card";
import { FileText, Search, Plus, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from "wouter";
import { useState } from "react";
import { formatCents } from "@/lib/types";

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
                    <div className="text-xs font-medium uppercase tracking-wider mt-1 px-2 py-0.5 bg-muted rounded inline-block">
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
