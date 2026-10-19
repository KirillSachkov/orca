import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { applyDiffSectionLiveEdit } from './diff-section-live-edit'
import type { DiffOnMount } from '@monaco-editor/react'
import type { editor as monacoEditor } from 'monaco-editor'
import { detectLanguage } from '@/lib/language-detect'
import { useAppStore } from '@/store'
import { computeDiffEditorFontSize, resolveEditorFontFamily } from '@/lib/editor-font-zoom'
import { selectWorktreeDiffComments } from '@/store/worktree-diff-comments-selector'
import { useDiffCommentDecorator } from '../diff-comments/useDiffCommentDecorator'
import { applyDiffEditorLineNumberOptions } from './diff-editor-line-number-options'
import { DiffSectionHeader } from './DiffSectionHeader'
import type { DiffComment } from '../../../../shared/diff-comment-types'
import { isDiffComment } from '@/lib/diff-comment-compat'
import { installEditorSaveShortcut, installMonacoEditorFindShortcut } from './editor-shortcuts'
import { DiffSectionBody } from './DiffSectionBody'
import { useDiffSectionLayoutMetrics } from './useDiffSectionLayoutMetrics'
import { getLiveDiffSectionRenderLimit } from './diff-section-live-render-limit'
import { useDiffSectionFallbackCleanup } from './useDiffSectionFallbackCleanup'
import { submitDiffSectionComment } from './diff-section-comment-submit'
import type { DiffSectionItemProps } from './diff-section-item-props'
import { useDiffSectionModelLifecycle } from './use-diff-section-model-lifecycle'

export function DiffSectionItem({
  section,
  index,
  isBranchMode,
  sideBySide,
  isDark,
  settings,
  sectionHeight,
  worktreeId,
  loadSection,
  loadDeferredSection,
  retrySection,
  toggleSection,
  openSection,
  openSectionTitle,
  onOpenPreview,
  renderHeaderTrailingContent,
  onAddLineComment,
  addLineCommentLabel,
  addLineCommentPlaceholder,
  inlineComments,
  getCommentableLineNumbers,
  setSectionHeights,
  setSections,
  modifiedEditorsRef,
  handleSectionSaveRef
}: DiffSectionItemProps): React.JSX.Element {
  const editorFontZoomLevel = useAppStore((s) => s.editorFontZoomLevel)
  const addDiffComment = useAppStore((s) => s.addDiffComment)
  const deleteDiffComment = useAppStore((s) => s.deleteDiffComment)
  const updateDiffComment = useAppStore((s) => s.updateDiffComment)
  const scrollToDiffCommentId = useAppStore((s) => s.scrollToDiffCommentId)
  const setScrollToDiffCommentId = useAppStore((s) => s.setScrollToDiffCommentId)
  // Why: subscribe to the raw comments array on the worktree (reference-
  // stable across unrelated store updates) and filter by filePath inside a
  // memo. Selecting a fresh `.filter(...)` result would invalidate on every
  // store change and cause needless re-renders of this section.
  const allDiffComments = useAppStore((s): DiffComment[] | undefined =>
    selectWorktreeDiffComments(s, worktreeId)
  )
  const diffComments = useMemo(
    () => (allDiffComments ?? []).filter((c) => c.filePath === section.path && isDiffComment(c)),
    [allDiffComments, section.path]
  )
  const language = detectLanguage(section.path)
  const isEditable = section.area === 'unstaged'
  const modelPathBase = useMemo(
    () =>
      `diff-section:${encodeURIComponent(worktreeId ?? 'review')}:${encodeURIComponent(section.key)}:${section.contentGeneration ?? 0}`,
    [section.contentGeneration, section.key, worktreeId]
  )
  const diffEditorFontSize = computeDiffEditorFontSize(
    settings?.terminalFontSize ?? 13,
    editorFontZoomLevel
  )

  const [modifiedEditor, setModifiedEditor] = useState<monacoEditor.ICodeEditor | null>(null)
  // Why: the model is swapped per contentGeneration without remounting, so each model remembers the
  // generation it was created for; edits from a superseded model are ignored.
  const contentGenerationRef = useRef(section.contentGeneration ?? 0)
  contentGenerationRef.current = section.contentGeneration ?? 0
  const modelGenerationsRef = useRef(new WeakMap<monacoEditor.ITextModel, number>())
  const labelModelGeneration = (
    model: monacoEditor.ITextModel | null,
    generation: number
  ): void => {
    // Only the first label sticks: an old model must keep its generation if the swap lands later.
    if (model && !modelGenerationsRef.current.has(model)) {
      modelGenerationsRef.current.set(model, generation)
    }
  }
  useEffect(() => {
    labelModelGeneration(modifiedEditor?.getModel() ?? null, section.contentGeneration ?? 0)
  }, [modifiedEditor, section.contentGeneration])
  const diffEditorRef = useRef<monacoEditor.IStandaloneDiffEditor | null>(null)
  const lineNumberOptionsSubRef = useRef<{ dispose: () => void } | null>(null)
  const hasLineCommentAction = Boolean(worktreeId || onAddLineComment)

  const { disposeDiffModels, setSectionRootNode } = useDiffSectionModelLifecycle({
    modelPathBase,
    collapsed: section.collapsed
  })

  const { lineStats, sectionBodyHeight, useIntrinsicImageHeight, isLargeDiffLimited } =
    useDiffSectionLayoutMetrics({
      section,
      sectionHeight
    })

  // Why: only forward the pending scroll id when it matches a comment in this
  // section so unrelated sections don't keep re-rendering their decorator
  // every time the sidebar requests a scroll elsewhere.
  const pendingScrollForThisSection = useMemo(() => {
    if (!scrollToDiffCommentId) {
      return null
    }
    return diffComments.some((c) => c.id === scrollToDiffCommentId) ? scrollToDiffCommentId : null
  }, [scrollToDiffCommentId, diffComments])

  const handleCreateComment = useCallback(
    async ({
      lineNumber,
      startLine,
      body
    }: {
      lineNumber: number
      startLine?: number
      body: string
    }): Promise<boolean> => {
      return submitDiffSectionComment({
        addDiffComment,
        body,
        onAddLineComment,
        target: { lineNumber, startLine },
        section,
        worktreeId
      })
    },
    [addDiffComment, onAddLineComment, section, worktreeId]
  )

  useDiffCommentDecorator({
    editor: hasLineCommentAction ? modifiedEditor : null,
    monacoModelIdentity: `${modelPathBase}:modified`,
    filePath: section.path,
    worktreeId: worktreeId ?? '',
    comments: inlineComments ?? (worktreeId ? diffComments : []),
    commentableLineNumbers: getCommentableLineNumbers?.(section),
    addButtonLabel: addLineCommentLabel,
    addNoteShortcutEnabled: hasLineCommentAction,
    onCreateComment: handleCreateComment,
    draftPlaceholder: addLineCommentPlaceholder,
    draftSubmitLabel: addLineCommentLabel,
    canOpenDraft: !isLargeDiffLimited,
    onDeleteComment: (id) => {
      if (worktreeId) {
        void deleteDiffComment(worktreeId, id)
      }
    },
    onUpdateComment: worktreeId ? (id, body) => updateDiffComment(worktreeId, id, body) : undefined,
    pendingScrollCommentId: pendingScrollForThisSection,
    onPendingScrollConsumed: () => setScrollToDiffCommentId(null)
  })

  useEffect(() => {
    const diffEditor = diffEditorRef.current
    if (!diffEditor) {
      return
    }
    lineNumberOptionsSubRef.current?.dispose()
    lineNumberOptionsSubRef.current = applyDiffEditorLineNumberOptions(diffEditor, sideBySide)
    return () => {
      lineNumberOptionsSubRef.current?.dispose()
      lineNumberOptionsSubRef.current = null
    }
  }, [sideBySide])

  useDiffSectionFallbackCleanup({
    disposeDiffModels,
    index,
    isLargeDiffLimited,
    setSectionHeights
  })

  const handleMount: DiffOnMount = (editor, _monaco) => {
    diffEditorRef.current = editor
    lineNumberOptionsSubRef.current?.dispose()
    lineNumberOptionsSubRef.current = applyDiffEditorLineNumberOptions(editor, sideBySide)
    const modified = editor.getModifiedEditor()

    // Why: measuring before Monaco computes hidden unchanged regions records
    // full-file height, making virtualized combined diffs jump as rows remount.
    let diffLayoutReady = false
    let pendingHeightFrame: number | null = null
    const updateHeight = (): void => {
      const contentHeight = editor.getModifiedEditor().getContentHeight()
      setSectionHeights((prev) => {
        if (prev[index] === contentHeight) {
          return prev
        }
        return { ...prev, [index]: contentHeight }
      })
    }
    const requestHeightUpdate = (): void => {
      if (pendingHeightFrame !== null) {
        return
      }
      pendingHeightFrame = window.requestAnimationFrame(() => {
        pendingHeightFrame = null
        updateHeight()
      })
    }
    const markDiffLayoutReady = (): void => {
      diffLayoutReady = true
      requestHeightUpdate()
    }
    const contentSizeSub = modified.onDidContentSizeChange(() => {
      if (diffLayoutReady) {
        requestHeightUpdate()
      }
    })
    const diffUpdateSub = editor.onDidUpdateDiff(markDiffLayoutReady)
    if (editor.getLineChanges() !== null) {
      markDiffLayoutReady()
    }

    setModifiedEditor(modified)
    // Why: Monaco disposes inner editors when the DiffEditor container is
    // unmounted (e.g. section collapse, tab change). Clearing the state
    // prevents decorator effects and scroll subscriptions from invoking
    // methods on a disposed editor instance, and avoids stale draft state pointing
    // at a line in an editor that no longer exists.
    modified.onDidDispose(() => {
      contentSizeSub.dispose()
      diffUpdateSub.dispose()
      if (pendingHeightFrame !== null) {
        window.cancelAnimationFrame(pendingHeightFrame)
        pendingHeightFrame = null
      }
      lineNumberOptionsSubRef.current?.dispose()
      lineNumberOptionsSubRef.current = null
      diffEditorRef.current = null
      if (modifiedEditorsRef.current.get(index) === modified) {
        modifiedEditorsRef.current.delete(index)
      }
      setModifiedEditor(null)
    })

    if (!isEditable) {
      return
    }

    modifiedEditorsRef.current.set(index, modified)
    const original = editor.getOriginalEditor()
    const cleanupSaveShortcut = installEditorSaveShortcut(modified.getContainerDomNode(), () =>
      handleSectionSaveRef.current(index)
    )
    const cleanupOriginalFindShortcut = installMonacoEditorFindShortcut(original)
    const cleanupModifiedFindShortcut = installMonacoEditorFindShortcut(modified)
    const sectionKey = section.key
    labelModelGeneration(modified.getModel(), contentGenerationRef.current)
    const modelContentSub = modified.onDidChangeModelContent(() => {
      const current = modified.getValue()
      const model = modified.getModel()
      const editedGeneration = model ? modelGenerationsRef.current.get(model) : undefined
      setSections((prev) =>
        applyDiffSectionLiveEdit(prev, {
          index,
          sectionKey,
          editedGeneration,
          content: current,
          renderLimit: (s) =>
            getLiveDiffSectionRenderLimit({
              section: s,
              modifiedEditor: modified,
              modifiedContent: current
            })
        })
      )
    })
    modified.onDidDispose(() => {
      // Why: editable diff sections own both panes' shortcut bridges and the
      // model subscription for the lifetime of this Monaco diff instance.
      cleanupSaveShortcut()
      cleanupOriginalFindShortcut()
      cleanupModifiedFindShortcut()
      modelContentSub.dispose()
    })
  }

  useEffect(() => {
    loadSection(index)
  }, [index, loadSection])

  return (
    <div ref={setSectionRootNode} className="border-b border-border">
      <DiffSectionHeader
        path={section.path}
        dirty={section.dirty}
        collapsed={section.collapsed}
        added={lineStats?.added ?? section.added ?? 0}
        removed={lineStats?.removed ?? section.removed ?? 0}
        onToggle={() => toggleSection(index)}
        onOpenSection={(event) => {
          event.stopPropagation()
          openSection(index)
        }}
        openSectionTitle={openSectionTitle}
        onOpenPreview={
          onOpenPreview
            ? () => {
                onOpenPreview(section, index)
              }
            : undefined
        }
        trailingContent={renderHeaderTrailingContent?.(section, index)}
      />

      {!section.collapsed && (
        <DiffSectionBody
          section={section}
          index={index}
          sectionBodyHeight={sectionBodyHeight}
          useIntrinsicImageHeight={useIntrinsicImageHeight}
          isBranchMode={isBranchMode}
          sideBySide={sideBySide}
          isDark={isDark}
          language={language}
          modelPathBase={modelPathBase}
          isEditable={isEditable}
          diffEditorFontSize={diffEditorFontSize}
          diffWordWrap={settings?.diffWordWrap}
          diffShowWhitespace={settings?.diffShowWhitespace}
          editorFontFamily={resolveEditorFontFamily(settings)}
          onRetrySection={retrySection}
          onLoadDeferredSection={loadDeferredSection ?? loadSection}
          onSaveLimitedDiff={() => void handleSectionSaveRef.current(index)}
          onMount={handleMount}
        />
      )}
    </div>
  )
}
