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
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);
  const [showErrorDialog, setShowErrorDialog] = useState(false);

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

  const handleRestoreClick = () => {
    if (restoring || !selectedCheckpoint) return;
    setShowConfirmDialog(true);
  };

  const handleConfirmRestore = async () => {
    if (!selectedCheckpoint) return;

    setShowConfirmDialog(false);

    try {
      setRestoring(true);
      console.log('[RestoreModal] Restoring to checkpoint:', selectedCheckpoint);

      await window.electronAPI.restoreCheckpoint(session.id, selectedCheckpoint);

      setShowSuccessDialog(true);
    } catch (error) {
      console.error('[RestoreModal] Failed to restore checkpoint:', error);
      setShowErrorDialog(true);
    } finally {
      setRestoring(false);
    }
  };

  const handleSuccessClose = () => {
    setShowSuccessDialog(false);
    onClose();
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
        <div className="modal-body" style={{ maxHeight: '500px', overflowY: 'auto' }}>
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
                  onDoubleClick={handleRestoreClick}
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
          <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', paddingRight: '16px', paddingBottom: '16px' }}>
            <button
              className="btn primary"
              onClick={handleRestoreClick}
              disabled={restoring}
            >
              {restoring ? 'Restoring...' : 'Restore to Selected Checkpoint'}
            </button>
          </div>
        )}
      </div>

      {/* Confirmation Dialog */}
      {showConfirmDialog && (
        <div className="modal-overlay" style={{ zIndex: 1001 }}>
          <div className="modal-content" style={{ maxWidth: '500px' }}>
            <div className="modal-header">
              <h2>⚠️ Confirm Restore</h2>
            </div>
            <div className="modal-body">
              <p>Are you sure you want to restore to this checkpoint?</p>
              <br />
              <p><strong>This will:</strong></p>
              <ul style={{ textAlign: 'left', marginLeft: '20px', marginTop: '10px' }}>
                <li>Reset your code to the state at this checkpoint</li>
                <li>Stash any uncommitted changes</li>
                <li>Keep all checkpoints accessible for navigation</li>
              </ul>
            </div>
            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', paddingRight: '16px', paddingBottom: '16px' }}>
              <button
                className="btn outlined"
                onClick={() => setShowConfirmDialog(false)}
              >
                Cancel
              </button>
              <button
                className="btn primary"
                onClick={handleConfirmRestore}
              >
                Restore Checkpoint
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Success Dialog */}
      {showSuccessDialog && (
        <div className="modal-overlay" style={{ zIndex: 1001 }}>
          <div className="modal-content" style={{ maxWidth: '400px' }}>
            <div className="modal-header">
              <h2>✅ Success</h2>
            </div>
            <div className="modal-body">
              <p>Successfully restored to checkpoint!</p>
            </div>
            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', paddingRight: '16px', paddingBottom: '16px' }}>
              <button
                className="btn primary"
                onClick={handleSuccessClose}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error Dialog */}
      {showErrorDialog && (
        <div className="modal-overlay" style={{ zIndex: 1001 }}>
          <div className="modal-content" style={{ maxWidth: '400px' }}>
            <div className="modal-header">
              <h2>❌ Error</h2>
            </div>
            <div className="modal-body">
              <p>Failed to restore checkpoint.</p>
              <p>Check the console for details.</p>
            </div>
            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', paddingRight: '16px', paddingBottom: '16px' }}>
              <button
                className="btn primary"
                onClick={() => setShowErrorDialog(false)}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RestoreModal;
