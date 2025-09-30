import React, { useState, useEffect } from 'react';
import type { AppSettings, PermissionRule } from '../../shared/types';

interface SettingsModalProps {
  onClose: () => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ onClose }) => {
  const [settings, setSettings] = useState<AppSettings | null>(null);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const loadedSettings = await window.electronAPI.getSettings();
      setSettings(loadedSettings);
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  };

  const removePermission = async (index: number) => {
    if (!settings) return;

    const updatedPermissions = settings.alwaysAllowPermissions.filter((_, i) => i !== index);
    const updatedSettings = {
      ...settings,
      alwaysAllowPermissions: updatedPermissions,
    };

    try {
      await window.electronAPI.updateSettings({ alwaysAllowPermissions: updatedPermissions });
      setSettings(updatedSettings);
    } catch (error) {
      console.error('Failed to update settings:', error);
    }
  };

  const clearAllPermissions = async () => {
    if (!settings) return;

    try {
      await window.electronAPI.updateSettings({ alwaysAllowPermissions: [] });
      setSettings({ ...settings, alwaysAllowPermissions: [] });
    } catch (error) {
      console.error('Failed to clear permissions:', error);
    }
  };

  if (!settings) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
          <div className="settings-header">
            <h2>Settings</h2>
            <button className="btn-icon close" onClick={onClose}>
              ×
            </button>
          </div>
          <div className="settings-body">
            <p>Loading...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>Settings</h2>
          <button className="btn-icon close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="settings-body">
          <section className="settings-section">
            <h3>Always-Allow Permissions</h3>
            <p className="settings-description">
              These permissions have been saved and will be automatically allowed in future sessions.
            </p>

            {settings.alwaysAllowPermissions.length === 0 ? (
              <div className="empty-state">
                <p>No saved permissions yet</p>
              </div>
            ) : (
              <>
                <div className="permission-list">
                  {settings.alwaysAllowPermissions.map((permission, index) => (
                    <div key={index} className="permission-item">
                      <div className="permission-info">
                        <div className="permission-tool">{permission.tool}</div>
                        <div className="permission-path">{permission.path || permission.pattern || 'All paths'}</div>
                        <div className="permission-date">
                          Added: {new Date(permission.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                      <button
                        className="btn-icon delete"
                        onClick={() => removePermission(index)}
                        title="Remove permission"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>

                <button className="btn outlined small" onClick={clearAllPermissions}>
                  Clear All Permissions
                </button>
              </>
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

export default SettingsModal;