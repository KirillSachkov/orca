import type { editor } from 'monaco-editor'
import { getConnectionIdForFile } from '@/lib/connection-context'
import { editorModelRegistry } from '@/lib/editor-model-registry'
import { editorTabFileAccess } from '@/lib/local-file-access'
import { getRuntimeTargetForFileOwner } from '@/lib/file-owner-runtime-target'
import { readRuntimeFileContent } from '@/runtime/runtime-file-read-client'
import { useAppStore } from '@/store'
import type { OpenFile } from '@/store/slices/editor'
import { getDiskBaselineSignature } from './diff-content-signature'
import { ORCA_EDITOR_FILE_RELOADED_EVENT, type EditorFileSavedDetail } from './editor-autosave'
import { getDiskChangeRevision } from './editor-changed-on-disk-mark'
import { getEditorModelOwnerKey } from './editor-model-owner'
import {
  consentToDiskOverwrite,
  forgetDiskConflict,
  noteEditorModelSynced,
  stampEditorModelDiskBaseline
} from './editor-model-disk-baseline'
import { toEditorModelUri } from './editor-model-uri'
import { replaceModelContentAsUndoStep } from './monaco-content-sync'
import {
  beginProgrammaticContentSync,
  endProgrammaticContentSync
} from './monaco-programmatic-sync'
import { watchReloadUndoBoundary } from './reload-undo-autosave-pause'

type AppState = ReturnType<typeof useAppStore.getState>

async function readTabTextFromDisk(file: OpenFile): Promise<string | null> {
  const state = useAppStore.getState()
  const target = getRuntimeTargetForFileOwner(state, file.worktreeId, file.runtimeEnvironmentId)
  if (!target) {
    return null
  }
  const result = await readRuntimeFileContent({
    target,
    filePath: file.filePath,
    relativePath: file.relativePath,
    worktreeId: file.worktreeId,
    connectionId: getConnectionIdForFile(file.worktreeId, file.filePath) ?? undefined,
    expectedExternalSshTargetId: file.externalSshTargetId,
    access: editorTabFileAccess(state, file)
  })
  return result.isBinary ? null : result.content
}

function findLiveFile(state: AppState, fileId: string): OpenFile | undefined {
  return state.openFiles.find((openFile) => openFile.id === fileId)
}

type MountedEditModel = { model: editor.ITextModel; modelKey: string }

/** The edit tab's Monaco model, only while a code editor shows it — the only place Cmd+Z reaches. */
export function getMountedEditModel(file: OpenFile, state: AppState): MountedEditModel | null {
  const registry = editorModelRegistry.get()
  if (file.mode !== 'edit' || !registry) {
    return null
  }
  const modelKey = toEditorModelUri(file.filePath, getEditorModelOwnerKey(file, state))
  const model = registry.editor.getModel(registry.Uri.parse(modelKey))
  return model && !model.isDisposed() && model.isAttachedToEditor() ? { model, modelKey } : null
}

export type MountedReloadResult = 'applied' | 'superseded' | 'unavailable'

/**
 * Reload into the mounted model as one undoable edit. Anything that moved the text or disk while
 * the read was in flight supersedes it, and the banner stays.
 */
export async function reloadMountedModelFromDisk(
  file: OpenFile,
  { model, modelKey }: MountedEditModel
): Promise<MountedReloadResult> {
  const versionAtClick = model.getVersionId()
  const diskRevisionAtClick = getDiskChangeRevision(file.id)
  const content = await readTabTextFromDisk(file)
  const state = useAppStore.getState()
  const liveFile = findLiveFile(state, file.id)
  if (content === null) {
    return 'unavailable'
  }
  if (
    liveFile?.externalMutation !== 'changed' ||
    getMountedEditModel(liveFile, state)?.model !== model ||
    model.getVersionId() !== versionAtClick ||
    // Why: a write during the read only re-marks an already-marked tab, so the read may be stale.
    getDiskChangeRevision(file.id) !== diskRevisionAtClick
  ) {
    return 'superseded'
  }
  // Why: one shared model serves every split pane; the in-flight mark makes each pane's
  // bridge treat the edit as programmatic instead of a keystroke.
  beginProgrammaticContentSync(modelKey)
  try {
    replaceModelContentAsUndoStep(model, content)
  } finally {
    endProgrammaticContentSync(modelKey)
  }
  // Why: panels adopt the new text before the draft clears, so no render falls back to stale content.
  window.dispatchEvent(
    new CustomEvent<EditorFileSavedDetail>(ORCA_EDITOR_FILE_RELOADED_EVENT, {
      detail: { fileId: file.id, content }
    })
  )
  const reloadSignature = getDiskBaselineSignature(content)
  // Why the model's stamp: its text and the disk version it is based on move together; Cmd+Z
  // back to the edits keeps that version, so a save over a newer write is still refused.
  noteEditorModelSynced(file.id, model.getValue())
  stampEditorModelDiskBaseline(file.id, model, reloadSignature)
  state.setLastKnownDiskSignature(file.id, reloadSignature)
  state.clearEditorDraft(file.id)
  state.markFileDirty(file.id, false)
  state.setExternalMutation(file.id, null)
  watchReloadUndoBoundary(model, modelKey)
  return 'applied'
}

/** Surfaces without a mounted Monaco model: drop the draft and refetch. Not undoable. */
export function discardDraftAndReloadContent(
  file: OpenFile,
  reloadContent: (file: OpenFile) => void
): void {
  const state = useAppStore.getState()
  forgetDiskConflict(file.id)
  // Why: the draft shadows loaded content (editBuffers ?? fileContents), so it must go first.
  state.clearEditorDraft(file.id)
  state.markFileDirty(file.id, false)
  state.setExternalMutation(file.id, null)
  state.setAutosavePausedAfterReloadUndo([file.id], false)
  reloadContent(file)
}

/**
 * Keep My Edits, decided now: the tab's next save overwrites the disk version the user saw (the
 * compare dialog's text, else the version a refused save reported), and is refused if disk has
 * changed again since. With no known version, that next save overwrites once.
 */
export function keepTabEditsOverExternalChange(file: OpenFile, seenDiskContent?: string): void {
  const state = useAppStore.getState()
  const adopted = consentToDiskOverwrite(
    file.id,
    seenDiskContent === undefined ? undefined : getDiskBaselineSignature(seenDiskContent)
  )
  if (adopted !== undefined) {
    // Why the store too: the restart conflict scan and a draft without a model read it.
    state.setLastKnownDiskSignature(file.id, adopted)
  }
  state.setExternalMutation(file.id, null)
}
