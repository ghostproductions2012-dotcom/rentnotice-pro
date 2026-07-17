import { AlertTriangle } from "lucide-react";
import { suggestMergeField } from "@/lib/documents/merge";

/**
 * Inline warning listing merge fields in a template body that are not
 * produced by the merge pipeline (see unknownMergeFields). Renders nothing
 * when the list is empty. Saving is still allowed — some fields may be
 * intentional — but editors are told these will appear unfilled.
 *
 * When a token looks like a typo of a known field, a "did you mean"
 * suggestion is shown; clicking it calls `onReplace(typo, suggestion)` so the
 * caller can fix the token in the body.
 */
export function UnknownFieldsWarning({
  fields,
  onReplace,
}: {
  fields: string[];
  onReplace?: (from: string, to: string) => void;
}) {
  if (fields.length === 0) return null;
  return (
    <div
      className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
      data-testid="warning-unknown-fields"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="space-y-1">
        <p className="font-medium">
          {fields.length === 1 ? "This merge field won't be filled in:" : "These merge fields won't be filled in:"}
        </p>
        <div className="flex flex-col gap-1">
          {fields.map((f) => {
            const suggestion = suggestMergeField(f);
            return (
              <div key={f} className="flex flex-wrap items-center gap-1.5">
                <code className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-xs dark:bg-amber-900" data-testid={`unknown-field-${f}`}>
                  {"{{"}{f}{"}}"}
                </code>
                {suggestion && (
                  <span className="text-xs">
                    — did you mean{" "}
                    {onReplace ? (
                      <button
                        type="button"
                        onClick={() => onReplace(f, suggestion)}
                        className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-xs underline decoration-dotted underline-offset-2 hover:bg-amber-200 dark:bg-amber-900 dark:hover:bg-amber-800"
                        title={`Replace {{${f}}} with {{${suggestion}}}`}
                        data-testid={`suggestion-${f}`}
                      >
                        {"{{"}{suggestion}{"}}"}
                      </button>
                    ) : (
                      <code className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-xs dark:bg-amber-900" data-testid={`suggestion-${f}`}>
                        {"{{"}{suggestion}{"}}"}
                      </code>
                    )}
                    ?
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <p className="text-xs">
          They aren't produced when a notice is generated, so they would appear as unfilled
          placeholders on the printed notice. Check for typos (e.g. {"{{tenant_names}}"}, not{" "}
          {"{{tenant_name}}"}). You can still save if this is intentional.
        </p>
      </div>
    </div>
  );
}
