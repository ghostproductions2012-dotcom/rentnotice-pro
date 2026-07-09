---
name: Ledger import dual paths
description: The ledger import preview and the final import parse rows through separate code paths that must stay in lockstep.
---

# Ledger import dual paths

The rule: any change to date/amount parsing or row-skipping behavior in the ledger import pipeline must be applied to BOTH the preview path (`normalizeRecords` in the import lib) and the final import path (`importLedger` in the API impl, which re-parses rows itself).

**Why:** While adding Excel serial-date handling, the preview accepted serial-date rows but the final import still dropped them — the two paths parse independently, so a one-sided fix makes the preview lie about what will be imported.

**How to apply:** When touching import parsing heuristics, grep for both consumers of the mapped rows and add a shared helper instead of duplicating logic where possible. A follow-up task exists to unify the two paths.
