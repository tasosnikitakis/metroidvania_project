/**
 * Tiny client for the content API (see server/index.ts).
 *   GET  /api/content/<path>   -> JSON
 *   PUT  /api/content/<path>   -> save JSON (editors only)
 *   GET  /api/content          -> { files: string[], writable: boolean }
 *   DELETE /api/content/<path> -> remove a file (editors only)
 */

const TOKEN_KEY = 'editorToken';

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { 'x-editor-token': token } : {};
}

export function setEditorToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export async function loadContent<T>(path: string): Promise<T> {
  const res = await fetch(`/api/content/${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return (await res.json()) as T;
}

export async function saveContent(path: string, data: unknown): Promise<void> {
  const res = await fetch(`/api/content/${path}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(`Failed to save ${path}: ${res.status} ${msg}`);
  }
}

export async function deleteContent(path: string): Promise<void> {
  const res = await fetch(`/api/content/${path}`, { method: 'DELETE', headers: authHeaders() });
  if (!res.ok) throw new Error(`Failed to delete ${path}: ${res.status}`);
}

export async function listContent(): Promise<{ files: string[]; writable: boolean }> {
  const res = await fetch('/api/content', { headers: authHeaders(), cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to list content: ${res.status}`);
  return res.json();
}
