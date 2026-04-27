const MAX_REFS_PER_TAB = 4000;

type TabRefTargets = Map<string, number>;

const refTargetsByTab = new Map<number, TabRefTargets>();

function getOrCreateTabRefs(tabId: number): TabRefTargets {
  let refs = refTargetsByTab.get(tabId);
  if (!refs) {
    refs = new Map();
    refTargetsByTab.set(tabId, refs);
  }
  return refs;
}

export function rememberRefTarget(tabId: number, ref: string, frameId: number): void {
  if (!Number.isInteger(tabId) || tabId <= 0) return;
  if (typeof ref !== 'string' || !ref.trim()) return;
  if (!Number.isInteger(frameId) || frameId < 0) return;

  const refs = getOrCreateTabRefs(tabId);
  refs.set(ref, frameId);

  if (refs.size > MAX_REFS_PER_TAB) {
    const overflow = refs.size - MAX_REFS_PER_TAB;
    const staleRefs = Array.from(refs.keys()).slice(0, overflow);
    for (const staleRef of staleRefs) refs.delete(staleRef);
  }
}

export function rememberRefTargets(
  tabId: number,
  entries: Array<{ ref?: string | null; frameId?: number | null }>,
): void {
  for (const entry of entries) {
    if (!entry?.ref || typeof entry.frameId !== 'number') continue;
    rememberRefTarget(tabId, entry.ref, entry.frameId);
  }
}

export function getRefTargetFrameId(tabId: number, ref: string): number | undefined {
  if (!Number.isInteger(tabId) || tabId <= 0) return undefined;
  if (typeof ref !== 'string' || !ref.trim()) return undefined;
  return refTargetsByTab.get(tabId)?.get(ref);
}

export function clearRefTargetsForTab(tabId: number): void {
  refTargetsByTab.delete(tabId);
}
