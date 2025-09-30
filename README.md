# Claude Desktop

A standalone Windows desktop application for managing multiple Claude Code CLI sessions with a beautiful, intuitive interface.

![Claude Desktop](https://img.shields.io/badge/Platform-Windows-blue) ![License](https://img.shields.io/badge/License-MIT-green) ![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue) ![Electron](https://img.shields.io/badge/Electron-28.0-lightblue)

## ✨ Features

### Multi-Session Management
- **Tab-based Interface** - Work with multiple Claude sessions simultaneously
- **Session Persistence** - All conversations are automatically saved
- **Independent Sessions** - Each session has its own working directory and configuration
- **Easy Switching** - Quickly switch between active sessions with a single click

### Beautiful Chat Interface
- **Inspired by VS Code Plugin** - Clean, modern design adapted from the popular VS Code extension
- **Real-time Streaming** - Watch Claude's responses appear in real-time
- **Message History** - Full conversation history per session
- **Code Highlighting** - Automatic code block detection and formatting
- **Dark Theme** - Easy on the eyes for long coding sessions

### Claude CLI Integration
- **Full CLI Support** - Access all Claude Code features
- **Model Selection** - Choose between Opus, Sonnet, Sonnet 1M, or Default
- **Session Resuming** - Continue conversations across app restarts
- **Process Control** - Start, stop, and manage Claude processes per session

### Developer-Friendly
- **Working Directory per Session** - Each session can work in different project folders
- **Custom Window Chrome** - Frameless window with custom title bar
- **Keyboard Shortcuts** - Efficient keyboard-driven workflow
- **System Tray Integration** - Quick access from taskbar (planned)

## 📋 Prerequisites

Before installing Claude Desktop, you need:

1. **Windows 10/11** (64-bit)
2. **Claude Code CLI** - [Install from Anthropic](https://claude.com/code)
3. **Node.js 18+** (for development only)
4. **Git** (for development only)

## 🚀 Installation

### For Users (Binary Release)

1. Download the latest release from the [Releases](https://github.com/your-repo/claude-desktop/releases) page
2. Run the installer (`Claude-Desktop-Setup-1.0.0.exe`)
3. Follow the installation wizard
4. Launch Claude Desktop from your Start Menu or Desktop

### For Developers (Build from Source)

```bash
# Clone the repository
git clone https://github.com/your-repo/claude-desktop.git
cd claude-desktop

# Install dependencies
npm install

# Development mode (with hot reload)
npm run dev

# Build for production
npm run build

# Package Windows installer
npm run package:win
```

## 💡 Usage

### Creating Your First Session

1. Launch Claude Desktop
2. Click the **"New Session"** button or the **"+"** tab
3. Start typing your message in the input area
4. Press **Enter** to send (Shift+Enter for new line)

### Managing Multiple Sessions

- **Create Session**: Click the "+" button in the tab bar
- **Switch Session**: Click on any tab to switch to that session
- **Close Session**: Click the "×" button on a tab
- **Working Directory**: Each session remembers its working directory

### Sending Messages

- Type your message in the input field at the bottom
- Press **Enter** to send
- Press **Shift+Enter** for a new line
- Watch Claude's response stream in real-time

### Stopping Requests

If Claude is processing and you want to stop:
- Click the **"Stop"** button that appears during processing
- The session will stop immediately

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Enter` | Send message |
| `Shift+Enter` | New line in message |
| `Ctrl+T` | New session (planned) |
| `Ctrl+W` | Close current session (planned) |
| `Ctrl+Tab` | Next session (planned) |
| `Ctrl+Shift+Tab` | Previous session (planned) |

## 🏗️ Architecture

```
Claude Desktop
├── Main Process (Electron)
│   ├── Window Management
│   ├── IPC Handlers
│   └── MultiSessionManager
│       ├── Session Lifecycle
│       ├── Claude CLI Process Management
│       └── Stream Data Processing
│
└── Renderer Process (React)
    ├── App Shell
    ├── Session Store (Zustand)
    ├── Components
    │   ├── TitleBar
    │   ├── SessionTabs
    │   ├── ChatWindow
    │   └── MessageList
    └── Styles
```

### Key Components

#### MultiSessionManager (Main Process)
- Manages multiple Claude CLI processes
- Handles session creation, deletion, and switching
- Processes streaming JSON output from Claude
- Forwards data to renderer via IPC

#### Session Store (Renderer)
- Zustand-based state management
- Manages sessions and messages
- Handles IPC communication with main process
- Real-time UI updates

#### UI Components
- **TitleBar**: Custom window controls (minimize, maximize, close)
- **SessionTabs**: Tab bar for switching between sessions
- **ChatWindow**: Main chat interface for active session
- **MessageList**: Displays conversation history with formatting

## 🔧 Configuration

### Model Selection

Each session can use different models. Models available:
- **Opus** - Most capable, best for complex tasks
- **Sonnet** - Balanced performance and capability
- **Sonnet 1M** - Extended context window (1 million tokens)
- **Default** - Uses your Claude CLI default model setting

### Working Directory

Each session maintains its own working directory:
- Set at session creation
- Defaults to the app's launch directory
- Can be changed per session (planned feature)

### Session Persistence

Sessions are automatically saved:
- Conversation history persists across app restarts
- Claude session IDs are maintained for resuming
- Settings are preserved per session

## 🛠️ Development

### Project Structure

```
Claude/
├── src/
│   ├── main/                   # Electron main process
│   │   ├── index.ts           # App entry point
│   │   ├── MultiSessionManager.ts
│   │   └── preload.ts         # IPC bridge
│   ├── renderer/               # React UI
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   ├── components/
│   │   ├── store/
│   │   └── styles/
│   └── shared/                 # Shared types
│       └── types.ts
├── package.json
├── tsconfig.json
├── tsconfig.main.json
└── vite.config.ts
```

### Tech Stack

- **Electron 28** - Desktop application framework
- **React 18** - UI library
- **TypeScript 5.3** - Type safety
- **Zustand** - State management
- **Vite** - Fast build tool
- **Node.js** - Backend runtime

### Building

```bash
# Development with hot reload
npm run dev

# Production build
npm run build

# Create Windows installer
npm run package:win

# The installer will be in the `release` folder
```

## 🤝 Comparison to VS Code Plugin

### Similarities
- Beautiful chat interface design
- Message rendering and formatting
- Claude CLI integration
- Real-time streaming responses
- Session management

### Key Differences

| Feature | VS Code Plugin | Claude Desktop |
|---------|---------------|----------------|
| Platform | VS Code only | Standalone Windows app |
| Sessions | Single session | **Multiple sessions** |
| Interface | Editor panel | **Dedicated window** |
| Context | Workspace-aware | **Per-session directories** |
| MCP Servers | Yes | Planned |
| Checkpoints | Yes | Planned |
| Permissions | Yes | Planned |

### Advantages of Claude Desktop

1. **Multi-Session First** - The core feature is managing multiple independent sessions
2. **No IDE Dependency** - Works outside of VS Code
3. **Lighter Weight** - No editor overhead
4. **Dedicated App** - Optimized for chat workflow
5. **Tab-Based** - Browser-like session management

## 📝 Roadmap

### Version 1.1 (Planned)
- [ ] Conversation history browser
- [ ] Session export/import
- [ ] System tray integration
- [ ] Keyboard shortcuts
- [ ] Search within conversations

### Version 1.2 (Planned)
- [ ] MCP server management
- [ ] Permissions system
- [ ] Git checkpoint/restore
- [ ] Settings panel
- [ ] Custom working directory per session

### Version 2.0 (Future)
- [ ] Image support (drag & drop, paste)
- [ ] File references (@mentions)
- [ ] Agent management
- [ ] Plan mode & thinking mode
- [ ] Cross-platform (macOS, Linux)

## 🐛 Known Issues

- First-time session creation may be slow
- Large conversation histories can impact performance
- No persistence of window size/position yet

## 🙏 Credits

- **UI Design** - Inspired by [Claude Code Chat VS Code Extension](https://github.com/andrepimenta/claude-code-chat)
- **Claude Code** - Powered by [Anthropic's Claude CLI](https://claude.com/code)
- **Electron** - Built with the [Electron framework](https://www.electronjs.org/)

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/your-repo/claude-desktop/issues)
- **Discussions**: [GitHub Discussions](https://github.com/your-repo/claude-desktop/discussions)

---

**Built with ❤️ using Claude Code**