import { zcodeWorkspaceUpdateFailureHandlingPreferencesParamsSchema } from "@zcode/shared";
import { parseParams, type ZCodeProtocolAgentServerContext } from "./server-types.js";

/**
 * 失败分类策略是 App 全局偏好，但每个 resident session 持有独立 model adapter。
 * 与 ModelIO 偏好相同：协议层缓存偏好供未来 session 继承，并立即更新已有 session，
 * 避免当前会话仍按旧策略把 503 当成上下文超限而触发无意义压缩。
 */
export async function updateFailureHandlingPreferences(
  context: ZCodeProtocolAgentServerContext,
  rawParams: unknown,
) {
  const params = parseParams(
    zcodeWorkspaceUpdateFailureHandlingPreferencesParamsSchema,
    rawParams,
  );
  const enabled = params.preferences.classify503AsContextExceeded;
  context.appRuntimePreferences.classify503AsContextExceeded = enabled;

  let updatedSessionCount = 0;
  for (const record of context.sessions.values()) {
    if (!record.app.setClassify503AsContextExceeded) continue;
    record.app.setClassify503AsContextExceeded(enabled);
    updatedSessionCount += 1;
  }

  return {
    workspace: params.workspace,
    classify503AsContextExceeded: enabled,
    updatedSessionCount,
  };
}
