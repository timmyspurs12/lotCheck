const DEMO_SESSION_STORAGE_KEY = 'lotcheck.demo.session';
let volatileToken: string | null | undefined;

export function getDemoSessionToken(): string | null {
  if (volatileToken !== undefined) return volatileToken;
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage.getItem(DEMO_SESSION_STORAGE_KEY);
  } catch {
    // Fall back to this page's memory if browser storage is restricted.
    return null;
  }
}

export function setDemoSessionToken(token: string) {
  volatileToken = token;
  try {
    if (typeof window !== 'undefined') window.sessionStorage.setItem(DEMO_SESSION_STORAGE_KEY, token);
  } catch {
    // The in-memory token remains available for this page session.
  }
}

export function clearDemoSessionToken() {
  volatileToken = null;
  try {
    if (typeof window !== 'undefined') window.sessionStorage.removeItem(DEMO_SESSION_STORAGE_KEY);
  } catch {
    // Storage may be unavailable in private or restricted browsing contexts.
  }
}
