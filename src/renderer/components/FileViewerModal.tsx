import React, { useState, useEffect } from 'react';
import MonacoEditor from './MonacoEditor';

interface FileViewerModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** File path to display */
  filePath: string;
  /** Line number to highlight */
  lineNumber?: number;
  /** Callback to close the modal */
  onClose: () => void;
}

const FileViewerModal: React.FC<FileViewerModalProps> = ({
  isOpen,
  filePath,
  lineNumber,
  onClose,
}) => {
  const [fileContent, setFileContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load file content when modal opens or filePath changes
  useEffect(() => {
    if (!isOpen || !filePath) return;

    const loadFile = async () => {
      setLoading(true);
      setError(null);

      try {
        // Request file content from main process
        const content = await window.electronAPI.readFile(filePath);
        setFileContent(content);
      } catch (err) {
        setError(`Failed to load file: ${err instanceof Error ? err.message : 'Unknown error'}`);
        setFileContent('');
      } finally {
        setLoading(false);
      }
    };

    loadFile();
  }, [isOpen, filePath]);

  // Detect language from file extension
  const getLanguageFromPath = (path: string): string => {
    const fileName = path.split(/[/\\]/).pop() || path;
    const ext = fileName.split('.').pop()?.toLowerCase() || 'text';

    const languageMap: Record<string, string> = {
      'ts': 'typescript',
      'tsx': 'typescript',
      'js': 'javascript',
      'jsx': 'javascript',
      'py': 'python',
      'rs': 'rust',
      'go': 'go',
      'java': 'java',
      'c': 'c',
      'cpp': 'cpp',
      'h': 'c',
      'hpp': 'cpp',
      'cs': 'csharp',
      'php': 'php',
      'rb': 'ruby',
      'swift': 'swift',
      'kt': 'kotlin',
      'json': 'json',
      'xml': 'xml',
      'html': 'html',
      'css': 'css',
      'scss': 'scss',
      'md': 'markdown',
      'sql': 'sql',
      'sh': 'shell',
      'bash': 'shell',
      'yaml': 'yaml',
      'yml': 'yaml',
    };

    return languageMap[ext] || 'plaintext';
  };

  // Get file name for display
  const fileName = filePath.split(/[/\\]/).pop() || filePath;
  const language = getLanguageFromPath(filePath);
  const theme = document.body.getAttribute('data-theme') === 'light' ? 'light' : 'dark';

  // Close on Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="file-viewer-modal-overlay" onClick={onClose}>
      <div className="file-viewer-modal" onClick={(e) => e.stopPropagation()}>
        <div className="file-viewer-header">
          <div className="file-viewer-title">
            <span className="file-icon">📄</span>
            <span className="file-name">{fileName}</span>
            {lineNumber && <span className="line-indicator">Line {lineNumber}</span>}
          </div>
          <div className="file-viewer-actions">
            <button className="file-viewer-btn" onClick={onClose} title="Close (Esc)">
              ✕
            </button>
          </div>
        </div>

        <div className="file-viewer-content">
          {loading && (
            <div className="file-viewer-loading">
              <div className="loading-spinner"></div>
              <span>Loading file...</span>
            </div>
          )}

          {error && (
            <div className="file-viewer-error">
              <span className="error-icon">⚠️</span>
              <span>{error}</span>
            </div>
          )}

          {!loading && !error && fileContent && (
            <MonacoEditor
              value={fileContent}
              language={language}
              theme={theme}
              readOnly={true}
              height="100%"
              highlightLine={lineNumber}
              showMinimap={true}
            />
          )}
        </div>

        <div className="file-viewer-footer">
          <div className="file-path-display">{filePath}</div>
        </div>
      </div>
    </div>
  );
};

export default FileViewerModal;
