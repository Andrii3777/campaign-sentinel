import { Inject, Injectable } from "@nestjs/common";
import { APP_CONFIG, type AppConfig } from "../config/config";
import type { Investigation } from "../ledger/ledger.service";
import { DeterministicPolicy } from "./deterministic-policy";
import { createProviderSession } from "./providers/provider-config";
import { AgentSessionError, type AgentSession } from "./session";

/**
 * `createSession(investigation)` — the hook the Runner uses to get a session for a run.
 * `deterministic` → the rule tree; `ai` → the session of `LLM_PROVIDER` (Anthropic / OpenAI / Gemini).
 * `openclaw` runs have no session: the Runner hands them to the OpenClawDispatcher. Tests replace the method.
 */
@Injectable()
export class SessionFactory {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  createSession(investigation: Investigation): AgentSession {
    if (investigation.runtime === "deterministic") return new DeterministicPolicy();
    if (investigation.runtime === "ai") return createProviderSession(this.config);
    throw new AgentSessionError("RUNTIME_UNAVAILABLE", `The ${investigation.runtime} runtime has no built-in session.`);
  }
}
