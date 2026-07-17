import { useState } from "react";
import { Braces, ChevronDown, ChevronRight } from "lucide-react";
import { KNOWN_MERGE_FIELDS, MERGE_FIELD_DESCRIPTIONS } from "@/lib/documents/merge";

/**
 * Insert `{{field}}` into a textarea at the current cursor position, updating
 * React state via `onChange` and restoring focus/cursor after the insert.
 */
export function insertMergeField(
  textarea: HTMLTextAreaElement | null,
  field: string,
  value: string,
  onChange: (next: string) => void,
) {
  const token = `{{${field}}}`;
  if (!textarea) {
    onChange(value + token);
    return;
  }
  const start = textarea.selectionStart ?? value.length;
  const end = textarea.selectionEnd ?? value.length;
  const next = value.slice(0, start) + token + value.slice(end);
  onChange(next);
  requestAnimationFrame(() => {
    textarea.focus();
    const pos = start + token.length;
    textarea.setSelectionRange(pos, pos);
  });
}

/**
 * Collapsible list of all known merge fields with short descriptions.
 * Clicking a field calls `onInsert(field)`.
 */
export function MergeFieldPicker({ onInsert }: { onInsert: (field: string) => void }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");

  const query = filter.trim().toLowerCase();
  const visibleFields = query
    ? KNOWN_MERGE_FIELDS.filter(
        (f) =>
          f.toLowerCase().includes(query) ||
          (MERGE_FIELD_DESCRIPTIONS[f] ?? "").toLowerCase().includes(query),
      )
    : KNOWN_MERGE_FIELDS;

  return (
    <div className="border rounded-lg bg-muted/20">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium text-left"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        data-testid="button-toggle-merge-fields"
      >
        {open ? (
          <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
        )}
        <Braces className="w-4 h-4 text-muted-foreground shrink-0" />
        Insert merge field
        <span className="text-xs text-muted-foreground font-normal ml-auto">
          {KNOWN_MERGE_FIELDS.length} available
        </span>
      </button>
      {open && (
        <div className="border-t">
          <div className="p-2">
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter fields…"
              className="w-full px-2 py-1 text-xs border rounded-md bg-background outline-none focus-visible:ring-1 focus-visible:ring-ring"
              data-testid="input-filter-merge-fields"
            />
          </div>
          <div className="border-t max-h-56 overflow-y-auto divide-y" data-testid="list-merge-fields">
          {visibleFields.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground" data-testid="text-no-matching-fields">
              No fields match "{filter.trim()}"
            </div>
          )}
          {visibleFields.map((f) => (
            <button
              key={f}
              type="button"
              className="w-full flex items-baseline gap-3 px-3 py-1.5 text-left hover:bg-muted/60 focus-visible:bg-muted/60 outline-none"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onInsert(f)}
              title={`Insert {{${f}}} at the cursor`}
              data-testid={`button-insert-field-${f}`}
            >
              <code className="text-xs font-mono shrink-0">{"{{"}{f}{"}}"}</code>
              <span className="text-xs text-muted-foreground truncate">
                {MERGE_FIELD_DESCRIPTIONS[f] ?? ""}
              </span>
            </button>
          ))}
          </div>
        </div>
      )}
    </div>
  );
}
