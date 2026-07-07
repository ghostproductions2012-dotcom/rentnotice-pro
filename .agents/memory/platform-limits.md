---
name: Platform limits
description: Environment-specific restrictions hit while building in this project.
---

## Mobile artifact creation blocked on iOS Replit app
`createArtifact({artifactType: "expo", ...})` fails with "Creating mobile apps is not supported in the iOS Replit app. Open this project on replit.com to build a mobile app."

**Why:** The user opened this project from the iOS Replit app (observed July 2026). This is a session-environment restriction, not a project misconfiguration — retrying or changing parameters does not help.

**How to apply:** If a task requires a new mobile artifact, check early whether creation succeeds; if it fails with this message, defer the mobile work to a follow-up task and note it must be run from replit.com. Web/desktop work is unaffected.
