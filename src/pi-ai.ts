/**
 * Minimal shim for @earendil-works/pi-ai types
 * Only exports what the experiments need
 */

export type Static<T> = T extends { readonly static: infer S } ? S : never;
export type TSchema = { readonly static?: unknown };

export type StopReason = "stop" | "toolUse" | "length" | "error" | "aborted";

export type ToolCall = {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type TextContent = {
  type: "text";
  text: string;
};

export type AssistantMessageContent = TextContent | ToolCall;

export type AssistantMessage = {
  role: "assistant";
  content: AssistantMessageContent[];
  api: string;
  provider: string;
  model: string;
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    totalTokens: number;
    cost: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      total: number;
    };
  };
  stopReason: StopReason;
  timestamp: number;
};

export type UserMessage = {
  role: "user";
  content: string;
  timestamp: number;
};

export type ToolResultMessage = {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
  usage?: unknown;
  addedToolNames?: string[];
  isError: boolean;
  timestamp: number;
};

export type Message = UserMessage | AssistantMessage | ToolResultMessage;

export type Context = {
  systemPrompt: string;
  messages: Message[];
  tools: unknown[];
};

export type Model<Api extends string = string> = {
  id: string;
  name: string;
  api: Api;
  provider: string;
  baseUrl: string;
  reasoning: boolean;
  input: string[];
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  contextWindow: number;
  maxTokens: number;
};

export type AssistantMessageEvent =
  | { type: "start"; partial: AssistantMessage }
  | { type: "text_start"; partial: AssistantMessage }
  | { type: "text_delta"; partial: AssistantMessage }
  | { type: "text_end"; partial: AssistantMessage }
  | { type: "thinking_start"; partial: AssistantMessage }
  | { type: "thinking_delta"; partial: AssistantMessage }
  | { type: "thinking_end"; partial: AssistantMessage }
  | { type: "toolcall_start"; partial: AssistantMessage }
  | { type: "toolcall_delta"; partial: AssistantMessage }
  | { type: "toolcall_end"; partial: AssistantMessage }
  | { type: "done"; message: AssistantMessage }
  | { type: "error"; error: AssistantMessage };

export class EventStream<TEvent, TResult> {
  private queue: TEvent[] = [];
  private waiting: ((value: IteratorResult<TEvent>) => void)[] = [];
  private done = false;
  private finalResultPromise: Promise<TResult>;
  private resolveFinalResult!: (result: TResult) => void;
  private isComplete: (event: TEvent) => boolean;
  private extractResult: (event: TEvent) => TResult;

  constructor(isComplete: (event: TEvent) => boolean, extractResult: (event: TEvent) => TResult) {
    this.isComplete = isComplete;
    this.extractResult = extractResult;
    this.finalResultPromise = new Promise((resolve) => {
      this.resolveFinalResult = resolve;
    });
  }

  push(event: TEvent): void {
    if (this.done) return;

    if (this.isComplete(event)) {
      this.done = true;
      this.resolveFinalResult(this.extractResult(event));
    }

    const waiter = this.waiting.shift();
    if (waiter) {
      waiter({ value: event, done: false });
    } else {
      this.queue.push(event);
    }
  }

  end(result?: TResult): void {
    this.done = true;
    if (result !== undefined) {
      this.resolveFinalResult(result);
    }
    while (this.waiting.length > 0) {
      const waiter = this.waiting.shift()!;
      waiter({ value: undefined as unknown as TEvent, done: true });
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<TEvent> {
    while (true) {
      if (this.queue.length > 0) {
        yield this.queue.shift()!;
      } else if (this.done) {
        return;
      } else {
        const result = await new Promise<IteratorResult<TEvent>>((resolve) => this.waiting.push(resolve));
        if (result.done) return;
        yield result.value;
      }
    }
  }

  result(): Promise<TResult> {
    return this.finalResultPromise;
  }
}

export function validateToolArguments(tool: unknown, toolCall: unknown): unknown {
  return (toolCall as { arguments: unknown }).arguments;
}
