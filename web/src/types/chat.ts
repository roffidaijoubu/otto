export interface TraceStep {
  label: string;
  done: boolean;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  thinking?: string;
  steps?: TraceStep[];
}

export interface SessionSummary {
  id: string;
  path: string;
  title: string;
  updatedAt: string;
  messageCount: number;
  active: boolean;
}
