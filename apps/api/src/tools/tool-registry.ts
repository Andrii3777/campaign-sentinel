import { Injectable } from "@nestjs/common";
import { toolSpecs, type ToolMode, type ToolName } from "@campaign-sentinel/contracts";
import type { ToolHandler } from "./tool.types";

/**
 * Tool implementations by name. Tool modules register their handlers on init
 * (e.g. `registry.register("demo", handlers)`); the executor core never changes for a new tool.
 */
@Injectable()
export class ToolRegistry {
  private readonly handlers = new Map<ToolName, ToolHandler>();

  /** Registers handlers of one mode; throws if a tool belongs to another mode or is already registered. */
  register(mode: ToolMode, handlers: ToolHandler[]): void {
    for (const handler of handlers) {
      const spec = toolSpecs.find((s) => s.name === handler.name);
      if (!spec || spec.mode !== mode) throw new TypeError(`tool ${handler.name} is not a ${mode}-mode tool`);
      if (this.handlers.has(handler.name)) throw new TypeError(`tool ${handler.name} is already registered`);
      this.handlers.set(handler.name, handler);
    }
  }

  get(name: ToolName): ToolHandler | undefined {
    return this.handlers.get(name);
  }
}
