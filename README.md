# Log-Dot-Print

AI Log Printer System for Art Installations - Real-time printing of UE AI logs

## Overview

This system receives AI log data from Unreal Engine (or any HTTP/WebSocket client) and prints them in real-time using various printer types.

```
┌─────────────────────┐         ┌─────────────────────────────────────┐
│   UE Machine        │         │       Print Machine                 │
│                     │         │                                     │
│  ┌───────────────┐  │  HTTP/  │  ┌─────────────┐   ┌─────────────┐ │
│  │ UE Game +     │  │  WS     │  │ Log Server  │──▶│ Print Queue │ │
│  │ AI System     │──┼────────▶│  │ (Receiver)  │   └──────┬──────┘ │
│  └───────────────┘  │         │  └─────────────┘          │        │
│                     │         │         │                 ▼        │
│                     │         │         ▼        ┌─────────────┐   │
│                     │         │  ┌─────────────┐ │   Printer   │   │
│                     │         │  │   Storage   │ │   Plugin    │   │
│                     │         │  │  (JSONL)    │ └─────────────┘   │
│                     │         │  └─────────────┘                   │
└─────────────────────┘         └─────────────────────────────────────┘
```

## Features

- **Event-driven architecture** - All components communicate via events
- **Plugin system** - Easily add new printer types via DI
- **Multiple printer support**:
  - Mock (debug/console output)
  - CUPS (standard system printers)
  - ESC/POS (thermal printers)
  - Serial (dot matrix printers)
- **Log persistence** - JSONL file storage (DB support planned)
- **HTTP + WebSocket** - Flexible log ingestion

## Quick Start

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Start with default config (mock printer)
npm run dev

# Or with custom config
node packages/server/dist/cli.js --config config.json
```

## API

### HTTP Endpoints

```bash
# Submit a single log
curl -X POST http://localhost:3000/log \
  -H "Content-Type: application/json" \
  -d '{
    "source": "AI_Character_1",
    "level": "thought",
    "message": "I should approach the player"
  }'

# Submit multiple logs
curl -X POST http://localhost:3000/logs \
  -H "Content-Type: application/json" \
  -d '[
    {"source": "AI_1", "level": "action", "message": "Moving to target"},
    {"source": "AI_2", "level": "emotion", "message": "Feeling curious"}
  ]'

# Health check
curl http://localhost:3000/health
```

### WebSocket

```javascript
const ws = new WebSocket('ws://localhost:3000/ws');

ws.onopen = () => {
  // Send a log
  ws.send(JSON.stringify({
    type: 'log',
    payload: {
      source: 'AI_Character_1',
      level: 'thought',
      message: 'The player is nearby'
    }
  }));
};

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  console.log('Response:', msg);
};
```

## Log Entry Format

```typescript
interface LogEntry {
  id?: string;          // Auto-generated if not provided
  timestamp?: string;   // ISO 8601, auto-generated if not provided
  source: string;       // AI character or system name
  level: LogLevel;      // Log category
  message: string;      // The log content
  metadata?: object;    // Optional structured data
}

type LogLevel = 'debug' | 'info' | 'action' | 'thought' | 'emotion' | 'error';
```

## Configuration

Create a `config.json` file:

```json
{
  "server": {
    "port": 3000,
    "host": "0.0.0.0"
  },
  "printer": {
    "type": "mock",
    "options": {
      "logToConsole": true,
      "logToFile": "./logs/printed.log"
    }
  },
  "storage": {
    "enabled": true,
    "type": "file",
    "path": "./logs/ai-logs.jsonl"
  },
  "queue": {
    "maxSize": 1000,
    "retryAttempts": 3,
    "retryDelayMs": 1000
  },
  "format": {
    "maxLineWidth": 80,
    "includeTimestamp": true,
    "includeSource": true
  }
}
```

### Printer Configurations

#### CUPS (System Printer)

```json
{
  "printer": {
    "type": "cups",
    "options": {
      "printerName": "HP_LaserJet",
      "paperSize": "a4"
    }
  }
}
```

#### Serial (Dot Matrix)

```json
{
  "printer": {
    "type": "serial",
    "options": {
      "path": "/dev/ttyUSB0",
      "baudRate": 9600,
      "lineDelayMs": 50
    }
  }
}
```

#### ESC/POS (Thermal)

```json
{
  "printer": {
    "type": "escpos",
    "options": {
      "connectionType": "network",
      "host": "192.168.1.100",
      "port": 9100
    }
  }
}
```

## Package Structure

```
packages/
├── core/              # Shared interfaces, events, types
├── printer-core/      # Printer abstraction, queue, formatters
├── printer-mock/      # Debug printer (console/file)
├── printer-cups/      # CUPS/lp integration
├── printer-escpos/    # ESC/POS thermal printers
├── printer-serial/    # RS-232 serial printers
└── server/            # HTTP/WebSocket server, CLI
```

## Extending

### Adding a New Printer Plugin

```typescript
import { BasePrinter, printerRegistry } from '@log-dot-print/printer-core';

class MyPrinter extends BasePrinter {
  readonly name = 'my-printer';
  readonly version = '1.0.0';
  protected readonly printerType = 'custom';

  protected async connect(): Promise<void> {
    // Connect to your printer
  }

  protected async disconnect(): Promise<void> {
    // Disconnect
  }

  async print(job: PrintJob): Promise<void> {
    // Print the job
    console.log(job.formattedContent);
  }
}

// Register the plugin
printerRegistry.register('my-printer', (options) => new MyPrinter(options));
```

## Unreal Engine Integration

### Blueprint HTTP Request

Use the `VaRest` plugin or built-in HTTP module to POST logs:

```cpp
// C++ example
void UAILogSender::SendLog(const FString& Source, const FString& Level, const FString& Message)
{
    TSharedPtr<FJsonObject> JsonObject = MakeShared<FJsonObject>();
    JsonObject->SetStringField("source", Source);
    JsonObject->SetStringField("level", Level);
    JsonObject->SetStringField("message", Message);
    JsonObject->SetStringField("timestamp", FDateTime::Now().ToIso8601());

    // Send via HTTP POST to http://print-server:3000/log
}
```

## License

MIT
