export * from "./generated/api";
export * from "./generated/api.schemas";
export { setBaseUrl, setAuthTokenGetter, setLicenseKeyGetter, setMemberTokenGetter, ApiError, ResponseParseError } from "./custom-fetch";
// Re-export the query client primitives so consuming apps share the exact
// react-query instance the generated hooks use. pnpm can install two copies
// of @tanstack/react-query when peer @types/react versions diverge (e.g. the
// Expo app); a provider from the app's copy is invisible to hooks from this
// copy ("No QueryClient set" at runtime).
export { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
export type { AuthTokenGetter } from "./custom-fetch";
