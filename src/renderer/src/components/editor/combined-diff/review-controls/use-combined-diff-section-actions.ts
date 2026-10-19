import { useCallback, useRef } from 'react'
import type React from 'react'
import type { editor as monacoEditor } from 'monaco-editor'
import { useAppStore } from '@/store'
import { detectLanguage } from '@/lib/language-detect'
import { joinPath } from '@/lib/path'
import { openFilePreviewToSide } from '@/lib/file-preview'
import { getEditorFileOperationContext } from '@/lib/editor-file-operation-owner'
import { writeRuntimeFile } from '@/runtime/runtime-file-mutation-client'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import type { OpenFile } from '@/store/slices/editor'
import type { GitBranchChangeEntry } from '../../../../../../shared/git-diff-compare-types'
import { canOpenDiffSectionPreviewToSide } from '../../diff-section-preview'
import { getLargeDiffRenderLimit } from '../../large-diff-render-limit'
import { getStoredTextDiffContent, getStoredTextDiffResult } from '../../large-diff-section-content'
import { removeDiffSectionMeasuredHeight } from '../../diff-section-height-cache'
import { combinedDiffSectionDiskPrecondition } from '../../working-file-diff-disk-baseline'
import { discardSectionEdits, notifySectionSaveRefused } from './combined-diff-section-save-refusal'
import type { DiffSection } from '../../diff-section-types'
import type { DiffSectionItemProps } from '../../diff-section-item-props'

export type CombinedDiffSectionActions = {
  handleSectionSaveRef: DiffSectionItemProps['handleSectionSaveRef']
  modifiedEditorsRef: DiffSectionItemProps['modifiedEditorsRef']
  openSection: (index: number) => void
  openSectionPreview: (section: DiffSection) => void
}

export function useCombinedDiffSectionActions({
  activeGroupId,
  branchCompare,
  canOpenWorkspaceFileBrowserForPath,
  commitCompare,
  file,
  isAllMode,
  isBranchMode,
  isCommitMode,
  sections,
  sectionsRef,
  setSectionHeights,
  setSections,
  requestSectionReload
}: {
  activeGroupId: string | undefined
  branchCompare: NonNullable<OpenFile['branchCompare']> | null
  canOpenWorkspaceFileBrowserForPath: (path: string) => boolean
  commitCompare: NonNullable<OpenFile['commitCompare']> | null
  file: OpenFile
  isAllMode: boolean
  isBranchMode: boolean
  isCommitMode: boolean
  sections: DiffSection[]
  sectionsRef: React.RefObject<DiffSection[]>
  setSectionHeights: React.Dispatch<React.SetStateAction<Record<number, number>>>
  setSections: React.Dispatch<React.SetStateAction<DiffSection[]>>
  requestSectionReload: (index: number) => void
}): CombinedDiffSectionActions {
  const openFile = useAppStore((s) => s.openFile)
  const openBranchDiff = useAppStore((s) => s.openBranchDiff)
  const openCommitDiff = useAppStore((s) => s.openCommitDiff)
  const modifiedEditorsRef = useRef<Map<number, monacoEditor.IStandaloneCodeEditor>>(new Map())

  const openSection = useCallback(
    (index: number) => {
      const section = sectionsRef.current[index]
      if (!section) {
        return
      }

      const language = detectLanguage(section.path)
      const entry: GitBranchChangeEntry = {
        path: section.path,
        status: section.status as GitBranchChangeEntry['status'],
        oldPath: section.oldPath,
        added: section.added,
        removed: section.removed
      }

      const isBranchEntry = section.area === undefined

      if ((isBranchMode || (isAllMode && isBranchEntry)) && branchCompare) {
        openBranchDiff(file.worktreeId, file.filePath, entry, branchCompare, language)
        return
      }

      if (isCommitMode && commitCompare) {
        openCommitDiff(file.worktreeId, file.filePath, entry, commitCompare, language)
        return
      }

      openFile({
        filePath: joinPath(file.filePath, section.path),
        relativePath: section.path,
        worktreeId: file.worktreeId,
        runtimeEnvironmentId: file.runtimeEnvironmentId,
        language,
        mode: 'edit'
      })
    },
    [
      branchCompare,
      commitCompare,
      file.filePath,
      file.runtimeEnvironmentId,
      file.worktreeId,
      isAllMode,
      isBranchMode,
      isCommitMode,
      openBranchDiff,
      openCommitDiff,
      openFile,
      sectionsRef
    ]
  )

  // Why: match single-file HTML diffs — preview the on-disk working tree file
  // beside the combined view when the section is still present on disk.
  const openSectionPreview = useCallback(
    (section: DiffSection) => {
      if (
        !canOpenDiffSectionPreviewToSide({
          path: section.path,
          status: section.status,
          isCommitSurface: isCommitMode,
          canOpenWorkspaceFileBrowser: canOpenWorkspaceFileBrowserForPath(
            joinPath(file.filePath, section.path)
          )
        })
      ) {
        return
      }
      // Why: use this combined-diff tab's group, not worktree activeGroupId —
      // in a multi-pane layout the active group may be a different split.
      const state = useAppStore.getState()
      const sourceGroupId =
        (state.unifiedTabsByWorktree[file.worktreeId] ?? []).find(
          (tab) =>
            tab.entityId === file.id && (tab.contentType === 'diff' || tab.contentType === 'editor')
        )?.groupId ??
        activeGroupId ??
        null
      openFilePreviewToSide({
        language: detectLanguage(section.path),
        filePath: joinPath(file.filePath, section.path),
        worktreeId: file.worktreeId,
        sourceGroupId
      })
    },
    [
      activeGroupId,
      canOpenWorkspaceFileBrowserForPath,
      file.filePath,
      file.id,
      file.worktreeId,
      isCommitMode
    ]
  )

  const writeSection = useCallback(
    async (section: DiffSection, content: string, overwriteDisk: boolean): Promise<void> => {
      const sectionKey = section.key
      const absolutePath = joinPath(file.filePath, section.path)
      try {
        const state = useAppStore.getState()
        const worktree = file.worktreeId
          ? findWorktreeById(state.worktreesByRepo, file.worktreeId)
          : null
        const writeResult = await writeRuntimeFile(
          getEditorFileOperationContext(
            state,
            {
              worktreeId: file.worktreeId,
              runtimeEnvironmentId: file.runtimeEnvironmentId,
              operationProvenance: file.operationProvenance
            },
            worktree?.path ?? null
          ),
          absolutePath,
          content,
          undefined,
          overwriteDisk ? undefined : combinedDiffSectionDiskPrecondition(section)
        )
        if (!writeResult.ok) {
          // Why by key from live state: the list may be reordered or shrunk before the user clicks.
          const currentIndex = (): number =>
            sectionsRef.current.findIndex((s) => s.key === sectionKey)
          notifySectionSaveRefused(writeResult.diskConflict, {
            overwrite: () => {
              const current = sectionsRef.current[currentIndex()]
              // The draft lives in section state; position-keyed editors can belong to another row by now.
              if (current?.dirty) {
                void writeSectionRef.current(current, current.modifiedContent, true)
              }
            },
            reload: () => {
              discardSectionEdits(setSections, sectionKey)
              // Why: after the clean state commits, or the reload skips the still-dirty section.
              window.setTimeout(() => {
                const i = currentIndex()
                if (i !== -1) {
                  requestSectionReload(i)
                }
              }, 0)
            }
          })
          return
        }
        // Why: the section list can be rebuilt while the write is pending, so re-resolve
        // by key — the captured index may now point at a different file.
        const savedIndex = sectionsRef.current.findIndex((s) => s.key === sectionKey)
        if (savedIndex === -1) {
          return
        }
        setSectionHeights((prev) => removeDiffSectionMeasuredHeight(prev, savedIndex))
        setSections((prev) =>
          prev.map((s) => {
            if (s.key !== sectionKey) {
              return s
            }

            if (s.diffResult?.kind !== 'text') {
              return {
                ...s,
                modifiedContent: content,
                dirty: false,
                largeDiffRenderLimit: s.largeDiffRenderLimit
              }
            }

            const nextDiffResult = { ...s.diffResult, modifiedContent: content }
            const nextLargeDiffRenderLimit = getLargeDiffRenderLimit({
              originalContent: s.originalContent,
              modifiedContent: content
            })
            const storedContent = getStoredTextDiffContent(nextDiffResult, nextLargeDiffRenderLimit)

            return {
              ...s,
              modifiedContent: storedContent.modifiedContent,
              originalContent: storedContent.originalContent,
              dirty: false,
              diffResult: getStoredTextDiffResult(nextDiffResult, nextLargeDiffRenderLimit),
              largeDiffRenderLimit: nextLargeDiffRenderLimit
            }
          })
        )
      } catch (err) {
        console.error('Save failed:', err)
      }
    },
    [
      file.filePath,
      file.operationProvenance,
      file.runtimeEnvironmentId,
      file.worktreeId,
      sectionsRef,
      setSectionHeights,
      setSections,
      requestSectionReload
    ]
  )
  const writeSectionRef = useRef(writeSection)
  writeSectionRef.current = writeSection

  const handleSectionSave = useCallback(
    async (index: number): Promise<void> => {
      const section = sections[index]
      if (!section) {
        return
      }
      const modifiedEditor = modifiedEditorsRef.current.get(index)
      if (!modifiedEditor && !section.dirty) {
        return
      }
      await writeSection(section, modifiedEditor?.getValue() ?? section.modifiedContent, false)
    },
    [sections, writeSection]
  )

  const handleSectionSaveRef = useRef(handleSectionSave)
  handleSectionSaveRef.current = handleSectionSave

  return { handleSectionSaveRef, modifiedEditorsRef, openSection, openSectionPreview }
}
