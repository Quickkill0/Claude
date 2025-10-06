import React, { useEffect, useState } from 'react';
import type { MCPServer, MCPScope, MCPServerType } from '../../shared/types';
import ConfirmDialog from './ConfirmDialog';

interface MCPManagementModalProps {
  sessionId: string;
  onClose: () => void;
}

type ViewMode = 'list' | 'create' | 'edit' | 'store';

interface MCPTemplate {
  name: string;
  displayName: string;
  description: string;
  type: MCPServerType;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  icon: string;
}

const MCP_STORE: MCPTemplate[] = [
  {
    name: 'github',
    displayName: 'GitHub',
    description: 'Repository management, issues, PRs, and CI/CD workflows',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: { GITHUB_TOKEN: '${GITHUB_TOKEN}' },
    icon: '🐙',
  },
  {
    name: 'sequential-thinking',
    displayName: 'Sequential Thinking',
    description: 'Break complex tasks into smaller logical steps',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    icon: '🧠',
  },
  {
    name: 'memory',
    displayName: 'Memory Bank',
    description: 'Persistent memory system across sessions',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    icon: '💾',
  },
  {
    name: 'context7',
    displayName: 'Context7',
    description: 'Up-to-date code documentation and examples',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@upstash/context7-mcp'],
    env: { CONTEXT7_API_KEY: '${CONTEXT7_API_KEY}' },
    icon: '📚',
  },
  {
    name: 'puppeteer',
    displayName: 'Puppeteer',
    description: 'Web automation and browser testing',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-puppeteer'],
    icon: '🎭',
  },
  {
    name: 'postgres',
    displayName: 'PostgreSQL',
    description: 'Database queries and management',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres'],
    env: { POSTGRES_URL: '${POSTGRES_URL}' },
    icon: '🐘',
  },
  {
    name: 'filesystem',
    displayName: 'File System',
    description: 'Local file management and operations',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem'],
    icon: '📁',
  },
  {
    name: 'git',
    displayName: 'Git',
    description: 'Git repository operations',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-git'],
    icon: '🌿',
  },
  {
    name: 'slack',
    displayName: 'Slack',
    description: 'Team communication and messaging',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    env: { SLACK_BOT_TOKEN: '${SLACK_BOT_TOKEN}' },
    icon: '💬',
  },
  {
    name: 'google-drive',
    displayName: 'Google Drive',
    description: 'Cloud storage access',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-gdrive'],
    icon: '☁️',
  },
  {
    name: 'time',
    displayName: 'Time',
    description: 'Time and date utilities',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-time'],
    icon: '⏰',
  },
  {
    name: 'sentry',
    displayName: 'Sentry',
    description: 'Error monitoring and tracking',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sentry'],
    env: { SENTRY_DSN: '${SENTRY_DSN}' },
    icon: '🐛',
  },
  {
    name: 'sqlite',
    displayName: 'SQLite',
    description: 'SQLite database operations',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sqlite'],
    icon: '🗄️',
  },
  {
    name: 'fetch',
    displayName: 'Fetch',
    description: 'HTTP requests and API calls',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-fetch'],
    icon: '🌐',
  },
  {
    name: 'docker',
    displayName: 'Docker',
    description: 'Container management',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-docker'],
    icon: '🐳',
  },
  {
    name: 'kubernetes',
    displayName: 'Kubernetes',
    description: 'K8s cluster management',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-kubernetes'],
    icon: '☸️',
  },
  {
    name: 'aws',
    displayName: 'AWS',
    description: 'Amazon Web Services integration',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-aws'],
    env: { AWS_ACCESS_KEY_ID: '${AWS_ACCESS_KEY_ID}', AWS_SECRET_ACCESS_KEY: '${AWS_SECRET_ACCESS_KEY}' },
    icon: '☁️',
  },
  {
    name: 'stripe',
    displayName: 'Stripe',
    description: 'Payment processing',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-stripe'],
    env: { STRIPE_SECRET_KEY: '${STRIPE_SECRET_KEY}' },
    icon: '💳',
  },
  {
    name: 'mongodb',
    displayName: 'MongoDB',
    description: 'NoSQL database operations',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-mongodb'],
    env: { MONGODB_URI: '${MONGODB_URI}' },
    icon: '🍃',
  },
  {
    name: 'redis',
    displayName: 'Redis',
    description: 'In-memory data store',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-redis'],
    env: { REDIS_URL: '${REDIS_URL}' },
    icon: '🔴',
  },
];

const MCPManagementModal: React.FC<MCPManagementModalProps> = ({ sessionId, onClose }) => {
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [mcps, setMCPs] = useState<MCPServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [editingMCP, setEditingMCP] = useState<MCPServer | null>(null);
  const [originalName, setOriginalName] = useState<string>('');
  const [formData, setFormData] = useState({
    name: '',
    type: 'stdio' as MCPServerType,
    command: '',
    args: '',
    env: '',
    url: '',
    headers: '',
    scope: 'project' as MCPScope,
  });

  // Confirm dialog state
  const [mcpToDelete, setMCPToDelete] = useState<MCPServer | null>(null);

  useEffect(() => {
    loadMCPs();
  }, [sessionId]);

  const loadMCPs = async () => {
    try {
      setLoading(true);
      const loadedMCPs = await window.electronAPI.getMCPs(sessionId);
      setMCPs(loadedMCPs);
      setError(null);
    } catch (err) {
      setError('Failed to load MCP servers');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = () => {
    setFormData({
      name: '',
      type: 'stdio',
      command: '',
      args: '',
      env: '',
      url: '',
      headers: '',
      scope: 'project',
    });
    setEditingMCP(null);
    setOriginalName('');
    setViewMode('create');
  };

  const handleEdit = (mcp: MCPServer) => {
    setFormData({
      name: mcp.name,
      type: mcp.type,
      command: mcp.command || '',
      args: mcp.args ? mcp.args.join('\n') : '',
      env: mcp.env ? JSON.stringify(mcp.env, null, 2) : '',
      url: mcp.url || '',
      headers: mcp.headers ? JSON.stringify(mcp.headers, null, 2) : '',
      scope: mcp.source,
    });
    setEditingMCP(mcp);
    setOriginalName(mcp.name);
    setViewMode('edit');
  };

  const handleDelete = (mcp: MCPServer) => {
    setMCPToDelete(mcp);
  };

  const confirmDelete = async () => {
    if (!mcpToDelete) return;

    try {
      await window.electronAPI.deleteMCP(sessionId, mcpToDelete.name, mcpToDelete.source);
      await loadMCPs();
      setMCPToDelete(null);
    } catch (err: any) {
      setError(err.message || 'Failed to delete MCP server');
      console.error(err);
      setMCPToDelete(null);
    }
  };

  const handleSave = async () => {
    try {
      // Parse args
      const args = formData.args
        .split('\n')
        .map(arg => arg.trim())
        .filter(arg => arg.length > 0);

      // Parse env
      let env: Record<string, string> | undefined;
      if (formData.env.trim()) {
        try {
          env = JSON.parse(formData.env);
        } catch (e) {
          setError('Invalid JSON format for environment variables');
          return;
        }
      }

      // Parse headers
      let headers: Record<string, string> | undefined;
      if (formData.headers.trim()) {
        try {
          headers = JSON.parse(formData.headers);
        } catch (e) {
          setError('Invalid JSON format for headers');
          return;
        }
      }

      const mcpData = {
        name: formData.name,
        type: formData.type,
        command: formData.command || undefined,
        args: args.length > 0 ? args : undefined,
        env,
        url: formData.url || undefined,
        headers,
      };

      if (viewMode === 'create') {
        await window.electronAPI.createMCP(sessionId, mcpData, formData.scope);
      } else if (viewMode === 'edit' && editingMCP) {
        await window.electronAPI.updateMCP(sessionId, originalName, {
          ...mcpData,
          source: formData.scope,
        });
      }

      await loadMCPs();
      setViewMode('list');
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to save MCP server');
      console.error(err);
    }
  };

  const handleCancel = () => {
    setViewMode('list');
    setEditingMCP(null);
    setOriginalName('');
  };

  const handleShowStore = () => {
    setViewMode('store');
  };

  const handleInstallFromStore = async (template: MCPTemplate, scope: MCPScope) => {
    try {
      const mcpData = {
        name: template.name,
        type: template.type,
        command: template.command,
        args: template.args,
        env: template.env,
        url: template.url,
      };

      await window.electronAPI.createMCP(sessionId, mcpData, scope);
      await loadMCPs();
      setError(null);

      // Show success message briefly
      const successMsg = `${template.displayName} installed successfully!`;
      setError(null);
      // Could show a success toast here instead
    } catch (err: any) {
      setError(err.message || `Failed to install ${template.displayName}`);
      console.error(err);
    }
  };

  const projectMCPs = mcps.filter(m => m.source === 'project');
  const personalMCPs = mcps.filter(m => m.source === 'personal');

  return (
    <div className="modal-overlay">
      <div className="modal-content agent-modal mcp-modal">
        <div className="modal-header">
          <h2>🔌 MCP Server Management</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {error && (
            <div className="error-banner">
              {error}
              <button onClick={() => setError(null)}>✕</button>
            </div>
          )}

          {viewMode === 'list' && (
            <div className="agent-list-view">
              {mcps.length > 0 && (
                <div className="agent-list-header">
                  <p className="agent-help-text">
                    MCP (Model Context Protocol) servers extend Claude Code with external tools and data sources.
                    Configure servers at project or personal scope.
                  </p>
                  <div className="agent-header-actions">
                    <button className="btn outlined" onClick={handleShowStore}>
                      🏪 MCP Store
                    </button>
                    <button className="btn primary" onClick={handleCreate}>
                      ➕ Add MCP Server
                    </button>
                  </div>
                </div>
              )}

              {loading ? (
                <div className="loading">Loading MCP servers...</div>
              ) : (
                <>
                  {projectMCPs.length > 0 && (
                    <div className="agent-section">
                      <h3>📁 Project Servers</h3>
                      <div className="agent-grid">
                        {projectMCPs.map((mcp) => (
                          <div key={mcp.name} className="agent-card">
                            <div className="agent-card-header">
                              <h4>{mcp.name}</h4>
                              <div className="agent-card-actions">
                                <button
                                  className="btn-icon"
                                  onClick={() => handleEdit(mcp)}
                                  title="Edit server"
                                >
                                  ✏️
                                </button>
                                <button
                                  className="btn-icon"
                                  onClick={() => handleDelete(mcp)}
                                  title="Delete server"
                                >
                                  🗑️
                                </button>
                              </div>
                            </div>
                            <div className="agent-meta">
                              <span className="agent-tag">Type: {mcp.type}</span>
                              {mcp.command && <span className="agent-tag">Command: {mcp.command}</span>}
                              {mcp.url && <span className="agent-tag">URL: {mcp.url}</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {personalMCPs.length > 0 && (
                    <div className="agent-section">
                      <h3>👤 Personal Servers</h3>
                      <div className="agent-grid">
                        {personalMCPs.map((mcp) => (
                          <div key={mcp.name} className="agent-card">
                            <div className="agent-card-header">
                              <h4>{mcp.name}</h4>
                              <div className="agent-card-actions">
                                <button
                                  className="btn-icon"
                                  onClick={() => handleEdit(mcp)}
                                  title="Edit server"
                                >
                                  ✏️
                                </button>
                                <button
                                  className="btn-icon"
                                  onClick={() => handleDelete(mcp)}
                                  title="Delete server"
                                >
                                  🗑️
                                </button>
                              </div>
                            </div>
                            <div className="agent-meta">
                              <span className="agent-tag">Type: {mcp.type}</span>
                              {mcp.command && <span className="agent-tag">Command: {mcp.command}</span>}
                              {mcp.url && <span className="agent-tag">URL: {mcp.url}</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {mcps.length === 0 && (
                    <div className="empty-state">
                      <p>No MCP servers configured yet</p>
                      <div className="empty-state-actions">
                        <button className="btn outlined" onClick={handleShowStore}>
                          🏪 Browse MCP Store
                        </button>
                        <button className="btn primary" onClick={handleCreate}>
                          Add Your First Server
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {viewMode === 'store' && (
            <div className="mcp-store-view">
              <div className="mcp-store-header">
                <div className="mcp-store-header-content">
                  <div>
                    <h3>🏪 MCP Store</h3>
                    <p className="agent-help-text">
                      Popular MCP servers ready to install. Select a scope and click install.
                    </p>
                  </div>
                  <button className="btn outlined" onClick={() => setViewMode('list')}>
                    ← Back to List
                  </button>
                </div>
              </div>
              <div className="mcp-store-grid">
                {MCP_STORE.map((template) => {
                  const isInstalled = mcps.some(m => m.name === template.name);
                  return (
                    <div key={template.name} className="mcp-store-card">
                      <div className="mcp-store-card-icon">{template.icon}</div>
                      <h4>{template.displayName}</h4>
                      <p className="mcp-store-card-description">{template.description}</p>
                      <div className="mcp-store-card-meta">
                        <span className="agent-tag">Type: {template.type}</span>
                      </div>
                      {isInstalled ? (
                        <div className="mcp-store-card-installed">✓ Installed</div>
                      ) : (
                        <div className="mcp-store-card-actions">
                          <button
                            className="btn outlined small"
                            onClick={() => handleInstallFromStore(template, 'personal')}
                            title="Install to personal scope"
                          >
                            👤 Personal
                          </button>
                          <button
                            className="btn primary small"
                            onClick={() => handleInstallFromStore(template, 'project')}
                            title="Install to project scope"
                          >
                            📁 Project
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {(viewMode === 'create' || viewMode === 'edit') && (
            <div className="agent-form-view">
              <h3>{viewMode === 'create' ? 'Add New MCP Server' : 'Edit MCP Server'}</h3>

              <div className="form-group">
                <label>Server Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., github, postgres, slack"
                  disabled={viewMode === 'edit'}
                />
                <small>Unique identifier for this MCP server</small>
              </div>

              <div className="form-group">
                <label>Server Type *</label>
                <select
                  value={formData.type}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value as MCPServerType })}
                >
                  <option value="stdio">stdio - Local command execution</option>
                  <option value="http">HTTP - HTTP-based server</option>
                  <option value="sse">SSE - Server-Sent Events</option>
                </select>
              </div>

              {formData.type === 'stdio' && (
                <>
                  <div className="form-group">
                    <label>Command *</label>
                    <input
                      type="text"
                      value={formData.command}
                      onChange={(e) => setFormData({ ...formData, command: e.target.value })}
                      placeholder="e.g., npx, node, python"
                    />
                    <small>Executable command to run</small>
                  </div>

                  <div className="form-group">
                    <label>Arguments</label>
                    <textarea
                      value={formData.args}
                      onChange={(e) => setFormData({ ...formData, args: e.target.value })}
                      placeholder="One argument per line&#10;e.g.:&#10;-y&#10;@modelcontextprotocol/server-github"
                      rows={4}
                    />
                    <small>Command arguments, one per line</small>
                  </div>
                </>
              )}

              {(formData.type === 'http' || formData.type === 'sse') && (
                <>
                  <div className="form-group">
                    <label>Server URL *</label>
                    <input
                      type="text"
                      value={formData.url}
                      onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                      placeholder="e.g., https://api.example.com/mcp"
                    />
                    <small>Full URL to the MCP server endpoint</small>
                  </div>

                  <div className="form-group">
                    <label>Headers (JSON)</label>
                    <textarea
                      value={formData.headers}
                      onChange={(e) => setFormData({ ...formData, headers: e.target.value })}
                      placeholder='{"Authorization": "Bearer ${API_KEY}"}'
                      rows={4}
                    />
                    <small>HTTP headers as JSON object</small>
                  </div>
                </>
              )}

              <div className="form-group">
                <label>Environment Variables (JSON)</label>
                <textarea
                  value={formData.env}
                  onChange={(e) => setFormData({ ...formData, env: e.target.value })}
                  placeholder='{"API_KEY": "${API_KEY}", "DATABASE_URL": "${DATABASE_URL}"}'
                  rows={4}
                />
                <small>Environment variables as JSON object. Use $&#123;VAR&#125; for variable expansion.</small>
              </div>

              <div className="form-group">
                <label>Scope *</label>
                <div className="radio-group">
                  <label className="radio-label">
                    <input
                      type="radio"
                      value="project"
                      checked={formData.scope === 'project'}
                      onChange={(e) => setFormData({ ...formData, scope: e.target.value as MCPScope })}
                      disabled={viewMode === 'edit'}
                    />
                    <span>📁 Project - Available in this project only</span>
                  </label>
                  <label className="radio-label">
                    <input
                      type="radio"
                      value="personal"
                      checked={formData.scope === 'personal'}
                      onChange={(e) => setFormData({ ...formData, scope: e.target.value as MCPScope })}
                      disabled={viewMode === 'edit'}
                    />
                    <span>👤 Personal - Available across all projects</span>
                  </label>
                </div>
              </div>

              <div className="form-actions">
                <button className="btn outlined" onClick={handleCancel}>
                  Cancel
                </button>
                <button
                  className="btn primary"
                  onClick={handleSave}
                  disabled={!formData.name || !formData.type || (formData.type === 'stdio' && !formData.command) || ((formData.type === 'http' || formData.type === 'sse') && !formData.url)}
                >
                  {viewMode === 'create' ? 'Add Server' : 'Save Changes'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {mcpToDelete && (
        <ConfirmDialog
          title="Delete MCP Server"
          message={`Are you sure you want to delete MCP server "${mcpToDelete.name}"? This action cannot be undone.`}
          onConfirm={confirmDelete}
          onCancel={() => setMCPToDelete(null)}
        />
      )}
    </div>
  );
};

export default MCPManagementModal;
