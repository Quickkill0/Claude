import React from 'react';
import type { Session, PermissionRule } from '../../shared/types';

interface SessionSettingsModalProps {
  session: Session;
  onClose: () => void;
  onRemovePermission: (sessionId: string, index: number) => void;
}

const SessionSettingsModal: React.FC<SessionSettingsModalProps> = ({ session, onClose, onRemovePermission }) => {
  const permissions = session.sessionPermissions || [];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>Settings: {session.name}</h2>
          <button className="btn-icon close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="settings-body">
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
