// @generated
// `@dsh-boot/sdk` — OpenAPI 生成物（`contracts/openapi.json`），不手写（`ENG-020` 判据③）。
// 任何修改都必须通过生成器重放（node tools/gen-sdk.mjs），CI 校验生成物与 OpenAPI 一致。
export const OPENAPI_VERSION = "3.1.0" as const;
export const INFO_TITLE = "DSH 企业级平台 OpenAPI" as const;

export interface SdkOperation {
  readonly operationId: string;
  readonly method: string;
  readonly path: string;
}

export const OPERATIONS: readonly SdkOperation[] = [
  { operationId: "cancelTurn", method: "POST", path: "/v1/sessions/{id}/turns/{tid}/cancel" },
  { operationId: "createSession", method: "POST", path: "/v1/sessions" },
  { operationId: "createTurn", method: "POST", path: "/v1/sessions/{id}/turns" },
  { operationId: "createUpload", method: "POST", path: "/v1/sessions/{id}/uploads" },
  { operationId: "createWorkspace", method: "POST", path: "/v1/workspaces" },
  { operationId: "decideApproval", method: "POST", path: "/v1/sessions/{id}/approvals/{aid}" },
  { operationId: "deleteSession", method: "DELETE", path: "/v1/sessions/{id}" },
  { operationId: "deleteSessionFile", method: "DELETE", path: "/v1/sessions/{id}/files/{path}" },
  { operationId: "deleteWorkspace", method: "DELETE", path: "/v1/workspaces/{id}" },
  { operationId: "deleteWorkspaceFile", method: "DELETE", path: "/v1/workspaces/{id}/files/{path}" },
  { operationId: "exportUsage", method: "GET", path: "/v1/usage/export" },
  { operationId: "getSession", method: "GET", path: "/v1/sessions/{id}" },
  { operationId: "getToolCall", method: "GET", path: "/v1/sessions/{id}/turns/{tid}/calls/{callId}" },
  { operationId: "getTrajectory", method: "GET", path: "/v1/sessions/{id}/trajectory" },
  { operationId: "getUsage", method: "GET", path: "/v1/usage" },
  { operationId: "getWorkspace", method: "GET", path: "/v1/workspaces/{id}" },
  { operationId: "listApprovals", method: "GET", path: "/v1/approvals" },
  { operationId: "listConnectors", method: "GET", path: "/v1/connectors" },
  { operationId: "listMessages", method: "GET", path: "/v1/sessions/{id}/messages" },
  { operationId: "listPlugins", method: "GET", path: "/v1/plugins" },
  { operationId: "listProviders", method: "GET", path: "/v1/llm/providers" },
  { operationId: "listScenarios", method: "GET", path: "/v1/scenarios" },
  { operationId: "listSessionFiles", method: "GET", path: "/v1/sessions/{id}/files" },
  { operationId: "listSessionTools", method: "GET", path: "/v1/sessions/{id}/tools" },
  { operationId: "listSkills", method: "GET", path: "/v1/skills" },
  { operationId: "listWorkspaceFiles", method: "GET", path: "/v1/workspaces/{id}/files" },
  { operationId: "listWorkspaceSessions", method: "GET", path: "/v1/workspaces/{id}/sessions" },
  { operationId: "listWorkspaces", method: "GET", path: "/v1/workspaces" },
  { operationId: "readSessionFile", method: "GET", path: "/v1/sessions/{id}/files/{path}" },
  { operationId: "readWorkspaceFile", method: "GET", path: "/v1/workspaces/{id}/files/{path}" },
  { operationId: "streamEvents", method: "GET", path: "/v1/sessions/{id}/events" },
  { operationId: "unregisterWorkspace", method: "POST", path: "/v1/workspaces/{id}:unregister" },
  { operationId: "writeSessionFile", method: "PUT", path: "/v1/sessions/{id}/files/{path}" },
  { operationId: "writeWorkspaceFile", method: "PUT", path: "/v1/workspaces/{id}/files/{path}" },
] as const;

export const OPERATION_IDS: readonly string[] = OPERATIONS.map((op) => op.operationId);
