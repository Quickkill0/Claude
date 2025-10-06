import React, { useEffect, useState } from 'react';
import type { Session, Checkpoint } from '../../shared/types';

interface RestoreModalProps {
  session: Session;
  onClose: () => void;
}

const RestoreModal: React.FC<RestoreModalProps> = ({ session, onClose }) => {
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [isGitRepo, setIsGitRepo] = useState(false);
  const [selectedCheckpoint, setSelectedCheckpoint] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    loadCheckpoints();
  }, [session.id]);

  const loadCheckpoints = async () => {
    try {
      console.log('[RestoreModal] Loading checkpoints for session:', session.id);
      console.log('[RestoreModal] Working directory:', session.workingDirectory);

      // Check if this is a git repository
      const status = await window.electronAPI.getCheckpointStatus(session.id);
      console.log('[RestoreModal] Git status:', status);
      setIsGitRepo(status.isGitRepo);

      if (status.isGitRepo) {
        const chkpts = await window.electronAPI.getCheckpoints(session.id);
        console.log('[RestoreModal] Loaded checkpoints:', chkpts);
        setCheckpoints(chkpts);
      }
    } catch (error) {
      console.error('[RestoreModal] Failed to load checkpoints:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRestore = async (checkpointHash: string) => {
    if (restoring) return;

    const confirmed = confirm(
      'Are you sure you want to restore to this checkpoint?\n\n' +
      'This will reset your code to the state at this checkpoint. ' +
      'Current uncommitted changes will be stashed.\n\n' +
      'All checkpoints up to this one will also be accessible for navigation.'
    );

    if (!confirmed) return;

    try {
      setRestoring(true);
      console.log('[RestoreModal] Restoring to checkpoint:', checkpointHash);

      await window.electronAPI.restoreCheckpoint(session.id, checkpointHash);

      alert('Successfully restored to checkpoint!');
      onClose();
    } catch (error) {
      console.error('[RestoreModal] Failed to restore checkpoint:', error);
      alert('Failed to restore checkpoint. Check console for details.');
    } finally {
      setRestoring(false);
    }
  };

  const formatDate = (timestamp: string) => {
    try {
      const date = new Date(timestamp);

      if (isNaN(date.getTime())) {
        return timestamp;
      }

      return date.toLocaleString();
    } catch {
      return timestamp;
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">
          <h2>🔖 Restore from Checkpoint</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {loading ? (
            <div className="history-loading">Loading checkpoints...</div>
          ) : !isGitRepo ? (
            <div className="history-empty">
              <p><strong>Git is not available on this system.</strong></p>
              <p>Working directory: <code>{session.workingDirectory}</code></p>
              <br />
              <p>The checkpoint feature requires Git to be installed.</p>
              <p>To use this feature:</p>
              <ol style={{ textAlign: 'left', marginLeft: '20px' }}>
                <li>Install Git from <a href="https://git-scm.com" target="_blank">git-scm.com</a></li>
                <li>Ensure Git is in your system PATH</li>
                <li>Restart Claude Code</li>
                <li>Try again</li>
              </ol>
              <br />
              <p><small>Note: Git repositories are automatically initialized when you send a message.</small></p>
            </div>
          ) : checkpoints.length === 0 ? (
            <div className="history-empty">
              <p>No checkpoints found.</p>
              <p>Checkpoints are created automatically when you send messages.</p>
            </div>
          ) : (
            <div className="history-list">
              {checkpoints.map((checkpoint) => (
                <div
                  key={checkpoint.hash}
                  className={`history-item ${selectedCheckpoint === checkpoint.hash ? 'selected' : ''}`}
                  onClick={() => setSelectedCheckpoint(checkpoint.hash)}
                  onDoubleClick={() => handleRestore(checkpoint.hash)}
                >
                  <div className="history-item-header">
                    <span className="history-item-date">
                      {formatDate(checkpoint.timestamp)}
                    </span>
                    <span className="history-item-count">{checkpoint.author}</span>
                  </div>
                  <div className="history-item-preview">
                    🔖 {checkpoint.message}
                  </div>
                  <div className="history-item-hash">
                    {checkpoint.hash.substring(0, 7)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        {!loading && isGitRepo && checkpoints.length > 0 && selectedCheckpoint && (
          <div className="modal-footer">
            <button
              className="btn outlined"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              className="btn primary"
              onClick={() => handleRestore(selectedCheckpoint)}
              disabled={restoring}
            >
              {restoring ? 'Restoring...' : 'Restore to Selected Checkpoint'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default RestoreModal;
