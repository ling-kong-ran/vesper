export const MEMORY_CANDIDATES_CHANGED_EVENT = 'vesper:memory-candidates-changed'

export function announceMemoryCandidatesChanged() {
  window.dispatchEvent(new CustomEvent(MEMORY_CANDIDATES_CHANGED_EVENT))
}
