/**
 * Zero-dependency Node 22+ module-hook harness allowing direct import and behavioral
 * execution of all 22 `agent/extensions/*.ts` files without installing `node_modules`.
 */

import module from "node:module";
import type { ExtensionAPI, RegisteredToolDef } from "@oh-my-pi/pi-coding-agent";

const VIRTUAL_TYPEBOX = "otto-test://typebox";
const VIRTUAL_PI_AGENT = "otto-test://pi-coding-agent";

const TYPEBOX_STUB_SOURCE = `
const OPTIONAL = Symbol("TypeBox.Optional");
export const Type = {
  Object(properties, opts = {}) {
    const required = [];
    const cleaned = {};
    for (const [k, v] of Object.entries(properties || {})) {
      if (v && typeof v === "object" && v[OPTIONAL]) {
        const { [OPTIONAL]: _ignored, ...rest } = v;
        cleaned[k] = rest;
      } else {
        cleaned[k] = v;
        required.push(k);
      }
    }
    return { type: "object", properties: cleaned, ...(required.length ? { required } : {}), ...opts };
  },
  String(opts = {}) { return { type: "string", ...opts }; },
  Number(opts = {}) { return { type: "number", ...opts }; },
  Boolean(opts = {}) { return { type: "boolean", ...opts }; },
  Array(items, opts = {}) { return { type: "array", items, ...opts }; },
  Optional(schema) { return { ...(schema || {}), [OPTIONAL]: true }; },
  Union(schemas, opts = {}) { return { anyOf: schemas, ...opts }; },
  Literal(value, opts = {}) { return { const: value, ...opts }; },
  Record(_key, value, opts = {}) { return { type: "object", additionalProperties: value, ...opts }; },
  Any(opts = {}) { return { ...opts }; },
  Null(opts = {}) { return { type: "null", ...opts }; },
};
`;

let hooksInstalled = false;

export function installExtensionModuleHooks(): void {
  if (hooksInstalled) return;
  hooksInstalled = true;

  const reg = (
    module as unknown as {
      registerHooks?: (hooks: {
        resolve?: (
          specifier: string,
          context: unknown,
          nextResolve: (s: string, c: unknown) => unknown
        ) => unknown;
        load?: (
          url: string,
          context: unknown,
          nextLoad: (u: string, c: unknown) => unknown
        ) => unknown;
      }) => void;
    }
  ).registerHooks;

  if (typeof reg !== "function") {
    throw new Error("Node >=22.18 with module.registerHooks is required to import agent/extensions/*.ts offline.");
  }

  reg({
    resolve(specifier, context, nextResolve) {
      if (specifier === "@sinclair/typebox") {
        return { url: VIRTUAL_TYPEBOX, shortCircuit: true };
      }
      if (specifier === "@oh-my-pi/pi-coding-agent") {
        return { url: VIRTUAL_PI_AGENT, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (url === VIRTUAL_TYPEBOX) {
        return { format: "module", source: TYPEBOX_STUB_SOURCE, shortCircuit: true };
      }
      if (url === VIRTUAL_PI_AGENT) {
        return { format: "module", source: "export {};", shortCircuit: true };
      }
      return nextLoad(url, context);
    },
  });
}

export interface MockExtensionHarness {
  api: ExtensionAPI;
  tools: Map<string, RegisteredToolDef>;
  flags: Map<string, { description?: string; type: string; default?: unknown }>;
  flagValues: Map<string, unknown>;
  handlers: Map<string, Array<(event: unknown, ctx: any) => unknown>>;
  getTool(name: string): RegisteredToolDef;
}

export function createMockExtensionApi(hostInternals?: Record<string, unknown>): MockExtensionHarness {
  const tools = new Map<string, RegisteredToolDef>();
  const flags = new Map<string, { description?: string; type: string; default?: unknown }>();
  const flagValues = new Map<string, unknown>();
  const handlers = new Map<string, Array<(event: unknown, ctx: any) => unknown>>();

  const api: ExtensionAPI = {
    registerTool(def) {
      if (tools.has(def.name)) {
        throw new Error(`Duplicate tool registration detected: ${def.name}`);
      }
      tools.set(def.name, def);
    },
    registerFlag(name, options) {
      flags.set(name, options);
      if (!flagValues.has(name)) {
        flagValues.set(name, options.default);
      }
    },
    getFlag(name) {
      return flagValues.get(name);
    },
    on(event, handler) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    ...(hostInternals ? { pi: hostInternals } : {}),
  };

  return {
    api,
    tools,
    flags,
    flagValues,
    handlers,
    getTool(name: string): RegisteredToolDef {
      const tool = tools.get(name);
      if (!tool) {
        throw new Error(`Tool '${name}' was not registered.`);
      }
      return tool;
    },
  };
}
