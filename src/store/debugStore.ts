import { createWithEqualityFn } from "zustand/traditional";
import { emit } from "@tauri-apps/api/event";

export interface LogEntry {
  id: string;
  timestamp: Date;
  level: "debug" | "info" | "warn" | "error";
  source: "frontend" | "backend";
  message: string;
  data?: any;
}

interface DebugStore {
  frontendLogs: LogEntry[];
  maxLogs: number;
  addFrontendLog: (level: LogEntry["level"], message: string, data?: any) => void;
  clearFrontendLogs: () => void;
}

let globalLogCounter = 0;
const generateUniqueId = () => {
  // Add random part to ensure uniqueness even with fast logs in the same millisecond
  return `frontend-${Date.now()}-${++globalLogCounter}-${Math.random().toString(36).substring(2, 9)}`;
};

let frontendLogBridgeEnabled = false;
let frontendLogBridgePausedUntil = 0;
let frontendLogBridgeBusy = false;

const logDataCache = new Map<string, any>();

export const getLogDataFromCache = (dataId: string) => {
  return logDataCache.get(dataId);
};

export const setFrontendLogBridgeEnabled = (enabled: boolean) => {
  frontendLogBridgeEnabled = enabled;
  if (!enabled) {
    frontendLogBridgePausedUntil = 0;
  }
};

const bridgeFrontendLog = (logEntry: LogEntry) => {
  if (!frontendLogBridgeEnabled || frontendLogBridgeBusy) {
    return;
  }

  if (Date.now() < frontendLogBridgePausedUntil) {
    return;
  }

  const payload = {
    id: logEntry.id,
    timestamp: logEntry.timestamp.toISOString(),
    level: logEntry.level,
    source: logEntry.source,
    message: logEntry.message,
    data: logEntry.data,
  };

  try {
    frontendLogBridgeBusy = true;
    const bridgePromise = emit("frontend-log", payload);
    frontendLogBridgeBusy = false;

    bridgePromise.catch(() => {
      frontendLogBridgePausedUntil = Date.now() + 2000;
    });
  } catch {
    frontendLogBridgeBusy = false;
    frontendLogBridgePausedUntil = Date.now() + 2000;
  }
};

const processLogData = (logId: string, data: any): any => {
  const isErrorLike = (obj: any) => {
    return obj && typeof obj === 'object' && typeof obj.name === 'string' && typeof obj.message === 'string' && (Array.isArray(obj.stack) || typeof obj.stack === 'string');
  };

  if (!data || typeof data !== 'object') {
    return data;
  }

  // If the whole object is an error-like, return as-is
  if (isErrorLike(data)) {
    return data;
  }

  // Handle arrays: convert to reference (non-error arrays)
  if (Array.isArray(data)) {
    const dataId = `${logId}-data-array`;
    logDataCache.set(dataId, data);
    return {
      __ref: dataId,
      __type: 'array',
      __preview: `Array(${data.length})`,
    };
  }

  const processed: any = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== null && typeof value === 'object') {
      if (isErrorLike(value)) {
        processed[key] = value; // keep error-like inline
      } else if (Array.isArray(value)) {
        const dataId = `${logId}-data-${key}`;
        logDataCache.set(dataId, value);
        processed[key] = {
          __ref: dataId,
          __type: 'array',
          __preview: `Array(${value.length})`,
        };
      } else {
        const dataId = `${logId}-data-${key}`;
        logDataCache.set(dataId, value);
        processed[key] = {
          __ref: dataId,
          __type: 'object',
          __preview: `Object(${Object.keys(value).length})`,
        };
      }
    } else {
      processed[key] = value as any;
    }
  }
  return processed;
};

export const useDebugStore = createWithEqualityFn<DebugStore>((set) => {
  const originalConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };

  const isDebugWindow = window.location.pathname === "/debug";

  const createLogEntry = (level: LogEntry["level"], args: any[]): LogEntry => {
    const logId = generateUniqueId();
    const messageParts: string[] = [];
    const dataParts: any[] = [];

    args.forEach(arg => {
      if (arg instanceof Error) {
        // Special handling for Error objects
        const errorData = {
          name: arg.name,
          message: arg.message,
          stack: arg.stack?.split('\n').map(s => s.trim()),
        };
        // Merge into a single data object if other objects are present
        if (dataParts.length > 0) {
          dataParts[0] = { ...dataParts[0], error: errorData };
        } else {
          dataParts.push({ error: errorData });
        }
      } else if (typeof arg === 'object' && arg !== null) {
        dataParts.push(arg);
      } else {
        messageParts.push(String(arg));
      }
    });

    const message = messageParts.join(" ");
    let data: any;

    if (dataParts.length === 1) {
      data = dataParts[0];
    } else if (dataParts.length > 1) {
      data = {};
      dataParts.forEach((part, index) => {
        data[`argument_${index}`] = part;
      });
    }
    
    let processedData = data;
    if (data && typeof data === 'object') {
      processedData = processLogData(logId, data);
    }

    return {
      id: logId,
      timestamp: new Date(),
      level,
      source: "frontend",
      message,
      data: processedData,
    };
  };

  const addLog = (logEntry: LogEntry) => {
    set((state) => ({
      frontendLogs: [
        ...state.frontendLogs.slice(-state.maxLogs + 1),
        logEntry,
      ],
    }));
  };

  const interceptConsole = () => {
    if (isDebugWindow) {
      return;
    }
    console.log = (...args) => {
      originalConsole.log(...args);
      const logEntry = createLogEntry("info", args);
      addLog(logEntry);

      bridgeFrontendLog(logEntry);
    };

    console.info = (...args) => {
      originalConsole.info(...args);
      const logEntry = createLogEntry("info", args);
      addLog(logEntry);

      bridgeFrontendLog(logEntry);
    };

    console.warn = (...args) => {
      originalConsole.warn(...args);
      const logEntry = createLogEntry("warn", args);
      addLog(logEntry);

      bridgeFrontendLog(logEntry);
    };

    console.error = (...args) => {
      originalConsole.error(...args);
      const logEntry = createLogEntry("error", args);
      addLog(logEntry);

      bridgeFrontendLog(logEntry);
    };

    console.debug = (...args) => {
      originalConsole.debug(...args);
      const logEntry = createLogEntry("debug", args);
      addLog(logEntry);

      bridgeFrontendLog(logEntry);
    };
  };

  interceptConsole();

  return {
    frontendLogs: [],
    maxLogs: 1000,
    addFrontendLog: (level, message, data) => {
      if (isDebugWindow) {
        return;
      }
      
      const logId = generateUniqueId();
      
      // Process data to replace objects with references
      let processedData = data;
      if (data && typeof data === 'object') {
        processedData = processLogData(logId, data);
      }
      
      const logEntry: LogEntry = {
        id: logId,
        timestamp: new Date(),
        level,
        source: "frontend",
        message,
        data: processedData,
      };
      addLog(logEntry);

      bridgeFrontendLog(logEntry);
    },
    clearFrontendLogs: () => set({ frontendLogs: [] }),
  };
});

