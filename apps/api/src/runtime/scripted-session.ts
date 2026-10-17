import type { AgentSession, AgentTask, AgentTurn, ToolResultForModel } from "./session";

/** One scripted step: a turn, a function of the previous results, or an error to throw. */
export type ScriptStep = AgentTurn | Error | ((results: ToolResultForModel[]) => AgentTurn | Promise<AgentTurn>);

/** Test double (spec §5.2): replays canned turns, malformed ones included; records what it received. */
export class ScriptedSession implements AgentSession {
  readonly received: ToolResultForModel[][] = [];
  readonly nudges: string[] = [];
  task: AgentTask | null = null;
  private index = 0;

  constructor(
    private readonly steps: ScriptStep[],
    readonly model = "scripted",
  ) {}

  async start(task: AgentTask): Promise<AgentTurn> {
    this.task = task;
    return this.next([]);
  }

  async continue(results: ToolResultForModel[], nudge?: string): Promise<AgentTurn> {
    this.received.push(results);
    if (nudge) this.nudges.push(nudge);
    return this.next(results);
  }

  private async next(results: ToolResultForModel[]): Promise<AgentTurn> {
    const step = this.steps[this.index++];
    if (step === undefined) return { stopReason: "end_turn", toolCalls: [], text: "Script finished." };
    if (step instanceof Error) throw step;
    return typeof step === "function" ? step(results) : step;
  }
}

let refs = 0;
/** A turn with the given calls; callerRefs are unique across the test run. */
export const toolTurn = (...calls: { tool: string; input: unknown }[]): AgentTurn => ({
  stopReason: "tool_use",
  toolCalls: calls.map((c) => ({ ...c, callerRef: `scripted-${++refs}` })),
  usage: { inputTokens: 100, outputTokens: 20 },
});
