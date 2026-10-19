import { describe, expect, it } from 'vitest'
import type { DiffSection } from './diff-section-types'
import { applyDiffSectionLiveEdit } from './diff-section-live-edit'

function section(key: string, diskText: string, contentGeneration: number): DiffSection {
  return {
    key,
    path: key,
    status: 'modified',
    area: 'unstaged',
    originalContent: 'head',
    modifiedContent: diskText,
    collapsed: false,
    loading: false,
    dirty: false,
    diffResult: {
      kind: 'text',
      originalContent: 'head',
      modifiedContent: diskText,
      originalIsBinary: false,
      modifiedIsBinary: false
    },
    largeDiffRenderLimit: null,
    contentGeneration
  }
}

const edit = (overrides: { sectionKey?: string; editedGeneration?: number; content?: string }) => ({
  index: 0,
  sectionKey: overrides.sectionKey ?? 'a.ts',
  editedGeneration: overrides.editedGeneration,
  content: overrides.content ?? 'old text + key',
  renderLimit: () => null
})

describe('applyDiffSectionLiveEdit', () => {
  it('ignores a key typed into the old model after a reload committed newer disk text', () => {
    // The reload set the new disk text and bumped the generation; the old model still had focus.
    const reloaded = [section('a.ts', 'new disk text', 2)]

    expect(applyDiffSectionLiveEdit(reloaded, edit({ editedGeneration: 1 }))).toBe(reloaded)
  })

  it('ignores an edit from an editor mounted for a different row', () => {
    const shifted = [section('b.ts', 'b on disk', 0)]

    expect(applyDiffSectionLiveEdit(shifted, edit({ sectionKey: 'a.ts' }))).toBe(shifted)
  })

  it('records an edit to the current model as the dirty draft', () => {
    const [after] = applyDiffSectionLiveEdit(
      [section('a.ts', 'disk', 3)],
      edit({ editedGeneration: 3, content: 'disk + key' })
    )

    expect(after).toMatchObject({ modifiedContent: 'disk + key', dirty: true })
  })
})
