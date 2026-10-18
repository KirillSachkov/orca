// Restored store images are checked only with affirmative execution-host ownership.

import { useEffect, useSyncExternalStore } from 'react'
import { useAppStore } from '@/store'
import { chatImageAccess } from '@/lib/local-file-access'
import { isAgentSessionAttachmentStorePath } from '../../../../shared/agent-session-attachments'
import type { NativeChatComposerDraftImage } from './native-chat-composer-draft-storage'
import {
  isKeptLocalPaste,
  resolveNativeChatComposerDraftOwner,
  structuredAgentSessionIdOfDraftScope,
  readNativeChatComposerDraft,
  isNativeChatComposerDraftUnverified,
  markNativeChatComposerDraftVerified,
  unavailableNativeChatComposerDraftImage,
  updateNativeChatComposerDraft
} from './native-chat-composer-draft-store'

/** Ids of images whose file is gone. One that cannot be checked (no read permission for that
 *  path, host not connected) counts as present: the send's own check still guards it. */
export async function findMissingNativeChatComposerDraftImages(
  images: readonly NativeChatComposerDraftImage[],
  localStoreImages = false
): Promise<Set<string>> {
  const api = typeof window === 'undefined' ? undefined : window.api
  const missing = new Set<string>()
  const checkable = images.filter((image) => image.unavailableName === undefined && image.path)
  const pastes = checkable.filter(isKeptLocalPaste)
  if (pastes.length > 0 && api?.ui?.restoreNativeChatPastes) {
    try {
      const restored = await api.ui.restoreNativeChatPastes(pastes.map(({ path }) => path))
      const kept = new Set(restored.filter((r) => r.kept && r.exists).map(({ path }) => path))
      pastes.filter(({ path }) => !kept.has(path)).forEach(({ id }) => missing.add(id))
    } catch {
      // Unknown, not gone.
    }
  }
  const pathExists = api?.fs?.pathExists
  if (!pathExists) {
    return missing
  }
  await Promise.all(
    checkable
      .filter(
        (image) =>
          !isKeptLocalPaste(image) &&
          (!isAgentSessionAttachmentStorePath(image.path) ||
            (localStoreImages && !image.connectionId))
      )
      .map(async (image) => {
        try {
          const exists = await pathExists({
            filePath: image.path,
            ...(isAgentSessionAttachmentStorePath(image.path) ? { access: chatImageAccess() } : {}),
            ...(image.connectionId ? { connectionId: image.connectionId } : {})
          })
          if (!exists) {
            missing.add(image.id)
          }
        } catch {
          // Unknown, not gone.
        }
      })
  )
  return missing
}

export function nativeChatComposerDraftStoreImagesAreLocal(scopeKey: string): boolean {
  const stored = readNativeChatComposerDraft(scopeKey).owner
  const current = resolveNativeChatComposerDraftOwner(scopeKey)
  return (
    structuredAgentSessionIdOfDraftScope(scopeKey) !== null &&
    (stored ?? current)?.executionHostId === 'local' &&
    (!current || current.executionHostId === 'local')
  )
}

const checking = new Set<string>()

/** Once per restored draft: an image whose file is gone comes back as one to attach again. */
export async function verifyRestoredNativeChatComposerDraftImages(scopeKey: string): Promise<void> {
  const localStoreImages = nativeChatComposerDraftStoreImagesAreLocal(scopeKey)
  const checkKey = `${scopeKey}:${localStoreImages}`
  if (!isNativeChatComposerDraftUnverified(scopeKey) || checking.has(checkKey)) {
    return
  }
  checking.add(checkKey)
  try {
    await replaceMissingImages(scopeKey, localStoreImages)
  } finally {
    checking.delete(checkKey)
    if (
      localStoreImages === nativeChatComposerDraftStoreImagesAreLocal(scopeKey) &&
      readNativeChatComposerDraft(scopeKey).images.every(
        (image) =>
          !isAgentSessionAttachmentStorePath(image.path) ||
          (localStoreImages && !image.connectionId)
      )
    ) {
      markNativeChatComposerDraftVerified(scopeKey)
    }
  }
}

async function replaceMissingImages(scopeKey: string, localStoreImages: boolean): Promise<void> {
  const checked = readNativeChatComposerDraft(scopeKey).images
  const missing = await findMissingNativeChatComposerDraftImages(checked, localStoreImages)
  if (
    missing.size === 0 ||
    localStoreImages !== nativeChatComposerDraftStoreImagesAreLocal(scopeKey)
  ) {
    return
  }
  const gone = new Set(checked.filter((image) => missing.has(image.id)).map(({ path }) => path))
  updateNativeChatComposerDraft(
    scopeKey,
    {
      images: readNativeChatComposerDraft(scopeKey).images.map((image) =>
        missing.has(image.id) && gone.has(image.path)
          ? unavailableNativeChatComposerDraftImage(image)
          : image
      )
    },
    'immediate'
  )
}

/** Whether the scope's restored images still wait on their check, which runs as they arrive: at
 *  mount, or later when the startup load or another window brings new ones. */
export function useRestoredNativeChatComposerDraftImageCheck(
  scopeKey: string,
  subscribe: (listener: () => void) => () => void
): { restoring: boolean; localStoreImages: boolean } {
  const restoring = useSyncExternalStore(subscribe, () =>
    isNativeChatComposerDraftUnverified(scopeKey)
  )
  const localStoreImages = useAppStore(() => nativeChatComposerDraftStoreImagesAreLocal(scopeKey))
  useEffect(() => {
    if (restoring) {
      void verifyRestoredNativeChatComposerDraftImages(scopeKey)
    }
  }, [scopeKey, restoring, localStoreImages])
  return { restoring, localStoreImages }
}
