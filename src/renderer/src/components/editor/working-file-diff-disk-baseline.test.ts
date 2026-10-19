import { describe, expect, it } from 'vitest'
import { getDiskBaselineSignature } from '../../../../shared/disk-baseline-signature'
import { combinedDiffSectionDiskPrecondition } from './working-file-diff-disk-baseline'

describe('combinedDiffSectionDiskPrecondition', () => {
  it('expects what disk holds after a section save wrote a lone surrogate', () => {
    // After a save the section's loaded side is the written string; disk stores U+FFFD for the surrogate.
    const precondition = combinedDiffSectionDiskPrecondition({
      area: 'unstaged',
      diffResult: {
        kind: 'text',
        originalContent: 'head',
        modifiedContent: 'broken \uD800 pair',
        originalIsBinary: false,
        modifiedIsBinary: false
      }
    })

    expect(precondition?.expectedSignature).toBe(getDiskBaselineSignature('broken � pair'))
  })
})
