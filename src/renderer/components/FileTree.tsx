import React, { useState, useEffect } from 'react';
import type { FileItem } from '../../shared/types';
import ConfirmDialog from './ConfirmDialog';

interface FileTreeProps {
  sessionId: string;
}

interface ClipboardItem {
  path: string;
  operation: 'copy' | 'cut';
}

const FileTree: React.FC<FileTreeProps> = ({ sessionId }) => {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [currentPath, setCurrentPath] = useState<string>('');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<ClipboardItem | null>(null);
  const [renamingFile, setRenamingFile] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; file: FileItem } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<FileItem | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  // Load files for current path
  const loadFiles = async (path: string = currentPath) => {
    setLoading(true);
    setError(null);
    try {
      const fileList = await window.electronAPI.listFiles(sessionId, path || undefined);
      setFiles(fileList);
    } catch (err) {
      console.error('Failed to load files:', err);
      setError('Failed to load files');
    } finally {
      setLoading(false);
    }
  };

  // Initial load
  useEffect(() => {
    loadFiles();
  }, [sessionId]);

  // Handle folder click
  const handleFolderClick = async (file: FileItem) => {
    if (!file.isDirectory) return;

    const isExpanded = expandedFolders.has(file.path);
    if (isExpanded) {
      setExpandedFolders(prev => {
        const next = new Set(prev);
        next.delete(file.path);
        return next;
      });
    } else {
      setExpandedFolders(prev => new Set(prev).add(file.path));
      // Navigate into folder
      setCurrentPath(file.path);
      await loadFiles(file.path);
    }
  };

  // Handle go back
  const handleGoBack = async () => {
    if (!currentPath) return;

    const parentPath = currentPath.split(/[\\/]/).slice(0, -1).join('/');
    setCurrentPath(parentPath);
    await loadFiles(parentPath);
  };

  // Context menu handlers
  const handleContextMenu = (e: React.MouseEvent, file: FileItem) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, file });
  };

  const closeContextMenu = () => {
    setContextMenu(null);
  };

  // File operations
  const handleDelete = async (file: FileItem) => {
    try {
      await window.electronAPI.deleteFile(sessionId, file.path);
      await loadFiles();
      setDeleteConfirm(null);
    } catch (err) {
      console.error('Failed to delete file:', err);
      setError('Failed to delete file');
    }
  };

  const handleRename = async (file: FileItem) => {
    if (!newName.trim()) return;

    try {
      await window.electronAPI.renameFile(sessionId, file.path, newName);
      await loadFiles();
      setRenamingFile(null);
      setNewName('');
    } catch (err) {
      console.error('Failed to rename file:', err);
      setError('Failed to rename file');
    }
  };

  const handleCopy = (file: FileItem) => {
    setClipboard({ path: file.path, operation: 'copy' });
    closeContextMenu();
  };

  const handleCut = (file: FileItem) => {
    setClipboard({ path: file.path, operation: 'cut' });
    closeContextMenu();
  };

  const handlePaste = async () => {
    if (!clipboard) return;

    try {
      const sourceName = clipboard.path.split(/[\\/]/).pop() || '';
      const destPath = currentPath ? `${currentPath}/${sourceName}` : sourceName;

      if (clipboard.operation === 'copy') {
        await window.electronAPI.copyFile(sessionId, clipboard.path, destPath);
      } else {
        // For cut, we copy then delete
        await window.electronAPI.copyFile(sessionId, clipboard.path, destPath);
        await window.electronAPI.deleteFile(sessionId, clipboard.path);
        setClipboard(null);
      }

      await loadFiles();
    } catch (err) {
      console.error('Failed to paste:', err);
      setError('Failed to paste file');
    }
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;

    try {
      await window.electronAPI.createFolder(sessionId, currentPath, newFolderName);
      await loadFiles();
      setCreatingFolder(false);
      setNewFolderName('');
    } catch (err) {
      console.error('Failed to create folder:', err);
      setError('Failed to create folder');
    }
  };

  // Format file size
  const formatSize = (bytes?: number) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Click outside to close context menu
  useEffect(() => {
    const handleClick = () => closeContextMenu();
    if (contextMenu) {
      document.addEventListener('click', handleClick);
      return () => document.removeEventListener('click', handleClick);
    }
  }, [contextMenu]);

  return (
    <div className="file-tree">
      <div className="file-tree-header">
        <div className="file-tree-navigation">
          {currentPath && (
            <button className="file-tree-back-btn" onClick={handleGoBack} title="Go back">
              ←
            </button>
          )}
          <span className="file-tree-path">
            {currentPath || 'Root'}
          </span>
        </div>
        <div className="file-tree-actions">
          <button
            className="file-tree-action-btn"
            onClick={() => setCreatingFolder(true)}
            title="New Folder"
          >
            +📁
          </button>
          {clipboard && (
            <button
              className="file-tree-action-btn"
              onClick={handlePaste}
              title="Paste"
            >
              📋
            </button>
          )}
          <button
            className="file-tree-action-btn"
            onClick={() => loadFiles()}
            title="Refresh"
          >
            🔄
          </button>
        </div>
      </div>

      {error && (
        <div className="file-tree-error">
          {error}
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}

      {loading ? (
        <div className="file-tree-loading">Loading...</div>
      ) : (
        <div className="file-tree-list">
          {creatingFolder && (
            <div className="file-tree-create-folder">
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="Folder name..."
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateFolder();
                  if (e.key === 'Escape') {
                    setCreatingFolder(false);
                    setNewFolderName('');
                  }
                }}
              />
              <button onClick={handleCreateFolder}>✓</button>
              <button onClick={() => {
                setCreatingFolder(false);
                setNewFolderName('');
              }}>×</button>
            </div>
          )}

          {files.length === 0 ? (
            <div className="file-tree-empty">No files</div>
          ) : (
            files.map((file) => (
              <div
                key={file.path}
                className={`file-tree-item ${clipboard?.path === file.path && clipboard.operation === 'cut' ? 'cut' : ''}`}
                onContextMenu={(e) => handleContextMenu(e, file)}
              >
                {renamingFile === file.path ? (
                  <div className="file-tree-rename">
                    <input
                      type="text"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRename(file);
                        if (e.key === 'Escape') {
                          setRenamingFile(null);
                          setNewName('');
                        }
                      }}
                    />
                    <button onClick={() => handleRename(file)}>✓</button>
                    <button onClick={() => {
                      setRenamingFile(null);
                      setNewName('');
                    }}>×</button>
                  </div>
                ) : (
                  <>
                    <div
                      className="file-tree-item-content"
                      onClick={() => file.isDirectory && handleFolderClick(file)}
                    >
                      <span className="file-tree-item-icon">
                        {file.isDirectory ? '📁' : '📄'}
                      </span>
                      <span className="file-tree-item-name">{file.name}</span>
                      {!file.isDirectory && (
                        <span className="file-tree-item-size">{formatSize(file.size)}</span>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {contextMenu && (
        <div
          className="file-tree-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button onClick={() => {
            setRenamingFile(contextMenu.file.path);
            setNewName(contextMenu.file.name);
            closeContextMenu();
          }}>
            Rename
          </button>
          <button onClick={() => handleCopy(contextMenu.file)}>
            Copy
          </button>
          <button onClick={() => handleCut(contextMenu.file)}>
            Cut
          </button>
          <button onClick={() => {
            setDeleteConfirm(contextMenu.file);
            closeContextMenu();
          }} className="danger">
            Delete
          </button>
        </div>
      )}

      {deleteConfirm && (
        <ConfirmDialog
          title="Delete File"
          message={`Are you sure you want to delete "${deleteConfirm.name}"?`}
          onConfirm={() => handleDelete(deleteConfirm)}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}
    </div>
  );
};

export default FileTree;
