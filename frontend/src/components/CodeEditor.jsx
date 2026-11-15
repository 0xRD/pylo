import { useEffect, useRef } from 'react'
import Editor, { DiffEditor, loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor/editor/editor.api'
import editorWorker from 'monaco-editor/editor/editor.worker?worker'
import 'monaco-editor/languages/definitions/python/register'

globalThis.MonacoEnvironment = {
  getWorker() {
    return new editorWorker()
  },
}

loader.config({ monaco })

const BASE_OPTIONS = {
  minimap: { enabled: false },
  fontSize: 13,
  scrollBeyondLastLine: false,
  automaticLayout: true,
  padding: { top: 12 },
}

/**
 * Python editor. Optional keyboard shortcuts: Ctrl/Cmd+S -> onSave,
 * Ctrl/Cmd+Enter -> onRun. onCursor receives { line, column }.
 */
export default function CodeEditor({ value, onChange, readOnly = false, height = '400px', onSave, onRun, onCursor }) {
  // Monaco commands are registered once on mount; refs keep the latest callbacks.
  const handlers = useRef({})
  handlers.current = { onSave, onRun, onCursor }

  const handleMount = (editor) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => handlers.current.onSave?.())
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => handlers.current.onRun?.())
    editor.onDidChangeCursorPosition(e => handlers.current.onCursor?.({ line: e.position.lineNumber, column: e.position.column }))
  }

  return (
    <Editor
      height={height}
      defaultLanguage="python"
      theme="vs-dark"
      value={value}
      onChange={onChange}
      onMount={handleMount}
      options={{
        ...BASE_OPTIONS,
        readOnly,
        lineNumbers: 'on',
        wordWrap: 'on',
        renderWhitespace: 'selection',
        bracketPairColorization: { enabled: true },
        stickyScroll: { enabled: true },
      }}
    />
  )
}

/** Read-only side-by-side (or inline) diff of two Python scripts. */
export function CodeDiff({ original, modified, height = '100%', inline = false }) {
  // keepCurrent*Model below stops the wrapper from disposing the models, so we
  // do it ourselves once the diff widget itself has been torn down.
  const models = useRef(null)
  useEffect(() => () => {
    const m = models.current
    setTimeout(() => { m?.original?.dispose(); m?.modified?.dispose() }, 0)
  }, [])

  return (
    <DiffEditor
      onMount={editor => { models.current = editor.getModel() }}
      height={height}
      language="python"
      theme="vs-dark"
      original={original}
      modified={modified}
      // The wrapper disposes models before the widget, which throws "TextModel
      // got disposed before DiffEditorWidget model got reset" on unmount.
      keepCurrentOriginalModel
      keepCurrentModifiedModel
      options={{
        ...BASE_OPTIONS,
        readOnly: true,
        originalEditable: false,
        renderSideBySide: !inline,
        useInlineViewWhenSpaceIsLimited: true,
        hideUnchangedRegions: { enabled: true },
      }}
    />
  )
}
