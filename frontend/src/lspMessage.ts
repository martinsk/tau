export interface LspRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

export interface LspResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
}

export interface LspErrorResponse {
  jsonrpc: "2.0";
  id: number;
  error: unknown;
}

export interface LspNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export type LspMessage =
  | LspRequest
  | LspResponse
  | LspErrorResponse
  | LspNotification;

export function isLspMessage(value: unknown): value is LspMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>).jsonrpc === "2.0"
  );
}

export function isResponse(
  msg: LspMessage
): msg is LspResponse | LspErrorResponse {
  return "id" in msg && !("method" in msg);
}
