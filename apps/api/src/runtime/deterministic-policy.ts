import type { ToolResult } from "@campaign-sentinel/contracts";
import { demoPolicy } from "./demo-policy";
import type { Policy, PolicyStep } from "./policy-kit";
import type { AgentSession, AgentTask, AgentTurn, ToolResultForModel } from "./session";
import { urlPolicy } from "./url-policy";

export const DETERMINISTIC_MODEL = "deterministic-policy-v1";

/**
 * The no-AI runtime (spec §5.2, §5.8): the same AgentSession contract as a model, one tool call per turn,
 * driven by a generic rule tree over tool results; ends by submitting a template report citing evidence.
 */
export class DeterministicPolicy implements AgentSession {
  readonly model = DETERMINISTIC_MODEL;
  private policy: Policy | null = null;
  private calls = 0;
  private submitted = false;

  async start(task: AgentTask): Promise<AgentTurn> {
    this.policy = task.mode === "demo" ? demoPolicy() : urlPolicy();
    return this.turn(this.policy.next());
  }

  async continue(results: ToolResultForModel[]): Promise<AgentTurn> {
    // after submit_report the policy has nothing more to say (a rejected template report ends the run as NO_REPORT)
    if (!this.policy || this.submitted) return { stopReason: "end_turn", toolCalls: [], text: "Report submitted." };
    const result: ToolResult = results[0]?.result ?? { ok: false, error: { code: "NO_RESULT", message: "No tool result.", retryable: false } };
    return this.turn(this.policy.next(result));
  }

  private turn(step: IteratorResult<PolicyStep, unknown>): AgentTurn {
    const ref = `det-${++this.calls}`;
    if (step.done) {
      this.submitted = true;
      const input = { reason: "Submit the report built from the collected evidence.", report: step.value };
      return { stopReason: "tool_use", toolCalls: [{ callerRef: ref, tool: "submit_report", input }] };
    }
    return { stopReason: "tool_use", toolCalls: [{ callerRef: ref, tool: step.value.tool, input: step.value.input }] };
  }
}
