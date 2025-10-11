import React, { useState, useRef, useEffect } from 'react';
import { DiffEditor, OnMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';

interface DiffViewerProps {
  /** Original content (before changes) */
  original: string;
  /** Modified content (after changes) */
  modified: string;
  /** Programming language for syntax highlighting */
  language: string;
  /** File name/path to display */
  fileName?: string;
  /** Height of the diff viewer */
  height?: string;
  /** Theme: 'light' or 'dark' */
  theme?: 'light' | 'dark';
  /** Callback when user accepts changes */
  onAccept?: () => void;
  /** Callback when user rejects changes */
  onReject?: () => void;
  /** Whether to show action buttons */
  showActions?: boolean;
  /** View mode: 'inline' or 'split' */
  defaultViewMode?: 'inline' | 'split';
}

const DiffViewer: React.FC<DiffViewerProps> = ({
  original,
  modified,
  language,
  fileName,
  height = '500px',
  theme = 'dark',
  onAccept,
  onReject,
  showActions = true,
  defaultViewMode = 'split',
}) => {
  const [viewMode, setViewMode] = useState<'inline' | 'split'>(defaultViewMode);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const diffEditorRef = useRef<editor.IStandaloneDiffEditor | null>(null);

  const handleEditorDidMount: OnMount = (editor) => {
    diffEditorRef.current = editor as editor.IStandaloneDiffEditor;
  };

  // Cleanup: Properly dispose of the diff editor when component unmounts
  useEffect(() => {
    return () => {
      if (diffEditorRef.current) {
        try {
          // Get the models before disposing
          const model = diffEditorRef.current.getModel();

          // Dispose the editor first
          diffEditorRef.current.dispose();

          // Then dispose the models if they exist
          if (model) {
            model.original?.dispose();
            model.modified?.dispose();
          }

          diffEditorRef.current = null;
        } catch (error) {
          // Silently handle disposal errors to prevent console spam
          console.debug('DiffEditor disposal cleanup:', error);
        }
      }
    };
  }, []);

  const calculateStats = () => {
    const originalLines = original.split('\n');
    const modifiedLines = modified.split('\n');

    // Simple line-based diff stats
    const additions = modifiedLines.length - originalLines.length;
    const hasChanges = original !== modified;

    return {
      hasChanges,
      additions: additions > 0 ? additions : 0,
      deletions: additions < 0 ? Math.abs(additions) : 0,
      totalChanges: Math.abs(additions),
    };
  };

  const stats = calculateStats();

  const handleAccept = () => {
    onAccept?.();
  };

  const handleReject = () => {
    onReject?.();
  };

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  const editorOptions: editor.IStandaloneDiffEditorConstructionOptions = {
    readOnly: true,
    renderSideBySide: viewMode === 'split',
    minimap: { enabled: true },
    scrollBeyondLastLine: false,
    fontSize: 13,
    lineNumbers: 'on',
    renderWhitespace: 'selection',
    automaticLayout: true,
    wordWrap: 'on',
    enableSplitViewResizing: true,
    renderIndicators: true,
    originalEditable: false,
    diffWordWrap: 'on',
  };

  return (
    <div className={`diff-viewer ${isFullscreen ? 'fullscreen' : ''}`}>
      <div className="diff-viewer-header">
        <div className="diff-viewer-info">
          {fileName && <span className="diff-file-name">{fileName}</span>}
          {stats.hasChanges && (
            <div className="diff-stats">
              {stats.additions > 0 && (
                <span className="diff-stat additions">+{stats.additions}</span>
              )}
              {stats.deletions > 0 && (
                <span className="diff-stat deletions">-{stats.deletions}</span>
              )}
            </div>
          )}
        </div>

        <div className="diff-viewer-controls">
          <div className="view-mode-toggle">
            <button
              className={`view-mode-btn ${viewMode === 'split' ? 'active' : ''}`}
              onClick={() => setViewMode('split')}
              title="Side-by-side view"
            >
              Split
            </button>
            <button
              className={`view-mode-btn ${viewMode === 'inline' ? 'active' : ''}`}
              onClick={() => setViewMode('inline')}
              title="Inline view"
            >
              Inline
            </button>
          </div>

          <button
            className="fullscreen-btn"
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? '⊡' : '⛶'}
          </button>
        </div>
      </div>

      <div className="diff-viewer-content" style={{ height }}>
        <DiffEditor
          height="100%"
          language={language}
          original={original}
          modified={modified}
          theme={theme === 'dark' ? 'vs-dark' : 'vs-light'}
          options={editorOptions}
          onMount={handleEditorDidMount}
        />
      </div>

      {showActions && (
        <div className="diff-viewer-actions">
          {onReject && (
            <button className="btn outlined" onClick={handleReject}>
              Reject Changes
            </button>
          )}
          {onAccept && (
            <button className="btn primary" onClick={handleAccept}>
              Accept Changes
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default DiffViewer;
