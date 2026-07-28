export type PlistNodeType =
  | "dict"
  | "array"
  | "string"
  | "integer"
  | "real"
  | "boolean"
  | "data"
  | "date"
  | "uid"
  | "null";

export interface PlistDictEntry {
  key: string;
  value: PlistNode;
}

export type PlistNode =
  | { type: "dict"; entries: PlistDictEntry[] }
  | { type: "array"; items: PlistNode[] }
  | { type: "string"; value: string }
  | { type: "integer"; value: number | string }
  | { type: "real"; value: number | string }
  | { type: "boolean"; value: boolean }
  | { type: "data"; value: string }
  | { type: "date"; value: string }
  | { type: "uid"; value: number | string }
  | { type: "null" };

export interface PlistParseResult {
  format: string;
  format_code: number;
  root: PlistNode;
  xml_preview?: string;
}

export const PLIST_SCALAR_TYPES: PlistNodeType[] = [
  "string",
  "integer",
  "real",
  "boolean",
  "data",
  "date",
  "uid",
  "null",
];

export const PLIST_ALL_TYPES: PlistNodeType[] = [
  "dict",
  "array",
  ...PLIST_SCALAR_TYPES,
];

export function createDefaultPlistNode(nodeType: PlistNodeType): PlistNode {
  switch (nodeType) {
    case "dict":
      return { type: "dict", entries: [] };
    case "array":
      return { type: "array", items: [] };
    case "string":
      return { type: "string", value: "" };
    case "integer":
      return { type: "integer", value: 0 };
    case "real":
      return { type: "real", value: 0 };
    case "boolean":
      return { type: "boolean", value: false };
    case "data":
      return { type: "data", value: "" };
    case "date":
      return { type: "date", value: new Date().toISOString() };
    case "uid":
      return { type: "uid", value: 0 };
    case "null":
      return { type: "null" };
  }
}

export function convertPlistNodeType(node: PlistNode, nextType: PlistNodeType): PlistNode {
  if (node.type === nextType) {
    return node;
  }

  if (nextType === "dict") {
    if (node.type === "array") {
      return {
        type: "dict",
        entries: node.items.map((item, index) => ({
          key: `Item ${index}`,
          value: item,
        })),
      };
    }
    return { type: "dict", entries: [] };
  }

  if (nextType === "array") {
    if (node.type === "dict") {
      return {
        type: "array",
        items: node.entries.map((entry) => entry.value),
      };
    }
    return { type: "array", items: [] };
  }

  if (nextType === "boolean") {
    if (node.type === "string") {
      return { type: "boolean", value: node.value.toLowerCase() === "true" || node.value === "1" };
    }
    if (node.type === "integer" || node.type === "real" || node.type === "uid") {
      return { type: "boolean", value: Number(node.value) !== 0 };
    }
    if (node.type === "boolean") {
      return node;
    }
    return { type: "boolean", value: false };
  }

  if (nextType === "integer" || nextType === "real" || nextType === "uid") {
    let numericValue: number | string = 0;
    if (node.type === "integer" || node.type === "real" || node.type === "uid") {
      numericValue = node.value;
    } else if (node.type === "string" && node.value.trim() !== "" && !Number.isNaN(Number(node.value))) {
      numericValue = node.value.includes(".") ? Number(node.value) : node.value;
    } else if (node.type === "boolean") {
      numericValue = node.value ? 1 : 0;
    }
    return { type: nextType, value: numericValue } as PlistNode;
  }

  if (nextType === "string") {
    if (node.type === "string" || node.type === "data" || node.type === "date") {
      return { type: "string", value: node.value };
    }
    if (node.type === "boolean") {
      return { type: "string", value: node.value ? "true" : "false" };
    }
    if (node.type === "integer" || node.type === "real" || node.type === "uid") {
      return { type: "string", value: String(node.value) };
    }
    return { type: "string", value: "" };
  }

  if (nextType === "data") {
    if (node.type === "data" || node.type === "string") {
      return { type: "data", value: node.value };
    }
    return { type: "data", value: "" };
  }

  if (nextType === "date") {
    if (node.type === "date" || node.type === "string") {
      return { type: "date", value: node.value || new Date().toISOString() };
    }
    return { type: "date", value: new Date().toISOString() };
  }

  return createDefaultPlistNode(nextType);
}

export function clonePlistNode(node: PlistNode): PlistNode {
  return JSON.parse(JSON.stringify(node)) as PlistNode;
}

export function summarizePlistNode(node: PlistNode): string {
  switch (node.type) {
    case "dict":
      return `${node.entries.length} keys`;
    case "array":
      return `${node.items.length} items`;
    case "string":
      return node.value.length > 48 ? `${node.value.slice(0, 48)}…` : node.value;
    case "integer":
    case "real":
    case "uid":
      return String(node.value);
    case "boolean":
      return node.value ? "true" : "false";
    case "data":
      return node.value ? `${Math.ceil((node.value.length * 3) / 4)} bytes` : "empty";
    case "date":
      return node.value;
    case "null":
      return "null";
  }
}
