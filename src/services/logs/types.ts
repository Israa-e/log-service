export interface LogEntry {
  timestamp: string;
  level: string;
  service: string;
  message: string;
  attributes?: Record<string, string | number | boolean>;
}

export interface InsertResult {
  accepted: number;
  rejected: { index: number; reason: string }[];
}

export type ValidationResult =
  | { valid: true; row: (string | null)[]; epochMs: number }
  | { valid: false; reason: string };
