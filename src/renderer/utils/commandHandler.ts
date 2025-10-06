import type { SlashCommand } from '../../shared/types';

export interface CommandAction {
  type: 'ui-action' | 'message' | 'not-supported' | 'open-modal';
  action?: string;
  message?: string;
  data?: any;
  modal?: 'agents' | 'settings' | 'permissions' | 'mcp';
}

/**
 * Handles execution of built-in slash commands by mapping them to UI actions
 */
export class CommandHandler {
  /**
   * Check if a command can be handled by the UI
   */
  static canHandle(commandName: string): boolean {
    const handledCommands = [
      'clear', 'model', 'cost', 'config', 'permissions',
      'status', 'help', 'memory', 'agents', 'mcp'
    ];
    return handledCommands.includes(commandName);
  }

  /**
   * Get the action for a built-in command
   */
  static getCommandAction(commandName: string, args: string[]): CommandAction {
    switch (commandName) {
      case 'clear':
        return {
          type: 'ui-action',
          action: 'clear-conversation',
          message: 'Conversation cleared'
        };

      case 'model':
        if (args.length > 0) {
          const modelMap: Record<string, string> = {
            'opus': 'opus',
            'sonnet': 'sonnet',
            'haiku': 'default',
            'default': 'default'
          };
          const model = modelMap[args[0].toLowerCase()] || 'default';
          return {
            type: 'ui-action',
            action: 'change-model',
            data: { model },
            message: `Model changed to ${model}`
          };
        }
        return {
          type: 'ui-action',
          action: 'show-model-selector',
          message: 'Select a model from the dropdown'
        };

      case 'cost':
        return {
          type: 'ui-action',
          action: 'show-cost',
          message: 'Cost information is shown in the status bar'
        };

      case 'status':
        return {
          type: 'ui-action',
          action: 'show-status',
          message: 'Session status shown'
        };

      case 'permissions':
        return {
          type: 'ui-action',
          action: 'show-permissions',
          message: 'Opening permissions...'
        };

      case 'config':
        return {
          type: 'ui-action',
          action: 'open-settings',
          message: 'Opening settings...'
        };

      case 'memory':
        return {
          type: 'ui-action',
          action: 'edit-memory',
          message: 'CLAUDE.md memory file management coming soon'
        };

      case 'help':
        return {
          type: 'ui-action',
          action: 'show-help',
          message: this.getHelpMessage()
        };

      case 'agents':
        return {
          type: 'open-modal',
          modal: 'agents',
          message: 'Opening agent management...'
        };

      case 'mcp':
        return {
          type: 'open-modal',
          modal: 'mcp',
          message: 'Opening MCP server management...'
        };

      // Not supported in UI context
      case 'bug':
      case 'compact':
      case 'doctor':
      case 'init':
      case 'login':
      case 'logout':
      case 'pr_comments':
      case 'review':
      case 'rewind':
      case 'terminal-setup':
      case 'vim':
        return {
          type: 'not-supported',
          message: `/${commandName} is a CLI-only command and not available in the UI. Please use the Claude Code CLI for this feature.`
        };

      default:
        return {
          type: 'not-supported',
          message: `Unknown command: /${commandName}`
        };
    }
  }

  /**
   * Get help message for UI
   */
  private static getHelpMessage(): string {
    return `**Available UI Commands:**

**Session Management:**
• \`/clear\` - Clear conversation history
• \`/model [name]\` - Change AI model (opus, sonnet, haiku)
• \`/cost\` - View token usage (shown in status bar)
• \`/status\` - Show session information

**Settings:**
• \`/config\` - Open settings
• \`/permissions\` - Manage permissions

**Custom Commands:**
Create custom slash commands in \`.claude/commands/\` directory as markdown files.

**Available UI Modals:**
• \`/agents\` - Manage custom AI subagents
• \`/mcp\` - Manage MCP servers

**CLI-Only Commands:**
The following commands require the Claude Code CLI and are not available in the UI:
\`/bug\`, \`/compact\`, \`/doctor\`, \`/init\`, \`/login\`, \`/logout\`, \`/pr_comments\`, \`/review\`, \`/rewind\`, \`/terminal-setup\`, \`/vim\``;
  }
}
