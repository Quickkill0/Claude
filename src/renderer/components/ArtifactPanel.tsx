import React, { useState } from 'react';
import MonacoEditor from './MonacoEditor';
import { Artifact, ArtifactType } from '../../shared/types';

interface ArtifactPanelProps {
  artifacts: Artifact[];
  onClose?: () => void;
  theme?: 'light' | 'dark';
}

const ArtifactPanel: React.FC<ArtifactPanelProps> = ({
  artifacts,
  onClose,
  theme = 'dark',
}) => {
  const [selectedArtifactId, setSelectedArtifactId] = useState<string>(
    artifacts[0]?.id || ''
  );
  const [showVersionHistory, setShowVersionHistory] = useState(false);

  const selectedArtifact = artifacts.find(a => a.id === selectedArtifactId);

  if (!selectedArtifact) {
    return null;
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(selectedArtifact.content);
  };

  const handleDownload = () => {
    const blob = new Blob([selectedArtifact.content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedArtifact.title}.${getFileExtension(selectedArtifact.type, selectedArtifact.language)}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const getFileExtension = (type: ArtifactType, language: string): string => {
    if (type === 'code') {
      const extMap: Record<string, string> = {
        'typescript': 'ts',
        'javascript': 'js',
        'python': 'py',
        'rust': 'rs',
        'go': 'go',
        'java': 'java',
        'cpp': 'cpp',
        'csharp': 'cs',
      };
      return extMap[language] || 'txt';
    }
    if (type === 'html') return 'html';
    if (type === 'svg') return 'svg';
    if (type === 'mermaid') return 'mmd';
    if (type === 'react') return 'jsx';
    return 'md';
  };

  const renderArtifactContent = () => {
    switch (selectedArtifact.type) {
      case 'code':
        return (
          <MonacoEditor
            value={selectedArtifact.content}
            language={selectedArtifact.language}
            readOnly={true}
            height="100%"
            theme={theme}
            showMinimap={true}
          />
        );

      case 'html':
        return (
          <iframe
            srcDoc={selectedArtifact.content}
            className="artifact-html-preview"
            sandbox="allow-scripts"
            title={selectedArtifact.title}
          />
        );

      case 'svg':
        return (
          <div
            className="artifact-svg-preview"
            dangerouslySetInnerHTML={{ __html: selectedArtifact.content }}
          />
        );

      case 'mermaid':
        return (
          <div className="artifact-mermaid-preview">
            <pre>{selectedArtifact.content}</pre>
            <div className="artifact-note">
              Mermaid diagram rendering coming soon
            </div>
          </div>
        );

      case 'react':
        return (
          <div className="artifact-react-preview">
            <MonacoEditor
              value={selectedArtifact.content}
              language="javascript"
              readOnly={true}
              height="100%"
              theme={theme}
            />
            <div className="artifact-note">
              React component live preview coming soon
            </div>
          </div>
        );

      case 'document':
        return (
          <div className="artifact-document-preview">
            <div className="artifact-markdown">
              {selectedArtifact.content}
            </div>
          </div>
        );

      default:
        return <pre>{selectedArtifact.content}</pre>;
    }
  };

  const renderVersionHistory = () => {
    if (!showVersionHistory) return null;

    return (
      <div className="artifact-version-history">
        <div className="version-history-header">
          <h3>Version History</h3>
          <button
            className="btn-close-history"
            onClick={() => setShowVersionHistory(false)}
          >
            ×
          </button>
        </div>
        <div className="version-history-list">
          {selectedArtifact.versions.map((version, index) => (
            <div key={version.id} className="version-item">
              <div className="version-info">
                <span className="version-number">v{selectedArtifact.versions.length - index}</span>
                <span className="version-time">
                  {new Date(version.timestamp).toLocaleString()}
                </span>
              </div>
              {version.title && (
                <div className="version-title">{version.title}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="artifact-panel">
      <div className="artifact-panel-header">
        <div className="artifact-tabs">
          {artifacts.map((artifact) => (
            <button
              key={artifact.id}
              className={`artifact-tab ${artifact.id === selectedArtifactId ? 'active' : ''}`}
              onClick={() => setSelectedArtifactId(artifact.id)}
            >
              <span className="artifact-type-icon">
                {getArtifactIcon(artifact.type)}
              </span>
              <span className="artifact-tab-title">{artifact.title}</span>
            </button>
          ))}
        </div>
        {onClose && (
          <button className="artifact-panel-close" onClick={onClose}>
            ×
          </button>
        )}
      </div>

      <div className="artifact-content-header">
        <div className="artifact-info">
          <h3 className="artifact-title">{selectedArtifact.title}</h3>
          {selectedArtifact.metadata?.description && (
            <p className="artifact-description">
              {selectedArtifact.metadata.description}
            </p>
          )}
        </div>
        <div className="artifact-actions">
          <button
            className="artifact-action-btn"
            onClick={() => setShowVersionHistory(!showVersionHistory)}
            title="Version History"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 3a5 5 0 1 0 0 10A5 5 0 0 0 8 3zm0 1a4 4 0 1 1 0 8 4 4 0 0 1 0-8z"/>
              <path d="M8 4.5a.5.5 0 0 1 .5.5v3h2a.5.5 0 0 1 0 1h-2.5a.5.5 0 0 1-.5-.5V5a.5.5 0 0 1 .5-.5z"/>
            </svg>
            History
          </button>
          <button
            className="artifact-action-btn"
            onClick={handleCopy}
            title="Copy to Clipboard"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M4 1.5H3a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3.5a2 2 0 0 0-2-2h-1v1h1a1 1 0 0 1 1 1V14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1h1v-1z"/>
              <path d="M9.5 1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5h3zm-3-1A1.5 1.5 0 0 0 5 1.5v1A1.5 1.5 0 0 0 6.5 4h3A1.5 1.5 0 0 0 11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3z"/>
            </svg>
            Copy
          </button>
          <button
            className="artifact-action-btn"
            onClick={handleDownload}
            title="Download"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/>
              <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z"/>
            </svg>
            Download
          </button>
        </div>
      </div>

      <div className="artifact-content-container">
        {renderArtifactContent()}
        {renderVersionHistory()}
      </div>
    </div>
  );
};

const getArtifactIcon = (type: ArtifactType): string => {
  switch (type) {
    case 'code': return '{ }';
    case 'html': return '<>';
    case 'svg': return '◊';
    case 'mermaid': return '⬡';
    case 'react': return '⚛';
    case 'document': return '📄';
    default: return '•';
  }
};

export default ArtifactPanel;
