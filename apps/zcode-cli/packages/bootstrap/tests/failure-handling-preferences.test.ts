import { describe, expect, it, vi } from "vitest";
import type { ZCodeProtocolAgentServerContext } from "../src/zcode-protocol/server-types.js";
import { updateFailureHandlingPreferences } from "../src/zcode-protocol/failure-handling-preferences.js";

const workspace = { workspacePath: "/tmp/workspace", workspaceKey: "/tmp/workspace" };

function createContext() {
  const setClassify503AsContextExceeded = vi.fn();
  const context = {
    appRuntimePreferences: {
      classify503AsContextExceeded: true,
    },
    sessions: new Map([["session-1", { app: { setClassify503AsContextExceeded } }]]),
  } as unknown as ZCodeProtocolAgentServerContext;
  return { context, setClassify503AsContextExceeded };
}

describe("updateFailureHandlingPreferences", () => {
  it("缓存偏好并立即更新已有 session", async () => {
    const { context, setClassify503AsContextExceeded } = createContext();

    const result = await updateFailureHandlingPreferences(context, {
      workspace,
      preferences: { classify503AsContextExceeded: false },
    });

    expect(result).toEqual({
      workspace,
      classify503AsContextExceeded: false,
      updatedSessionCount: 1,
    });
    expect(context.appRuntimePreferences.classify503AsContextExceeded).toBe(false);
    expect(setClassify503AsContextExceeded).toHaveBeenCalledWith(false);
  });
});
