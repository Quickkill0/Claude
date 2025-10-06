import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import * as os from 'os';

export interface SlashCommand {
  name: string;
  description?: string;
  argumentHint?: string;
  allowedTools?: string;
  model?: string;
  disableModelInvocation?: boolean;
  content: string;
  source: 'project' | 'personal' | 'builtin';
}

interface CommandFrontmatter {
  description?: string;
  'argument-hint'?: string;
  'allowed-tools'?: string;
  model?: string;
  'disable-model-invocation'?: boolean;
}

export class SlashCommandParser {
  /**
   * Built-in Claude Code commands
   */
  private static readonly BUILTIN_COMMANDS: SlashCommand[] = [
    // UI-supported commands
    { name: 'agents', description: 'Manage custom AI subagents', source: 'builtin', content: '/agents' },
    { name: 'clear', description: 'Clear conversation history', source: 'builtin', content: '/clear' },
    { name: 'config', description: 'Open Settings interface', source: 'builtin', content: '/config' },
    { name: 'cost', description: 'Show token usage statistics', source: 'builtin', content: '/cost' },
    { name: 'help', description: 'Get usage help', source: 'builtin', content: '/help' },
    { name: 'memory', description: 'Edit CLAUDE.md memory files (coming soon)', source: 'builtin', content: '/memory' },
    { name: 'model', description: 'Select or change AI model', argumentHint: '[model-name]', source: 'builtin', content: '/model $ARGUMENTS' },
    { name: 'permissions', description: 'View or update permissions', source: 'builtin', content: '/permissions' },
    { name: 'status', description: 'Show session information', source: 'builtin', content: '/status' },

    // CLI-only commands (will show "not supported" message)
    { name: 'add-dir', description: 'Add working directories (CLI only)', source: 'builtin', content: '/add-dir' },
    { name: 'bug', description: 'Report bugs to Anthropic (CLI only)', source: 'builtin', content: '/bug' },
    { name: 'compact', description: 'Compact conversation (CLI only)', argumentHint: '[focus]', source: 'builtin', content: '/compact $ARGUMENTS' },
    { name: 'doctor', description: 'Check installation health (CLI only)', source: 'builtin', content: '/doctor' },
    { name: 'init', description: 'Initialize project (CLI only)', source: 'builtin', content: '/init' },
    { name: 'login', description: 'Switch Anthropic accounts (CLI only)', source: 'builtin', content: '/login' },
    { name: 'logout', description: 'Sign out (CLI only)', source: 'builtin', content: '/logout' },
    { name: 'mcp', description: 'Manage MCP servers', source: 'builtin', content: '/mcp' },
    { name: 'pr_comments', description: 'View PR comments (CLI only)', argumentHint: '[pr-number]', source: 'builtin', content: '/pr_comments $ARGUMENTS' },
    { name: 'review', description: 'Request code review (CLI only)', source: 'builtin', content: '/review' },
    { name: 'rewind', description: 'Rewind conversation (CLI only)', source: 'builtin', content: '/rewind' },
    { name: 'terminal-setup', description: 'Install key binding (CLI only)', source: 'builtin', content: '/terminal-setup' },
    { name: 'vim', description: 'Enter vim mode (CLI only)', source: 'builtin', content: '/vim' },
  ];

  /**
   * Get all available slash commands from built-in, project, and personal directories
   */
  static async getAvailableCommands(workingDirectory: string, includeBuiltIn: boolean = false): Promise<SlashCommand[]> {
    const commands: SlashCommand[] = [];

    // Built-in commands (disabled by default - they require interactive CLI)
    // These commands won't work in non-interactive mode via stdin
    if (includeBuiltIn) {
      commands.push(...this.BUILTIN_COMMANDS);
    }

    // Project-level commands (.claude/commands/ in working directory)
    const projectCommandsDir = path.join(workingDirectory, '.claude', 'commands');
    const projectCommands = await this.parseCommandsFromDirectory(projectCommandsDir, 'project');
    commands.push(...projectCommands);

    // Personal-level commands (~/.claude/commands/)
    const homeDir = os.homedir();
    const personalCommandsDir = path.join(homeDir, '.claude', 'commands');
    const personalCommands = await this.parseCommandsFromDirectory(personalCommandsDir, 'personal');
    commands.push(...personalCommands);

    return commands;
  }

  /**
   * Parse all markdown files in a directory as slash commands
   */
  private static async parseCommandsFromDirectory(
    directory: string,
    source: 'project' | 'personal'
  ): Promise<SlashCommand[]> {
    const commands: SlashCommand[] = [];

    try {
      // Check if directory exists
      if (!fs.existsSync(directory)) {
        return commands;
      }

      const files = fs.readdirSync(directory);

      for (const file of files) {
        // Only process .md files
        if (!file.endsWith('.md')) {
          continue;
        }

        const filePath = path.join(directory, file);
        const command = await this.parseCommandFile(filePath, source);

        if (command) {
          commands.push(command);
        }
      }
    } catch (error) {
      console.error(`Error parsing commands from ${directory}:`, error);
    }

    return commands;
  }

  /**
   * Parse a single markdown command file
   */
  private static async parseCommandFile(
    filePath: string,
    source: 'project' | 'personal'
  ): Promise<SlashCommand | null> {
    try {
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      const filename = path.basename(filePath, '.md');

      // Check for frontmatter
      const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
      const match = fileContent.match(frontmatterRegex);

      let frontmatter: CommandFrontmatter | null = null;
      let content = fileContent;

      if (match) {
        // Parse YAML frontmatter
        try {
          frontmatter = yaml.load(match[1]) as CommandFrontmatter;
          content = match[2].trim();
        } catch (error) {
          console.error(`Error parsing frontmatter in ${filePath}:`, error);
        }
      }

      // Use first line of content as description if not specified in frontmatter
      let description = frontmatter?.description;
      if (!description && content) {
        const firstLine = content.split('\n')[0];
        description = firstLine.length > 100 ? firstLine.substring(0, 100) + '...' : firstLine;
      }

      return {
        name: filename,
        description,
        argumentHint: frontmatter?.['argument-hint'],
        allowedTools: frontmatter?.['allowed-tools'],
        model: frontmatter?.model,
        disableModelInvocation: frontmatter?.['disable-model-invocation'],
        content,
        source,
      };
    } catch (error) {
      console.error(`Error reading command file ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Expand a command with its arguments
   */
  static expandCommand(command: SlashCommand, args: string[]): string {
    let expanded = command.content;

    // Replace $ARGUMENTS with all arguments joined by space
    const allArgs = args.join(' ');
    expanded = expanded.replace(/\$ARGUMENTS/g, allArgs);

    // Replace $1, $2, $3, etc. with individual arguments
    args.forEach((arg, index) => {
      const placeholder = new RegExp(`\\$${index + 1}`, 'g');
      expanded = expanded.replace(placeholder, arg);
    });

    return expanded;
  }
}
