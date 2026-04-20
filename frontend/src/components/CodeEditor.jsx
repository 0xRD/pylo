import Editor from '@monaco-editor/react'

export default function CodeEditor({ value, onChange, readOnly = false, height = '400px' }) {
  return (
    <Editor
      height={height}
      defaultLanguage="python"
      theme="vs-dark"
      value={value}
      onChange={onChange}
      options={{
        readOnly,
        minimap: { enabled: false },
        fontSize: 13,
        lineNumbers: 'on',
        scrollBeyondLastLine: false,
        wordWrap: 'on',
        automaticLayout: true,
        padding: { top: 12 },
      }}
    />
  )
}
