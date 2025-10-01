import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import * as os from 'os';

export interface Agent {
  name: string;
  description: string;
  tools?: string;
  model?: 'sonnet' | 'opus' | 'haiku' | 'inherit';
  systemPrompt: string;
  source: 'project' | 'personal';
  filePath: string;
}

interface AgentFrontmatter {
  name: string;
  description: string;
  tools?: string;
  model?: 'sonnet' | 'opus' | 'haiku' | 'inherit';
}

export class AgentParser {
  /**
   * Get all available agents from both project and personal directories
   */
  static async getAvailableAgents(workingDirectory: string): Promise<Agent[]> {
    const agents: Agent[] = [];

    // Project-level agents (.claude/agents/ in working directory)
    const projectAgentsDir = path.join(workingDirectory, '.claude', 'agents');
    const projectAgents = await this.parseAgentsFromDirectory(projectAgentsDir, 'project');
    agents.push(...projectAgents);

    // Personal-level agents (~/.claude/agents/)
    const homeDir = os.homedir();
    const personalAgentsDir = path.join(homeDir, '.claude', 'agents');
    const personalAgents = await this.parseAgentsFromDirectory(personalAgentsDir, 'personal');
    agents.push(...personalAgents);

    return agents;
  }

  /**
   * Parse all markdown files in a directory as agents
   */
  private static async parseAgentsFromDirectory(
    directory: string,
    source: 'project' | 'personal'
  ): Promise<Agent[]> {
    const agents: Agent[] = [];

    try {
      // Check if directory exists
      if (!fs.existsSync(directory)) {
        return agents;
      }

      const files = fs.readdirSync(directory);

      for (const file of files) {
        // Only process .md files
        if (!file.endsWith('.md')) {
          continue;
        }

        const filePath = path.join(directory, file);
        const agent = await this.parseAgentFile(filePath, source);

        if (agent) {
          agents.push(agent);
        }
      }
    } catch (error) {
      console.error(`Error parsing agents from ${directory}:`, error);
    }

    return agents;
  }

  /**
   * Parse a single markdown agent file
   */
  private static async parseAgentFile(
    filePath: string,
    source: 'project' | 'personal'
  ): Promise<Agent | null> {
    try {
      const fileContent = fs.readFileSync(filePath, 'utf-8');

      // Check for frontmatter
      const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
      const match = fileContent.match(frontmatterRegex);

      if (!match) {
        console.error(`Invalid agent file format (missing frontmatter): ${filePath}`);
        return null;
      }

      // Parse YAML frontmatter
      let frontmatter: AgentFrontmatter;
      try {
        frontmatter = yaml.load(match[1]) as AgentFrontmatter;
      } catch (error) {
        console.error(`Error parsing frontmatter in ${filePath}:`, error);
        return null;
      }

      // Validate required fields
      if (!frontmatter.name || !frontmatter.description) {
        console.error(`Invalid agent file (missing name or description): ${filePath}`);
        return null;
      }

      const systemPrompt = match[2].trim();

      return {
        name: frontmatter.name,
        description: frontmatter.description,
        tools: frontmatter.tools,
        model: frontmatter.model,
        systemPrompt,
        source,
        filePath,
      };
    } catch (error) {
      console.error(`Error reading agent file ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Create a new agent file
   */
  static async createAgent(
    workingDirectory: string,
    agent: Omit<Agent, 'filePath'>,
    scope: 'project' | 'personal'
  ): Promise<string> {
    const directory = scope === 'project'
      ? path.join(workingDirectory, '.claude', 'agents')
      : path.join(os.homedir(), '.claude', 'agents');

    // Create directory if it doesn't exist
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
    }

    // Generate filename from agent name (lowercase, hyphen-separated)
    const filename = `${agent.name.toLowerCase().replace(/\s+/g, '-')}.md`;
    const filePath = path.join(directory, filename);

    // Check if file already exists
    if (fs.existsSync(filePath)) {
      throw new Error(`Agent "${agent.name}" already exists in ${scope} scope`);
    }

    // Build frontmatter
    const frontmatter: AgentFrontmatter = {
      name: agent.name,
      description: agent.description,
    };

    if (agent.tools) {
      frontmatter.tools = agent.tools;
    }

    if (agent.model) {
      frontmatter.model = agent.model;
    }

    // Build file content
    const frontmatterYaml = yaml.dump(frontmatter, { lineWidth: -1 });
    const fileContent = `---\n${frontmatterYaml}---\n${agent.systemPrompt}`;

    // Write file
    fs.writeFileSync(filePath, fileContent, 'utf-8');

    return filePath;
  }

  /**
   * Update an existing agent file
   */
  static async updateAgent(
    agent: Agent
  ): Promise<void> {
    if (!fs.existsSync(agent.filePath)) {
      throw new Error(`Agent file not found: ${agent.filePath}`);
    }

    // Build frontmatter
    const frontmatter: AgentFrontmatter = {
      name: agent.name,
      description: agent.description,
    };

    if (agent.tools) {
      frontmatter.tools = agent.tools;
    }

    if (agent.model) {
      frontmatter.model = agent.model;
    }

    // Build file content
    const frontmatterYaml = yaml.dump(frontmatter, { lineWidth: -1 });
    const fileContent = `---\n${frontmatterYaml}---\n${agent.systemPrompt}`;

    // Write file
    fs.writeFileSync(agent.filePath, fileContent, 'utf-8');
  }

  /**
   * Delete an agent file
   */
  static async deleteAgent(filePath: string): Promise<void> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Agent file not found: ${filePath}`);
    }

    fs.unlinkSync(filePath);
  }

  /**
   * Get agent directory path for a scope
   */
  static getAgentDirectory(workingDirectory: string, scope: 'project' | 'personal'): string {
    return scope === 'project'
      ? path.join(workingDirectory, '.claude', 'agents')
      : path.join(os.homedir(), '.claude', 'agents');
  }
}
