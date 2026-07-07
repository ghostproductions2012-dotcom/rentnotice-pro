import { useTemplates, useStateRules } from "@/lib/api/hooks";
import { Card, CardContent } from "@/components/ui/card";
import { Scale, Search, Plus, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from "wouter";

export default function TemplatesList() {
  const { data: templates, isLoading } = useTemplates();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight">Legal Templates</h1>
          <p className="text-muted-foreground mt-1">Manage standard language for notices across jurisdictions.</p>
        </div>
        <Button>
          <Plus className="w-4 h-4 mr-2" />
          New Template
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1,2,3].map(i => <div key={i} className="h-24 bg-muted rounded-xl animate-pulse" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {templates?.map(template => (
            <Link key={template.id} href={`/templates/${template.id}`}>
              <Card className="hover:border-primary/50 transition-colors cursor-pointer h-full">
                <CardContent className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <h3 className="font-bold font-serif text-lg leading-tight pr-4">{template.name}</h3>
                    {template.attorneyReviewed ? (
                      <span className="shrink-0 px-2 py-1 bg-primary/10 text-primary text-[10px] font-bold uppercase tracking-wider rounded">Reviewed</span>
                    ) : (
                      <span className="shrink-0 px-2 py-1 bg-destructive/10 text-destructive text-[10px] font-bold uppercase tracking-wider rounded">Requires Review</span>
                    )}
                  </div>
                  
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5" />
                      {template.jurisdiction}
                    </div>
                    <div className="px-1.5 border-l">v{template.currentVersion}</div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
