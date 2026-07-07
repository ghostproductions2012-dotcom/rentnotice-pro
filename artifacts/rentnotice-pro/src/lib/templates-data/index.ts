// ---------------------------------------------------------------------------
// Public API barrel for built-in notice templates.
//
// - CA_TEMPLATES: attorney-reviewed California templates (one per NoticeType).
// - STATE_TEMPLATES: generic pay-or-quit templates for all other 50 states +
//   DC, each flagged attorney-review-required (attorneyReviewed: false).
// - ALL_BUILTIN_TEMPLATES: CA_TEMPLATES followed by STATE_TEMPLATES.
//
// Everything else in this directory is internal.
// ---------------------------------------------------------------------------

import type { NoticeTemplate } from "../types";
import { CA_TEMPLATES } from "./ca";
import { STATE_TEMPLATES } from "./states";

export { CA_TEMPLATES } from "./ca";
export { STATE_TEMPLATES } from "./states";

export const ALL_BUILTIN_TEMPLATES: NoticeTemplate[] = [...CA_TEMPLATES, ...STATE_TEMPLATES];
