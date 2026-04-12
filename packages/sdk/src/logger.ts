import type { LogLevel } from "./types.js";

export interface Logger {
  error(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
  trace(message: string, context?: Record<string, unknown>): void;
}

const weights: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4
};

type ConsoleMethod = "error" | "warn" | "info" | "debug";

/** 创建默认控制台日志器。 */
export function createConsoleLogger(level: LogLevel = "warn"): Logger {
  const currentWeight = weights[level];

  const log = (targetLevel: LogLevel, message: string, context?: Record<string, unknown>) => {
    if (weights[targetLevel] > currentWeight) {
      return;
    }

    const prefix = `[pbn-sdk][${targetLevel}] ${message}`;
    const method: ConsoleMethod = targetLevel === "trace" ? "debug" : targetLevel;
    if (context && Object.keys(context).length > 0) {
      console[method](prefix, context);
      return;
    }
    console[method](prefix);
  };

  return {
    error: (message, context) => log("error", message, context),
    warn: (message, context) => log("warn", message, context),
    info: (message, context) => log("info", message, context),
    debug: (message, context) => log("debug", message, context),
    trace: (message, context) => log("trace", message, context)
  };
}
