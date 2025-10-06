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

    // Add new MCP server
    config.mcpServers[mcp.name] = {
      type: mcp.type,
      command: mcp.command,
      args: mcp.args,
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

    // Update/create new entry
    config.mcpServers[mcp.name] = {
      type: mcp.type,
      command: mcp.command,
      args: mcp.args,
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
}
