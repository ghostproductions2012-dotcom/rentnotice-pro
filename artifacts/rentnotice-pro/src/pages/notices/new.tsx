import { Card, CardContent } from "@/components/ui/card";
import { FileText, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NoticeNew() {
  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="text-center space-y-2 pb-6">
        <div className="w-16 h-16 bg-primary/10 text-primary rounded-2xl flex items-center justify-center mx-auto mb-4">
          <FileText className="w-8 h-8" />
        </div>
        <h1 className="text-3xl font-serif font-bold tracking-tight">Prepare Notice</h1>
        <p className="text-muted-foreground">Follow the guided process to calculate and generate a compliant legal notice.</p>
      </div>

      <Card>
        <CardContent className="p-8">
          <div className="space-y-8">
            {/* Step placeholders */}
            <div className="flex items-start gap-4 opacity-50">
              <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center font-bold">1</div>
              <div>
                <h3 className="font-medium">Select Tenant & Ledger</h3>
                <p className="text-sm text-muted-foreground">Choose the tenant to serve and the ledger to base calculations on.</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">2</div>
              <div>
                <h3 className="font-medium">Calculation Review</h3>
                <p className="text-sm text-muted-foreground">Review the system's rent-only calculation and exclude non-rent charges.</p>
              </div>
            </div>
            <div className="flex items-start gap-4 opacity-50">
              <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center font-bold">3</div>
              <div>
                <h3 className="font-medium">Configure Notice</h3>
                <p className="text-sm text-muted-foreground">Select notice type and template, configure specific fields.</p>
              </div>
            </div>
          </div>
          
          <div className="mt-8 pt-6 border-t flex justify-end">
            <Button>
              Next Step <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
