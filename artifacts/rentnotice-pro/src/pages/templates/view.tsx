import { useTemplate } from "@/lib/api/hooks";
import { useParams } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";

export default function TemplateView() {
  const { id } = useParams<{ id: string }>();
  const { data: template, isLoading } = useTemplate(id);

  if (isLoading) return <div className="animate-pulse space-y-4"><div className="h-8 bg-muted w-1/3 rounded" /><div className="h-64 bg-muted rounded" /></div>;
  if (!template) return <div>Template not found</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/templates">
            <ArrowLeft className="w-4 h-4" />
          </Link>
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-serif font-bold tracking-tight">{template.name}</h1>
          </div>
          <p className="text-muted-foreground mt-1">
            {template.jurisdiction} • v{template.currentVersion}
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="p-8">
          <div className="flex items-center justify-center h-64 border-dashed border-2 bg-muted/5 text-muted-foreground">
            <div className="text-center">
              <Scale className="w-12 h-12 mx-auto mb-4 opacity-20" />
              <p>Template editor loading...</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
