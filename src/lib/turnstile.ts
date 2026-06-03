import { invoke } from "@tauri-apps/api/core";

const API_BASE = "https://lyrics.api.dacubeking.com/";
const JWT_STORAGE_KEY = "bl_jwt_v1";
const JWT_EXPIRY_BUFFER_SECS = 300;

function isJwtExpired(token: string): boolean {
  try {
    const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(b64));
    return !payload.exp || Date.now() / 1000 > payload.exp - JWT_EXPIRY_BUFFER_SECS;
  } catch {
    return true;
  }
}

export function getCachedToken(): string | null {
  try {
    const stored = localStorage.getItem(JWT_STORAGE_KEY);
    if (stored && !isJwtExpired(stored)) return stored;
  } catch {
    /* ignore */
  }
  return null;
}

export function clearAuthToken(): void {
  try {
    localStorage.removeItem(JWT_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Performs Cloudflare Turnstile challenge to obtain a JWT for the better-lyrics API. */
export function getAuthToken(): Promise<string | null> {
  const cached = getCachedToken();
  if (cached) return Promise.resolve(cached);

  return new Promise((resolve) => {
    const wrapper = document.createElement("div");
    wrapper.style.cssText =
      "position:fixed;bottom:20px;right:20px;z-index:999999;background:#1a1a1a;border-radius:8px;padding:8px;box-shadow:0 4px 12px rgba(0,0,0,0.5)";

    const iframe = document.createElement("iframe");
    iframe.src = API_BASE + "challenge";
    iframe.style.cssText = "width:300px;height:80px;border:none;display:block";
    wrapper.appendChild(iframe);
    document.body.appendChild(wrapper);

    let resolved = false;
    const cleanup = () => {
      window.removeEventListener("message", handler);
      if (document.body.contains(wrapper)) document.body.removeChild(wrapper);
    };

    const finish = (jwt: string | null) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(jwt);
    };

    const timeout = setTimeout(() => finish(null), 30000);

    const handler = async (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) return;

      const { type, token, error } = (event.data ?? {}) as {
        type?: string;
        token?: string;
        error?: string;
      };

      if (type === "turnstile-token" && token) {
        clearTimeout(timeout);
        try {
          const jwt = await invoke<string>("verify_turnstile", { turnstileToken: token });
          if (jwt) {
            try { localStorage.setItem(JWT_STORAGE_KEY, jwt); } catch { /* quota */ }
            finish(jwt);
            return;
          }
        } catch { /* ignore */ }
        finish(null);
      } else if (type === "turnstile-error" || type === "turnstile-timeout") {
        clearTimeout(timeout);
        finish(null);
      } else if (type === "turnstile-expired") {
        iframe.contentWindow?.postMessage({ type: "reset-turnstile" }, "*");
      }

      void error;
    };

    window.addEventListener("message", handler);
  });
}

