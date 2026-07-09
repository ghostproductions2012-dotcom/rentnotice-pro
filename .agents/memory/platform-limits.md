---
name: Platform limits
description: Environment-specific restrictions hit while building in this project.
---

## Mobile artifact creation blocked only in iOS Replit app sessions
`createArtifact({artifactType: "expo", ...})` fails with "Creating mobile apps is not supported in the iOS Replit app" **only when the project is opened from the iOS Replit app**. In a later replit.com session (July 2026) the same call succeeded and the Expo artifact was created normally.

**Why:** Session-environment restriction, not a project misconfiguration — it depends on where the user opened the project, and can disappear between sessions.

**How to apply:** If mobile artifact creation fails with this message, don't treat it as permanent: defer to a follow-up and retry in a replit.com session. Always attempt creation first rather than assuming it's blocked.

## viewEnvVars can omit secrets that actually exist
`viewEnvVars()` in a task env listed only some secrets (July 2026: RESEND_API_KEY missing from the list) while `[ -n "$VAR" ]` in the shell confirmed it was present.

**Why:** the secrets listing appears to snapshot/filter differently from the live process environment in task environments.

**How to apply:** before concluding a secret is missing (and asking the user for it), confirm absence via the shell (`[ -n "$KEY" ]`), not just the listing.

## Shared-proxy path collisions with SPA routes
Artifacts on the shared proxy own their preview path prefix (e.g. the Expo app owns `/field`). A desktop SPA route with the same path renders fine on client-side navigation but full page loads/reloads get proxied to the other artifact (blank page + asset 404s).

**Why:** localhost:80 routes by path prefix before the SPA's router ever runs (hit July 2026: desktop route `/field` collided with the mobile artifact's `/field` preview path).

**How to apply:** When adding client-side routes to any web artifact, avoid path names matching other artifacts' preview paths (check registered artifacts). Renaming the SPA route (e.g. `/field-service`) fixes it.

## Env vars are versioned in .replit — never put passwords there
Non-secret env vars set via setEnvVars materialize into the `.replit` file's
`[userenv.*]` sections, which is committed to version control. Any credential
(password, token) stored that way ships in every commit and trips security
review. **Why:** an admin-panel dev password stored as a development env var
landed in a task commit and got the task rejected. **How to apply:** anything
credential-shaped must go through requestEnvVar as a secret (secrets live
outside the repo); env vars are only for non-sensitive config.
