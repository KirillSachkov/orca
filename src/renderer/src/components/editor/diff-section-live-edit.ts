import type { DiffSection } from './diff-section-types'

export type DiffSectionLiveEdit = {
  index: number
  /** The section the editor was mounted for; rows can shift under a live editor. */
  sectionKey: string
  /** contentGeneration of the model the keystroke landed in, when known. */
  editedGeneration: number | undefined
  content: string
  renderLimit: (section: DiffSection) => DiffSection['largeDiffRenderLimit']
}

/**
 * Folds a keystroke into section state. Why the generation check: a reload commits new disk text
 * (and bumps contentGeneration) before React swaps the model, so a key typed into the old model in
 * between would pair old text with the new baseline and let a save overwrite unseen disk content.
 */
export function applyDiffSectionLiveEdit(
  prev: DiffSection[],
  edit: DiffSectionLiveEdit
): DiffSection[] {
  let changed = false
  const next = prev.map((s, i) => {
    if (i !== edit.index || s.key !== edit.sectionKey) {
      return s
    }
    if (
      edit.editedGeneration !== undefined &&
      edit.editedGeneration !== (s.contentGeneration ?? 0)
    ) {
      return s
    }
    const savedModifiedContent =
      s.diffResult?.kind === 'text' ? s.diffResult.modifiedContent : s.modifiedContent
    const dirty = edit.content !== savedModifiedContent
    if (s.modifiedContent === edit.content && s.dirty === dirty) {
      return s
    }
    changed = true
    // Why: virtualized rows unmount when scrolled away, so the draft must
    // live in section state instead of only in Monaco's mounted model.
    return {
      ...s,
      modifiedContent: edit.content,
      dirty,
      largeDiffRenderLimit: edit.renderLimit(s)
    }
  })
  return changed ? next : prev
}
