/** Typed ledger errors; the HTTP filter maps `status`/`code` to the API error body. */
export class LedgerError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvestigationNotFoundError extends LedgerError {
  constructor(id: string) {
    super("INVESTIGATION_NOT_FOUND", `Investigation ${id} not found`, 404);
  }
}

export class IllegalTransitionError extends LedgerError {
  constructor(
    readonly investigationId: string,
    readonly from: string,
    readonly to: string,
    readonly actual: string | null,
  ) {
    super(
      "ILLEGAL_TRANSITION",
      actual !== null && actual !== from
        ? `Investigation ${investigationId} is ${actual}, expected ${from} for ${from} → ${to}`
        : `Transition ${from} → ${to} is not allowed`,
      409,
    );
  }
}

export class ToolExecutionStateError extends LedgerError {
  constructor(toolExecutionId: string, actual: string, action: string) {
    super("TOOL_EXECUTION_STATE", `Tool execution ${toolExecutionId} is ${actual}; cannot ${action}`, 409);
  }
}

export class CallerRefReusedError extends LedgerError {
  constructor(callerRef: string) {
    super("CALLER_REF_REUSED", `The call id "${callerRef}" was already used for a different tool or input; use a new call id for a new call.`, 409);
  }
}
