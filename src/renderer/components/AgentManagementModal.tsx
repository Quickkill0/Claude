import React, { useEffect, useState } from 'react';
import type { Agent } from '../../shared/types';
import ConfirmDialog from './ConfirmDialog';
import { useSessionStore } from '../store/sessionStore';

interface AgentManagementModalProps {
  sessionId: string;
  onClose: () => void;
}

type ViewMode = 'list' | 'create' | 'edit' | 'generate';
type Scope = 'project' | 'personal';

const AgentManagementModal: React.FC<AgentManagementModalProps> = ({ sessionId, onClose }) => {
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Subscribe to messages from the session store
  const sessionMessages = useSessionStore((state) => state.messages.get(sessionId) || []);

  // Form state
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    tools: '',
    model: 'inherit' as 'sonnet' | 'opus' | 'haiku' | 'inherit',
    systemPrompt: '',
    scope: 'project' as Scope,
  });

  // AI generation state
  const [aiPrompt, setAiPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [tempSessionId, setTempSessionId] = useState<string | null>(null);

  // Confirm dialog state
  const [agentToDelete, setAgentToDelete] = useState<Agent | null>(null);

  // Subscribe to temp session messages if it exists
  const tempSessionMessages = useSessionStore((state) =>
    tempSessionId ? (state.messages.get(tempSessionId) || []) : []
  );

  useEffect(() => {
    loadAgents();
  }, [sessionId]);

  const loadAgents = async () => {
    try {
      setLoading(true);
      const loadedAgents = await window.electronAPI.getAgents(sessionId);
      setAgents(loadedAgents);
      setError(null);
    } catch (err) {
      setError('Failed to load agents');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = () => {
    setFormData({
      name: '',
      description: '',
      tools: '',
      model: 'inherit',
      systemPrompt: '',
      scope: 'project',
    });
    setEditingAgent(null);
    setViewMode('create');
  };

  const handleGenerateWithAI = () => {
    setAiPrompt('');
    setViewMode('generate');
  };

  const handleEdit = (agent: Agent) => {
    setFormData({
      name: agent.name,
      description: agent.description,
      tools: agent.tools || '',
      model: agent.model || 'inherit',
      systemPrompt: agent.systemPrompt,
      scope: agent.source,
    });
    setEditingAgent(agent);
    setViewMode('edit');
  };

  const handleDelete = (agent: Agent) => {
    setAgentToDelete(agent);
  };

  const confirmDelete = async () => {
    if (!agentToDelete) return;

    try {
      await window.electronAPI.deleteAgent(agentToDelete.filePath);
      await loadAgents();
      setAgentToDelete(null);
    } catch (err) {
      setError('Failed to delete agent');
      console.error(err);
      setAgentToDelete(null);
    }
  };

  const handleSave = async () => {
    try {
      if (viewMode === 'create') {
        await window.electronAPI.createAgent(
          sessionId,
          {
            name: formData.name,
            description: formData.description,
            tools: formData.tools || undefined,
            model: formData.model === 'inherit' ? undefined : formData.model,
            systemPrompt: formData.systemPrompt,
            source: formData.scope,
          },
          formData.scope
        );
      } else if (viewMode === 'edit' && editingAgent) {
        await window.electronAPI.updateAgent({
          ...editingAgent,
          name: formData.name,
          description: formData.description,
          tools: formData.tools || undefined,
          model: formData.model === 'inherit' ? undefined : formData.model,
          systemPrompt: formData.systemPrompt,
        });
      }

      await loadAgents();
      setViewMode('list');
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to save agent');
      console.error(err);
    }
  };

  const handleCancel = async () => {
    // Cleanup temp session if canceling during generation
    if (isGenerating && tempSessionId) {
      const { useSessionStore } = await import('../store/sessionStore');
      await useSessionStore.getState().deleteSession(tempSessionId);
      setTempSessionId(null);
    }
    setIsGenerating(false);
    setViewMode('list');
    setEditingAgent(null);
    setAiPrompt('');
  };

  const handleGenerateAgent = async () => {
    if (!aiPrompt.trim()) {
      setError('Please describe the agent you want to create');
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      // Import the session store
      const { useSessionStore } = await import('../store/sessionStore');
      const store = useSessionStore.getState();

      // Get current session to use its working directory
      const currentSession = store.sessions.find(s => s.id === sessionId);
      if (!currentSession) {
        setError('Current session not found');
        setIsGenerating(false);
        return;
      }

      // Create a temporary hidden session for generation
      const tempSession = await window.electronAPI.createSession({
        workingDirectory: currentSession.workingDirectory,
      });

      setTempSessionId(tempSession.id);

      // Send the prompt to Claude in the temp session
      const generationPrompt = `Create a custom AI agent based on this description:

"${aiPrompt}"

Generate a complete agent configuration with:
1. A lowercase, hyphen-separated name (e.g., "code-reviewer", "test-writer")
2. A concise description of when this agent should be invoked
3. Recommended tools (comma-separated: Read, Write, Grep, Glob, Bash, etc.)
4. A detailed system prompt defining the agent's role, capabilities, and approach

Format your response EXACTLY as follows:
NAME: [agent-name]
DESCRIPTION: [description]
TOOLS: [tools]
SYSTEM_PROMPT:
[system prompt content - everything after this line is the system prompt]

Make the system prompt detailed and specific to the agent's purpose.`;

      // Send message to temp session
      await store.sendMessage(tempSession.id, generationPrompt);

    } catch (err: any) {
      setError(err.message || 'Failed to generate agent');
      setIsGenerating(false);
      setTempSessionId(null);
    }
  };

  // Watch for response from temp session
  useEffect(() => {
    if (!isGenerating || !tempSessionId) return;

    // Check if we have an assistant response in temp session
    const assistantMessage = tempSessionMessages.find(msg => msg.type === 'assistant' && !msg.metadata?.hidden);

    if (assistantMessage) {
      // Parse the response
      const parsedAgent = parseAgentResponse(assistantMessage.content);

      if (parsedAgent) {
        // Populate the form
        setFormData({
          name: parsedAgent.name,
          description: parsedAgent.description,
          tools: '',
          model: 'inherit',
          systemPrompt: parsedAgent.systemPrompt,
          scope: 'project',
        });

        // Cleanup temp session
        cleanupTempSession();

        setIsGenerating(false);
        setViewMode('create');
      } else {
        setError('Could not parse agent details from response. Please create manually.');
        cleanupTempSession();
        setIsGenerating(false);
        setViewMode('list');
      }
    }
  }, [tempSessionMessages, isGenerating, tempSessionId]);

  // Cleanup temp session
  const cleanupTempSession = async () => {
    if (tempSessionId) {
      try {
        await window.electronAPI.deleteSession(tempSessionId);
      } catch (err) {
        console.error('Failed to cleanup temp session:', err);
      }
      setTempSessionId(null);
    }
  };

  // Parse agent response from Claude
  const parseAgentResponse = (response: string): { name: string; description: string; tools?: string; systemPrompt: string } | null => {
    try {
      const nameMatch = response.match(/NAME:\s*(.+?)(?:\n|$)/i);
      const descMatch = response.match(/DESCRIPTION:\s*(.+?)(?:\n|$)/i);
      const toolsMatch = response.match(/TOOLS:\s*(.+?)(?:\n|$)/i);

      // Parse everything after SYSTEM_PROMPT: as the system prompt
      const promptMatch = response.match(/SYSTEM_PROMPT:\s*\n([\s\S]+)/i);

      if (!nameMatch || !descMatch || !promptMatch) {
        return null;
      }

      return {
        name: nameMatch[1].trim(),
        description: descMatch[1].trim(),
        tools: toolsMatch ? toolsMatch[1].trim() : undefined,
        systemPrompt: promptMatch[1].trim(),
      };
    } catch (err) {
      console.error('Error parsing agent response:', err);
      return null;
    }
  };

  const projectAgents = agents.filter(a => a.source === 'project');
  const personalAgents = agents.filter(a => a.source === 'personal');

  return (
    <div className="modal-overlay">
      <div className="modal-content agent-modal">
        <div className="modal-header">
          <h2>🤖 Agent Management</h2>
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
              <div className="agent-list-header">
                <p className="agent-help-text">
                  Agents are specialized AI assistants with specific purposes and expertise.
                  They can have custom tools and system prompts.
                </p>
                <div className="agent-header-actions">
                  <button className="btn outlined" onClick={handleGenerateWithAI}>
                    ✨ Generate with AI
                  </button>
                  <button className="btn primary" onClick={handleCreate}>
                    ➕ Create New Agent
                  </button>
                </div>
              </div>

              {loading ? (
                <div className="loading">Loading agents...</div>
              ) : (
                <>
                  {projectAgents.length > 0 && (
                    <div className="agent-section">
                      <h3>📁 Project Agents</h3>
                      <div className="agent-grid">
                        {projectAgents.map((agent) => (
                          <div key={agent.filePath} className="agent-card">
                            <div className="agent-card-header">
                              <h4>{agent.name}</h4>
                              <div className="agent-card-actions">
                                <button
                                  className="btn-icon"
                                  onClick={() => handleEdit(agent)}
                                  title="Edit agent"
                                >
                                  ✏️
                                </button>
                                <button
                                  className="btn-icon"
                                  onClick={() => handleDelete(agent)}
                                  title="Delete agent"
                                >
                                  🗑️
                                </button>
                              </div>
                            </div>
                            <p className="agent-description">{agent.description}</p>
                            <div className="agent-meta">
                              {agent.model && <span className="agent-tag">Model: {agent.model}</span>}
                              {agent.tools && <span className="agent-tag">Tools: {agent.tools}</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {personalAgents.length > 0 && (
                    <div className="agent-section">
                      <h3>👤 Personal Agents</h3>
                      <div className="agent-grid">
                        {personalAgents.map((agent) => (
                          <div key={agent.filePath} className="agent-card">
                            <div className="agent-card-header">
                              <h4>{agent.name}</h4>
                              <div className="agent-card-actions">
                                <button
                                  className="btn-icon"
                                  onClick={() => handleEdit(agent)}
                                  title="Edit agent"
                                >
                                  ✏️
                                </button>
                                <button
                                  className="btn-icon"
                                  onClick={() => handleDelete(agent)}
                                  title="Delete agent"
                                >
                                  🗑️
                                </button>
                              </div>
                            </div>
                            <p className="agent-description">{agent.description}</p>
                            <div className="agent-meta">
                              {agent.model && <span className="agent-tag">Model: {agent.model}</span>}
                              {agent.tools && <span className="agent-tag">Tools: {agent.tools}</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {agents.length === 0 && (
                    <div className="empty-state">
                      <p>No agents created yet</p>
                      <div className="empty-state-actions">
                        <button className="btn outlined" onClick={handleGenerateWithAI}>
                          ✨ Generate with AI
                        </button>
                        <button className="btn primary" onClick={handleCreate}>
                          Create Your First Agent
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {viewMode === 'generate' && (
            <div className="agent-form-view">
              <h3>✨ Generate Agent with AI</h3>

              {isGenerating ? (
                <div className="ai-generation-processing">
                  <div className="processing-spinner">⏳</div>
                  <p>Generating agent configuration...</p>
                  <p className="processing-hint">Claude is analyzing your request and creating a custom agent.</p>
                </div>
              ) : (
                <>
                  <div className="ai-generation-help">
                    <p>Describe the agent you want to create, and Claude will generate a complete agent configuration for you.</p>
                    <p><strong>Example:</strong> "Create an agent that reviews code for security vulnerabilities and suggests fixes"</p>
                  </div>

                  <div className="form-group">
                    <label>Agent Description *</label>
                    <textarea
                      value={aiPrompt}
                      onChange={(e) => setAiPrompt(e.target.value)}
                      placeholder="Describe the agent you want to create..."
                      rows={6}
                    />
                  </div>

                  <div className="form-actions">
                    <button className="btn outlined" onClick={handleCancel}>
                      Cancel
                    </button>
                    <button
                      className="btn primary"
                      onClick={handleGenerateAgent}
                      disabled={!aiPrompt.trim()}
                    >
                      ✨ Generate Agent
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {(viewMode === 'create' || viewMode === 'edit') && (
            <div className="agent-form-view">
              <h3>{viewMode === 'create' ? 'Create New Agent' : 'Edit Agent'}</h3>

              <div className="form-group">
                <label>Agent Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., code-reviewer"
                  disabled={viewMode === 'edit'}
                />
                <small>Lowercase, hyphen-separated (e.g., code-reviewer, test-writer)</small>
              </div>

              <div className="form-group">
                <label>Description *</label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Brief description of when this agent should be invoked"
                />
                <small>This helps Claude decide when to delegate tasks to this agent</small>
              </div>

              <div className="form-group">
                <label>Scope *</label>
                <div className="radio-group">
                  <label className="radio-label">
                    <input
                      type="radio"
                      value="project"
                      checked={formData.scope === 'project'}
                      onChange={(e) => setFormData({ ...formData, scope: e.target.value as Scope })}
                      disabled={viewMode === 'edit'}
                    />
                    <span>📁 Project - Available in this project only</span>
                  </label>
                  <label className="radio-label">
                    <input
                      type="radio"
                      value="personal"
                      checked={formData.scope === 'personal'}
                      onChange={(e) => setFormData({ ...formData, scope: e.target.value as Scope })}
                      disabled={viewMode === 'edit'}
                    />
                    <span>👤 Personal - Available across all projects</span>
                  </label>
                </div>
              </div>

              <div className="form-group">
                <label>Model</label>
                <select
                  value={formData.model}
                  onChange={(e) => setFormData({ ...formData, model: e.target.value as any })}
                >
                  <option value="inherit">Inherit from session</option>
                  <option value="sonnet">Sonnet</option>
                  <option value="opus">Opus</option>
                  <option value="haiku">Haiku</option>
                </select>
              </div>

              <div className="form-group">
                <label>Allowed Tools</label>
                <input
                  type="text"
                  value={formData.tools}
                  onChange={(e) => setFormData({ ...formData, tools: e.target.value })}
                  placeholder="e.g., Read, Grep, Glob, Bash"
                />
                <small>Comma-separated tool names. Leave empty to inherit all tools.</small>
              </div>

              <div className="form-group">
                <label>System Prompt *</label>
                <textarea
                  value={formData.systemPrompt}
                  onChange={(e) => setFormData({ ...formData, systemPrompt: e.target.value })}
                  placeholder="Define the agent's role, capabilities, and approach to solving problems..."
                  rows={10}
                />
                <small>
                  Detailed instructions for the agent. Include the role, best practices, and any constraints.
                </small>
              </div>

              <div className="form-actions">
                <button className="btn outlined" onClick={handleCancel}>
                  Cancel
                </button>
                <button
                  className="btn primary"
                  onClick={handleSave}
                  disabled={!formData.name || !formData.description || !formData.systemPrompt}
                >
                  {viewMode === 'create' ? 'Create Agent' : 'Save Changes'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {agentToDelete && (
        <ConfirmDialog
          title="Delete Agent"
          message={`Are you sure you want to delete agent "${agentToDelete.name}"? This action cannot be undone.`}
          onConfirm={confirmDelete}
          onCancel={() => setAgentToDelete(null)}
        />
      )}
    </div>
  );
};

export default AgentManagementModal;
