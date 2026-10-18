// Why: a selection cleared by a process exit is automatic, so the removal that follows may still
// hand off; a selection the user cleared (last tab closed, a deselect) must stay cleared.
let automaticDeselectionDepth = 0

export function runAsAutomaticDeselection<T>(clear: () => T): T {
  automaticDeselectionDepth += 1
  try {
    return clear()
  } finally {
    automaticDeselectionDepth -= 1
  }
}

export function isAutomaticDeselection(): boolean {
  return automaticDeselectionDepth > 0
}
