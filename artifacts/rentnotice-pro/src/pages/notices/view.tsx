import { useNotice, useValidation } from "@/lib/api/hooks";
import { useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, CheckCircle, AlertTriangle, FileText, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { formatCents } from "@/lib/types";

export default function NoticeView() {
  const { id } = useParams<{ id: string }>();
  const { data: notice, isLoading } = useNotice(id);
  const { data: validation } = useValidation(id);

  if (isLoading) return <div className="animate-pulse space-y-4"><div className="h-8 bg-muted w-1/3 rounded" /><div className="h-64 bg-muted rounded" /></div>;
  if (!notice) return <div>Notice not found</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 mb-8">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/notices">
            <ArrowLeft className="w-4 h-4" />
          </Link>
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-serif font-bold tracking-tight">Notice Workroom</h1>
            <span className="px-3 py-1 bg-primary text-primary-foreground text-xs font-bold uppercase tracking-wider rounded-md">
              {notice.status.replace(/_/g, ' ')}
            </span>
          </div>
          <p className="text-muted-foreground mt-1">
            {notice.tenantNames.join(" & ")} • {notice.propertyAddress}, Unit {notice.unit}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <Card>
            <CardHeader className="border-b pb-4">
              <CardTitle>Notice Details</CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
                <div>
                  <dt className="text-sm font-medium text-muted-foreground">Type</dt>
                  <dd className="mt-1">{notice.noticeType.replace(/_/g, ' ').toUpperCase()}</dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-muted-foreground">Jurisdiction</dt>
                  <dd className="mt-1">{notice.jurisdiction}</dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-muted-foreground">Total Demanded</dt>
                  <dd className="mt-1 font-serif text-xl font-bold">{formatCents(notice.totalAmountCents)}</dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-muted-foreground">Prepared On</dt>
                  <dd className="mt-1">{new Date(notice.createdAt).toLocaleDateString()}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          {validation && (
            <Card className={validation.passed ? "border-primary/20" : "border-destructive/30"}>
              <CardHeader className={`pb-4 ${validation.passed ? "bg-primary/5" : "bg-destructive/5"}`}>
                <CardTitle className="flex items-center gap-2">
                  {validation.passed ? <CheckCircle className="w-5 h-5 text-primary" /> : <AlertTriangle className="w-5 h-5 text-destructive" />}
                  Compliance Validation
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                {validation.issues.length === 0 ? (
                  <p className="text-muted-foreground">All compliance checks passed.</p>
                ) : (
                  <ul className="space-y-3">
                    {validation.issues.map((issue, idx) => (
                      <li key={idx} className="flex gap-3 text-sm">
                        <AlertTriangle className={`w-4 h-4 shrink-0 ${issue.level === 'blocker' ? 'text-destructive' : 'text-accent'}`} />
                        <div>
                          <span className="font-medium">{issue.level === 'blocker' ? 'Blocker: ' : 'Warning: '}</span>
                          {issue.message}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Workflow Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {notice.status === 'draft' && (
                <Button className="w-full">Submit for Review</Button>
              )}
              {notice.status === 'needs_review' && (
                <>
                  <Button className="w-full" variant="default">Approve Notice</Button>
                  <Button className="w-full" variant="outline">Request Revision</Button>
                </>
              )}
              {notice.status === 'reviewed' && (
                <Button className="w-full" variant="default">Finalize & Generate</Button>
              )}
              {notice.status === 'finalized' && (
                <Button className="w-full" variant="outline">Record Service</Button>
              )}
              
              <Button variant="ghost" className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive">Cancel Notice</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Documents</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button variant="outline" className="w-full justify-start">
                <FileText className="w-4 h-4 mr-2 text-primary" />
                Preview Draft
              </Button>
              <Button variant="outline" className="w-full justify-start" disabled>
                <Download className="w-4 h-4 mr-2" />
                Download Final PDF
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
