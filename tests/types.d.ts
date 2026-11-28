declare module "@sinclair/typebox" {
  export interface TSchema {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
    items?: unknown;
    anyOf?: unknown[];
    const?: unknown;
    additionalProperties?: unknown;
    description?: string;
    [key: string]: unknown;
  }

  export const Type: {
    Object(properties: Record<string, unknown>, opts?: Record<string, unknown>): TSchema;
    String(opts?: Record<string, unknown>): TSchema;
    Number(opts?: Record<string, unknown>): TSchema;
    Boolean(opts?: Record<string, unknown>): TSchema;
    Array(items: unknown, opts?: Record<string, unknown>): TSchema;
    Optional(schema: unknown): TSchema;
    Union(schemas: unknown[], opts?: Record<string, unknown>): TSchema;
    Literal(value: string | number | boolean, opts?: Record<string, unknown>): TSchema;
    Record(key: unknown, value: unknown, opts?: Record<string, unknown>): TSchema;
    Any(opts?: Record<string, unknown>): TSchema;
    Null(opts?: Record<string, unknown>): TSchema;
  };
}

declare module "@oh-my-pi/pi-coding-agent" {
  export interface RegisteredToolDef {
    name: string;
    label: string;
    description: string;
    parameters: Record<string, unknown>;
    execute: (
      toolCallId: string,
      params: any,
      ctx?: unknown
    ) => Promise<{ content: Array<{ type: string; text: string }>; details?: unknown }>;
  }

  export interface ExtensionAPI {
    registerTool(tool: RegisteredToolDef): void;
    registerFlag(
      name: string,
      options: { description?: string; type: "boolean" | "string"; default?: unknown }
    ): void;
    getFlag(name: string): unknown;
    on(event: string, handler: (event: unknown, ctx: any) => unknown): void;
    pi?: Record<string, unknown>;
  }
}
