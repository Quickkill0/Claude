import React from 'react';
import type { Session, PermissionRule } from '../../shared/types';

interface SessionSettingsModalProps {
  session: Session;
  onClose: () => void;
  onRemovePermission: (sessionId: string, index: number) => void;
  onUpdateModel: (sessionId: string, model: 'opus' | 'sonnet' | 'sonnet1m' | 'default') => void;
}

const SessionSettingsModal: React.FC<SessionSettingsModalProps> = ({ session, onClose, onRemovePermission, onUpdateModel }) => {
  const permissions = session.sessionPermissions || [];

  return (
    <div className="modal-overlay">
      <div className="settings-modal">
        <div className="settings-header">
          <h2>Settings: {session.name}</h2>
          <button className="btn-icon close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="settings-body">
          <section className="settings-section">
            <h3>Model</h3>
            <p className="settings-description">
              Select the AI model for this session.
            </p>
            <select
              className="model-select"
              value={session.model}
              onChange={(e) => onUpdateModel(session.id, e.target.value as 'opus' | 'sonnet' | 'sonnet1m' | 'default')}
            >
              <option value="default">Default (Claude 4.5 Sonnet)</option>
              <option value="sonnet">Claude 4.5 Sonnet</option>
              <option value="opus">Claude 4.1 Opus</option>
              <option value="sonnet1m">Claude 4 Sonnet (1M Context)</option>
            </select>
          </section>

          <section className="settings-section">
            <h3>Auto-Accept Permissions</h3>
            <p className="settings-description">
              These permissions are automatically allowed for this session only.
            </p>

            {permissions.length === 0 ? (
              <div className="empty-state">
                <p>No saved permissions yet</p>
              </div>
            ) : (
              <div className="permission-list">
                {permissions.map((permission, index) => (
                  <div key={index} className="permission-item">
                    <div className="permission-info">
                      <div className="permission-tool">{permission.tool}</div>
                      <div className="permission-date">
                        Added: {new Date(permission.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                    <button
                      className="btn-icon delete"
                      onClick={() => onRemovePermission(session.id, index)}
                      title="Remove permission"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="settings-footer">
          <button className="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

export default SessionSettingsModal;
