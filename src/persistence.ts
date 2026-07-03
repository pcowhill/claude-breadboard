import type { ProjectData } from './types';

const KEY = 'vbl.project.v1';

export function saveLocal(p: ProjectData): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
    return true;
  } catch {
    return false;
  }
}

export function loadLocal(): ProjectData | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return parseProject(raw);
  } catch {
    return null;
  }
}

export function clearLocal() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Parse + minimally validate project JSON. Throws with a friendly message. */
export function parseProject(text: string): ProjectData {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Not valid JSON.');
  }
  const p = data as Partial<ProjectData>;
  if (typeof p !== 'object' || p === null) throw new Error('Not a project file.');
  if (!Array.isArray(p.components) || !Array.isArray(p.wires)) throw new Error('Missing components/wires arrays.');
  return {
    version: 1,
    labId: typeof p.labId === 'string' ? p.labId : 'free',
    components: p.components,
    wires: p.wires,
    program: p.program && typeof p.program === 'object' ? p.program : null,
    settings: { speed: Number(p.settings?.speed) || 1 },
  };
}

export function downloadJson(p: ProjectData, filename = 'breadboard-project.json') {
  const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
