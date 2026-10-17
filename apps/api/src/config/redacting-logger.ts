import { ConsoleLogger, type LogLevel } from "@nestjs/common";

const SECRET_NAME = /(KEY|TOKEN|SECRET|PASSWORD)/;
const MIN_SECRET_LENGTH = 4; // shorter values would redact ordinary words

/** Returns a function that replaces every value of a secret-named env variable with `[REDACTED:<NAME>]`. */
export function createRedactor(env: Record<string, string | undefined> = process.env): (text: string) => string {
  const secrets = Object.entries(env)
    .filter((e): e is [string, string] => SECRET_NAME.test(e[0]) && (e[1]?.length ?? 0) >= MIN_SECRET_LENGTH)
    .sort((a, b) => b[1].length - a[1].length); // longest first so overlapping values are fully covered
  return (text) => secrets.reduce((out, [name, value]) => out.split(value).join(`[REDACTED:${name}]`), text);
}

/** Nest console logger that redacts secret values from every formatted line and stack trace. */
export class RedactingLogger extends ConsoleLogger {
  private readonly redact: (text: string) => string;

  constructor(env: Record<string, string | undefined> = process.env) {
    super();
    this.redact = createRedactor(env);
  }

  protected override formatMessage(
    logLevel: LogLevel,
    message: unknown,
    pidMessage: string,
    formattedLogLevel: string,
    contextMessage: string,
    timestampDiff: string,
  ): string {
    return this.redact(
      super.formatMessage(logLevel, message, pidMessage, formattedLogLevel, contextMessage, timestampDiff),
    );
  }

  protected override printStackTrace(stack: string | undefined): void {
    if (!stack) return;
    super.printStackTrace(this.redact(stack));
  }
}
