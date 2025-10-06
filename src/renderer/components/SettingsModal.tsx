import React, { useState, useEffect } from 'react';
import type { AppSettings } from '../../shared/types';

interface SettingsModalProps {
  onClose: () => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ onClose }) => {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Load settings on mount
  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const appSettings = await window.electronAPI.getSettings();
      setSettings(appSettings);
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  };

  const handleSave = async () => {
    if (!settings || !hasChanges) return;

    setIsSaving(true);
    try {
      await window.electronAPI.updateSettings(settings);

      // Apply theme immediately
      applyTheme(settings.theme);

      setHasChanges(false);
      onClose();
    } catch (error) {
      console.error('Failed to save settings:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const applyTheme = (theme: 'light' | 'dark' | 'auto') => {
    if (theme === 'auto') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.body.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    } else {
      document.body.setAttribute('data-theme', theme);
    }
  };

  const updateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    if (!settings) return;
    setSettings({ ...settings, [key]: value });
    setHasChanges(true);
  };

  const updateWSLSetting = <K extends keyof NonNullable<AppSettings['wsl']>>(
    key: K,
    value: NonNullable<AppSettings['wsl']>[K]
  ) => {
    if (!settings) return;
    setSettings({
      ...settings,
      wsl: {
        ...(settings.wsl || { enabled: false, distro: '', nodePath: '', claudePath: '' }),
        [key]: value,
      },
    });
    setHasChanges(true);
  };

  if (!settings) {
    return (
      <div className="modal-overlay">
        <div className="settings-modal">
          <div className="settings-body">
            <p>Loading settings...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay">
      <div className="settings-modal">
        <div className="settings-header">
          <h2>Settings</h2>
          <button className="btn-icon close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="settings-body">
          {/* Theme Setting */}
          <section className="settings-section">
            <h3>Theme</h3>
            <p className="settings-description">
              Choose your preferred color theme for the application.
            </p>
            <select
              className="model-select"
              value={settings.theme}
              onChange={(e) => updateSetting('theme', e.target.value as 'light' | 'dark' | 'auto')}
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
              <option value="auto">Auto (System)</option>
            </select>
          </section>

          {/* Default Model Setting */}
          <section className="settings-section">
            <h3>Default Model</h3>
            <p className="settings-description">
              Select the default AI model for new sessions.
            </p>
            <select
              className="model-select"
              value={settings.defaultModel}
              onChange={(e) => updateSetting('defaultModel', e.target.value as 'opus' | 'sonnet' | 'sonnet1m' | 'default')}
            >
              <option value="default">Default (Claude 4.5 Sonnet)</option>
              <option value="sonnet">Claude 4.5 Sonnet</option>
              <option value="opus">Claude 4.1 Opus</option>
              <option value="sonnet1m">Claude 4 Sonnet (1M Context)</option>
            </select>
          </section>

          {/* WSL Configuration */}
          <section className="settings-section">
            <h3>WSL Configuration</h3>
            <p className="settings-description">
              Configure Windows Subsystem for Linux integration.
            </p>

            <div className="wsl-config">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={settings.wsl?.enabled || false}
                  onChange={(e) => updateWSLSetting('enabled', e.target.checked)}
                />
                <span>Enable WSL Integration</span>
              </label>

              {settings.wsl?.enabled && (
                <div className="wsl-fields">
                  <div className="form-field">
                    <label>WSL Distribution</label>
                    <input
                      type="text"
                      className="text-input"
                      placeholder="e.g., Ubuntu"
                      value={settings.wsl?.distro || ''}
                      onChange={(e) => updateWSLSetting('distro', e.target.value)}
                    />
                  </div>

                  <div className="form-field">
                    <label>Node.js Path</label>
                    <input
                      type="text"
                      className="text-input"
                      placeholder="e.g., /usr/bin/node"
                      value={settings.wsl?.nodePath || ''}
                      onChange={(e) => updateWSLSetting('nodePath', e.target.value)}
                    />
                  </div>

                  <div className="form-field">
                    <label>Claude Path</label>
                    <input
                      type="text"
                      className="text-input"
                      placeholder="e.g., /usr/local/bin/claude"
                      value={settings.wsl?.claudePath || ''}
                      onChange={(e) => updateWSLSetting('claudePath', e.target.value)}
                    />
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>

        <div className="settings-footer">
          <button
            className="btn primary"
            onClick={handleSave}
            disabled={!hasChanges || isSaving}
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;