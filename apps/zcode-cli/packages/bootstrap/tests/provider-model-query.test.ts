import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResolvedProvider } from "@zcode/provider";
import {
  ZCODE_BUILTIN_PROVIDER_CONFIG_FILE_ENV,
  ZCODE_PERSONAL_PROVIDER_CONFIG_FILE_ENV,
} from "@zcode/provider-node";
import {
  startProcessProviderRegistryRuntime,
} from "../src/app/process-provider-registry-runtime.js";
import type { ZCodeProtocolAgentServerContext } from "../src/zcode-protocol/server-types.js";
import { listProviderModels } from "../src/zcode-protocol/provider-model-query.js";

const workspace = { workspacePath: "/tmp/workspace", workspaceKey: "/tmp/workspace" };
const cleanups: (() => Promise<void>)[] = [];

function createContext(providers: readonly ResolvedProvider[]) {
  return {
    deps: {
      refreshProviderRegistry: vi.fn(async () => {}),
      readProviderConfigSnapshot: () => providers,
    },
  } as unknown as ZCodeProtocolAgentServerContext;
}

function provider(overrides: Partial<ResolvedProvider> = {}): ResolvedProvider {
  return {
    providerId: "new-provider",
    providerName: "New Provider",
    enabled: false,
    config: {
      access: { type: "api-key", apiKey: "test-key" },
      api: { type: "openai-responses", baseUrl: "https://example.com/v1" },
    },
    models: [],
    providerIssues: [],
    ...overrides,
  } as unknown as ResolvedProvider;
}

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

describe("listProviderModels", () => {
  it("未启用且零模型的供应商仍可拉取模型列表", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ data: [{ id: "alpha" }, { id: "beta" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await listProviderModels(createContext([provider()]), {
      providerId: "new-provider",
      workspace,
    });

    expect(result.models).toEqual([
      { id: "alpha", alreadyAdded: false },
      { id: "beta", alreadyAdded: false },
    ]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://example.com/v1/models");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer test-key");
  });

  it("已配置模型标记为 alreadyAdded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ models: [{ id: "alpha" }, { id: "beta" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    const result = await listProviderModels(
      createContext([provider({ models: [{ modelId: "alpha" }] as ResolvedProvider["models"] })]),
      { providerId: "new-provider", workspace },
    );

    expect(result.models).toEqual([
      { id: "alpha", alreadyAdded: true },
      { id: "beta", alreadyAdded: false },
    ]);
  });

  it("配置快照中没有供应商时明确报错", async () => {
    await expect(
      listProviderModels(createContext([]), { providerId: "missing", workspace }),
    ).rejects.toThrow("找不到该供应商配置。");
  });

  it("零模型供应商存在于配置解析快照，但不在 Registry 可执行视图", async () => {
    const directory = await mkdtemp(join(tmpdir(), "provider-model-query-"));
    const personalFile = join(directory, "provider_config.json");
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    await writeFile(
      personalFile,
      JSON.stringify({
        schemaVersion: 1,
        config: {
          providerConfigRules: {
            providerRules: [
              {
                providerId: "new-provider",
                providerName: "New Provider",
                config: {
                  group: "standard-personal",
                  access: { type: "api-key", apiKey: "test-key" },
                  api: { type: "openai-responses", baseUrl: "https://example.com/v1" },
                  personalModelIds: [],
                  modelOrder: [],
                },
              },
            ],
          },
          modelConfigRules: { providerModelRules: [], manualProviderModelRules: [] },
        },
      }),
    );
    const started = await startProcessProviderRegistryRuntime({
      [ZCODE_BUILTIN_PROVIDER_CONFIG_FILE_ENV]: fileURLToPath(
        new URL("../../../../../config/provider/zcode-builtin.json", import.meta.url),
      ),
      [ZCODE_PERSONAL_PROVIDER_CONFIG_FILE_ENV]: personalFile,
    });
    cleanups.unshift(async () => started.dispose());
    const registry = started.runtime.registryService;

    expect(registry.getView().providers.map((item) => item.providerId)).not.toContain(
      "new-provider",
    );
    expect(
      registry.getSnapshot()?.resolution.resolvedProviders.map((item) => item.providerId),
    ).toContain("new-provider");
  });
});
