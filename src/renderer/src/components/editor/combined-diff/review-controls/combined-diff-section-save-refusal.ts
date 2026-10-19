import type React from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import type { FileWriteDiskConflict } from '../../../../../../shared/file-write-disk-precondition'
import { saveRefusalNotice } from '../../editor-file-save-attempt'
import type { DiffSection } from '../../diff-section-types'

/** A section has no banner, so its refusal notice carries both ways out. */
export function notifySectionSaveRefused(
  diskConflict: FileWriteDiskConflict,
  resolve: { overwrite: () => void; reload: () => void }
): void {
  toast.error(saveRefusalNotice(diskConflict), {
    action: {
      label: translate('auto.components.editor.editor.save.refused.overwrite', 'Overwrite'),
      onClick: resolve.overwrite
    },
    cancel: {
      label: translate('auto.components.editor.editor.save.refused.reload', 'Reload'),
      onClick: resolve.reload
    }
  })
}

/** Drops a section's edits back to what it loaded; dirty sections never reload. */
export function discardSectionEdits(
  setSections: React.Dispatch<React.SetStateAction<DiffSection[]>>,
  sectionKey: string
): void {
  setSections((prev) =>
    prev.map((section) =>
      section.key !== sectionKey
        ? section
        : {
            ...section,
            modifiedContent:
              section.diffResult?.kind === 'text'
                ? section.diffResult.modifiedContent
                : section.modifiedContent,
            dirty: false
          }
    )
  )
}
