import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Database, Upload } from "lucide-react";

export default function ImportWizard() {
  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="text-center space-y-2 pb-6">
        <div className="w-16 h-16 bg-primary/10 text-primary rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Database className="w-8 h-8" />
        </div>
        <h1 className="text-3xl font-serif font-bold tracking-tight">Import Ledger</h1>
        <p className="text-muted-foreground">Upload an exported ledger from your property management software.</p>
      </div>

      <Card className="border-dashed border-2">
        <CardContent className="p-12 text-center hover:bg-muted/10 transition-colors cursor-pointer">
          <Upload className="w-10 h-10 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">Click to upload or drag & drop</h3>
          <p className="text-sm text-muted-foreground mt-2">Supports CSV, Excel, and PDF formats</p>
          <div className="mt-6 flex justify-center gap-4 text-xs text-muted-foreground font-mono">
            <span className="bg-muted px-2 py-1 rounded">AppFolio</span>
            <span className="bg-muted px-2 py-1 rounded">Buildium</span>
            <span className="bg-muted px-2 py-1 rounded">Yardi</span>
          </div>
        </CardContent>
      </Card>
      
      {/* TODO: Add mapping wizard steps */}
    </div>
  );
}
