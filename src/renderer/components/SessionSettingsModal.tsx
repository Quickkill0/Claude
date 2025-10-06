import React from 'react';
import type { Session, PermissionRule } from '../../shared/types';

interface SessionSettingsModalProps {
  session: Session;
  onClose: () => void;
  onRemovePermission: (sessionId: string, index: number) => void;
  onUpdateModel: (sessionId: string, model: 'opus' | 'sonnet' | 'sonnet1m' | 'default') => void;
}

const SessionSettingsModal: React.FC<SessionSettingsModalProps> = ({ session, onClose, onRemovePermission, onUpdateModel }) => {
  const allPermissions = session.sessionPermissions || [];
  const allowedPermissions = allPermissions.filter(p => p.allowed);
  const deniedPermissions = allPermissions.filter(p => !p.allowed);

  // Format permission for display
  const formatPermission = (permission: any): string => {
    const tool = permission.tool;
    const path = permission.path || '';

    if (tool === 'Bash') {
      // For bash, extract just the command part
      const command = path.split(' ')[0] || path;
      return `Bash(${command}:*)`;
    } else if (path === '*' || path === '') {
      return `${tool}(*)`;
    } else {
      // Show the path pattern (should be like WorkingDir/**)
      return `${tool}(${path})`;
    }
  };

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
              These permissions are automatically allowed for this session.
            </p>

            {allowedPermissions.length === 0 ? (
              <div className="empty-state">
                <p>No auto-allow permissions</p>
              </div>
            ) : (
              <div className="permission-list">
                {allPermissions.map((permission, index) =>
                  permission.allowed ? (
                    <div key={index} className="permission-item permission-allowed">
                      <div className="permission-info">
                        <div className="permission-tool">✓ {formatPermission(permission)}</div>
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
                  ) : null
                )}
              </div>
            )}
          </section>

          <section className="settings-section">
            <h3>Auto-Deny Permissions</h3>
            <p className="settings-description">
              These permissions are automatically denied for this session.
            </p>

            {deniedPermissions.length === 0 ? (
              <div className="empty-state">
                <p>No auto-deny permissions</p>
              </div>
            ) : (
              <div className="permission-list">
                {allPermissions.map((permission, index) =>
                  !permission.allowed ? (
                    <div key={index} className="permission-item permission-denied">
                      <div className="permission-info">
                        <div className="permission-tool">✕ {formatPermission(permission)}</div>
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
                  ) : null
                )}
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
