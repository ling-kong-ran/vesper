export function mergeSessionLists(current, incoming) {
  const incomingIds = new Set(incoming.map((session) => session.id))
  const optimistic = current.filter((session) => !incomingIds.has(session.id))
  return [...incoming, ...optimistic]
}
