import React, { useRef, useEffect } from 'react';
import Editor, { DiffEditor, OnMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';

interface MonacoEditorProps {
  /** The code content to display */
  value: string;
  /** Programming language for syntax highlighting */
  language: string;
  /** Whether the editor is read-only */
  readOnly?: boolean;
  /** Callback when content changes */
  onChange?: (value: string | undefined) => void;
  /** Height of the editor */
  height?: string;
  /** Theme: 'light' or 'dark' */
  theme?: 'light' | 'dark';
  /** Line number to highlight */
  highlightLine?: number;
  /** Whether to show minimap */
  showMinimap?: boolean;
  /** Custom options */
  options?: editor.IStandaloneEditorConstructionOptions;
}

const MonacoEditor: React.FC<MonacoEditorProps> = ({
  value,
  language,
  readOnly = false,
  onChange,
  height = '400px',
  theme = 'dark',
  highlightLine,
  showMinimap = true,
  options = {},
}) => {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  const handleEditorDidMount: OnMount = (editor) => {
    editorRef.current = editor;

    // If highlightLine is provided, scroll to and highlight that line
    if (highlightLine) {
      editor.revealLineInCenter(highlightLine);
      editor.setSelection({
        startLineNumber: highlightLine,
        startColumn: 1,
        endLineNumber: highlightLine,
        endColumn: Number.MAX_VALUE,
      });
    }
  };

  // Cleanup: Properly dispose of the editor when component unmounts
  useEffect(() => {
    return () => {
      if (editorRef.current) {
        try {
          // Get the model before disposing
          const model = editorRef.current.getModel();

          // Dispose the editor first
          editorRef.current.dispose();

          // Then dispose the model if it exists
          model?.dispose();

          editorRef.current = null;
        } catch (error) {
          // Silently handle disposal errors to prevent console spam
          console.debug('Monaco editor disposal cleanup:', error);
        }
      }
    };
  }, []);

  const editorOptions: editor.IStandaloneEditorConstructionOptions = {
    readOnly,
    minimap: { enabled: showMinimap },
    scrollBeyondLastLine: false,
    fontSize: 13,
    lineNumbers: 'on',
    renderWhitespace: 'selection',
    automaticLayout: true,
    wordWrap: 'on',
    wrappingIndent: 'indent',
    folding: true,
    lineDecorationsWidth: 10,
    lineNumbersMinChars: 4,
    ...options,
  };

  return (
    <div className="monaco-editor-wrapper">
      <Editor
        height={height}
        language={language}
        value={value}
        theme={theme === 'dark' ? 'vs-dark' : 'vs-light'}
        options={editorOptions}
        onChange={onChange}
        onMount={handleEditorDidMount}
      />
    </div>
  );
};

export default MonacoEditor;
