const KEY_STORAGE = "guide.key";

/** Access key: taken from ?key= on first visit, then remembered. */
export function accessKey() {
  const fromUrl = new URLSearchParams(location.search).get("key");
  try {
    if (fromUrl) localStorage.setItem(KEY_STORAGE, fromUrl);
    return fromUrl ?? localStorage.getItem(KEY_STORAGE) ?? "";
  } catch {
    return fromUrl ?? "";
  }
}

function headers(json = true) {
  const h = { "x-access-token": accessKey() };
  if (json) h["Content-Type"] = "application/json";
  return h;
}

export async function getJson(path) {
  const res = await fetch(path, { headers: headers(false) });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `${res.status}`);
  return res.json();
}

export async function postJson(path, body) {
  const res = await fetch(path, { method: "POST", headers: headers(), body: JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `${res.status}`);
  return res.json();
}

/** POSTs and reads an NDJSON event stream, calling onEvent for each event. */
export async function postStream(path, body, onEvent, signal) {
  const res = await fetch(path, { method: "POST", headers: headers(), body: JSON.stringify(body), signal });
  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) onEvent(JSON.parse(line));
    }
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer));
}
