import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export type MCPServerType = 'stdio' | 'http' | 'sse';
export type MCPScope = 'project' | 'personal';

export interface MCPServer {
  name: string;
  type: MCPServerType;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  source: MCPScope;
}

interface MCPConfig {
  mcpServers: Record<string, {
    type: MCPServerType;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    headers?: Record<string, string>;
  }>;
}

export class MCPParser {
  /**
   * Get all available MCP servers from both project and personal scopes
   */
  static async getAvailableMCPs(workingDirectory: string): Promise<MCPServer[]> {
    const mcps: MCPServer[] = [];

    // Project-level MCPs (.mcp.json in working directory)
    const projectMCPs = await this.parseMCPsFromFile(
      path.join(workingDirectory, '.mcp.json'),
      'project'
    );
    mcps.push(...projectMCPs);

    // Personal-level MCPs (~/.claude/.mcp.json)
    const homeDir = os.homedir();
    const personalMCPs = await this.parseMCPsFromFile(
      path.join(homeDir, '.claude', '.mcp.json'),
      'personal'
    );
    mcps.push(...personalMCPs);

    return mcps;
  }

  /**
   * Parse MCP servers from a configuration file
   */
  private static async parseMCPsFromFile(
    filePath: string,
    source: MCPScope
  ): Promise<MCPServer[]> {
    const mcps: MCPServer[] = [];

    try {
      // Check if file exists
      if (!fs.existsSync(filePath)) {
        return mcps;
      }

      const fileContent = fs.readFileSync(filePath, 'utf-8');
      const config: MCPConfig = JSON.parse(fileContent);

      if (!config.mcpServers) {
        return mcps;
      }

      // Convert config object to array of MCPServer objects
      for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
        mcps.push({
          name,
          type: serverConfig.type,
          command: serverConfig.command,
          args: serverConfig.args,
          env: serverConfig.env,
          url: serverConfig.url,
          headers: serverConfig.headers,
          source,
        });
      }
    } catch (error) {
      console.error(`Error parsing MCP config from ${filePath}:`, error);
    }

    return mcps;
  }

  /**
   * Create a new MCP server configuration
   */
  static async createMCP(
    workingDirectory: string,
    mcp: Omit<MCPServer, 'source'>,
    scope: MCPScope
  ): Promise<void> {
    const filePath = this.getMCPFilePath(workingDirectory, scope);

    // Ensure directory exists
    const directory = path.dirname(filePath);
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
    }

    // Read existing config or create new one
    let config: MCPConfig = { mcpServers: {} };
    if (fs.existsSync(filePath)) {
      try {
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        config = JSON.parse(fileContent);
        if (!config.mcpServers) {
          config.mcpServers = {};
        }
      } catch (error) {
        console.error('Error reading existing MCP config:', error);
        config = { mcpServers: {} };
      }
    }

    // Check if MCP with this name already exists
    if (config.mcpServers[mcp.name]) {
      throw new Error(`MCP server "${mcp.name}" already exists in ${scope} scope`);
    }

    // Wrap npx commands with 'cmd /c' on Windows
    let command = mcp.command;
    let args = mcp.args;

    if (process.platform === 'win32' && mcp.type === 'stdio' && mcp.command === 'npx') {
      command = 'cmd';
      args = ['/c', 'npx', ...(mcp.args || [])];
    }

    // Add new MCP server
    config.mcpServers[mcp.name] = {
      type: mcp.type,
      command: command,
      args: args,
      env: mcp.env,
      url: mcp.url,
      headers: mcp.headers,
    };

    // Remove undefined fields for cleaner JSON
    const serverConfig: any = config.mcpServers[mcp.name];
    Object.keys(serverConfig).forEach(key => {
      if (serverConfig[key] === undefined) {
        delete serverConfig[key];
      }
    });

    // Write config back to file
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');

    // Also add to enabledMcpjsonServers in settings.local.json
    await this.updateEnabledMcpServers(workingDirectory, scope, mcp.name, 'add');
  }

  /**
   * Update an existing MCP server configuration
   */
  static async updateMCP(
    workingDirectory: string,
    oldName: string,
    mcp: MCPServer
  ): Promise<void> {
    const filePath = this.getMCPFilePath(workingDirectory, mcp.source);

    if (!fs.existsSync(filePath)) {
      throw new Error(`MCP config file not found: ${filePath}`);
    }

    // Read existing config
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const config: MCPConfig = JSON.parse(fileContent);

    if (!config.mcpServers || !config.mcpServers[oldName]) {
      throw new Error(`MCP server "${oldName}" not found in ${mcp.source} scope`);
    }

    // If name changed, delete old entry
    if (oldName !== mcp.name) {
      delete config.mcpServers[oldName];
    }

    // Wrap npx commands with 'cmd /c' on Windows
    let command = mcp.command;
    let args = mcp.args;

    if (process.platform === 'win32' && mcp.type === 'stdio' && mcp.command === 'npx') {
      command = 'cmd';
      args = ['/c', 'npx', ...(mcp.args || [])];
    }

    // Update/create new entry
    config.mcpServers[mcp.name] = {
      type: mcp.type,
      command: command,
      args: args,
      env: mcp.env,
      url: mcp.url,
      headers: mcp.headers,
    };

    // Remove undefined fields for cleaner JSON
    const serverConfig: any = config.mcpServers[mcp.name];
    Object.keys(serverConfig).forEach(key => {
      if (serverConfig[key] === undefined) {
        delete serverConfig[key];
      }
    });

    // Write config back to file
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');

    // Update enabledMcpjsonServers if name changed
    if (oldName !== mcp.name) {
      await this.updateEnabledMcpServers(workingDirectory, mcp.source, oldName, 'remove');
      await this.updateEnabledMcpServers(workingDirectory, mcp.source, mcp.name, 'add');
    }
  }

  /**
   * Delete an MCP server configuration
   */
  static async deleteMCP(
    workingDirectory: string,
    name: string,
    scope: MCPScope
  ): Promise<void> {
    const filePath = this.getMCPFilePath(workingDirectory, scope);

    if (!fs.existsSync(filePath)) {
      throw new Error(`MCP config file not found: ${filePath}`);
    }

    // Read existing config
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const config: MCPConfig = JSON.parse(fileContent);

    if (!config.mcpServers || !config.mcpServers[name]) {
      throw new Error(`MCP server "${name}" not found in ${scope} scope`);
    }

    // Delete the MCP server
    delete config.mcpServers[name];

    // Write config back to file
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');

    // Also remove from enabledMcpjsonServers in settings.local.json
    await this.updateEnabledMcpServers(workingDirectory, scope, name, 'remove');
  }

  /**
   * Get MCP configuration file path for a scope
   */
  private static getMCPFilePath(workingDirectory: string, scope: MCPScope): string {
    if (scope === 'project') {
      return path.join(workingDirectory, '.mcp.json');
    } else {
      return path.join(os.homedir(), '.claude', '.mcp.json');
    }
  }

  /**
   * Update enabledMcpjsonServers in settings.local.json
   */
  private static async updateEnabledMcpServers(
    workingDirectory: string,
    scope: MCPScope,
    mcpName: string,
    action: 'add' | 'remove'
  ): Promise<void> {
    try {
      // Determine settings file path based on scope
      let settingsFile: string;
      if (scope === 'project') {
        settingsFile = path.join(workingDirectory, '.claude', 'settings.local.json');
      } else {
        // For personal scope, use home directory
        settingsFile = path.join(os.homedir(), '.claude', 'settings.local.json');
      }

      // Ensure .claude directory exists
      const claudeDir = path.dirname(settingsFile);
      if (!fs.existsSync(claudeDir)) {
        fs.mkdirSync(claudeDir, { recursive: true });
      }

      // Read existing settings or create new
      let settings: any = {};
      if (fs.existsSync(settingsFile)) {
        try {
          settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
        } catch (error) {
          console.error('Error reading settings.local.json:', error);
          settings = {};
        }
      }

      // Ensure enabledMcpjsonServers array exists
      if (!settings.enabledMcpjsonServers) {
        settings.enabledMcpjsonServers = [];
      }

      // Add or remove MCP name
      if (action === 'add') {
        if (!settings.enabledMcpjsonServers.includes(mcpName)) {
          settings.enabledMcpjsonServers.push(mcpName);
        }
      } else if (action === 'remove') {
        const index = settings.enabledMcpjsonServers.indexOf(mcpName);
        if (index !== -1) {
          settings.enabledMcpjsonServers.splice(index, 1);
        }
      }

      // Write settings back to file
      fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf-8');
      console.log(`[MCP] ${action === 'add' ? 'Added' : 'Removed'} ${mcpName} ${action === 'add' ? 'to' : 'from'} enabledMcpjsonServers in ${scope} scope`);
    } catch (error) {
      console.error(`Error updating enabledMcpjsonServers:`, error);
    }
  }
}
