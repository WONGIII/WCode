# 503 响应是否归为上下文超限

## 背景

模型请求失败分类器会把文本里同时出现 `context` 与 `exceed` 的响应归为 `context_exceeded`，即使 HTTP 状态是 503。第三方网关在超时/上游不可用时可能返回 503 + `context deadline exceeded`，这会触发一次没有意义的 reactive 上下文压缩。

## 设置

- 设置项：`classify503AsContextExceeded`，布尔值，默认 `true`（保持上游行为）。
- 关闭后：HTTP 503 不再进入上下文超限分支，按普通 5xx 服务端错误处理，沿用现有重试策略；不会触发 reactive compact。
- 开启后：保持现有行为，503 响应体匹配上下文超限特征时仍归为 `context_exceeded`。
- 400 / 422 不受此开关影响，继续按响应体判断是否为上下文超限。

## 状态与同步

- **唯一所有者**：`AppSettings.classify503AsContextExceeded`，由设置页写入 setting 文件。
- 设置页更新后，经 `syncAppRuntimePreferences` 同步到 CLI 进程：
  - 已存在的 resident session 立即更新 model adapter；
  - 新建 session 从进程偏好继承；
  - 同步失败时设置页保留错误反馈，不回滚已保存的设置。

```text
Settings switch
  → settingService.update
  → syncAppRuntimePreferences
  → CLI workspace/updateFailureHandlingPreferences
  → context.appRuntimePreferences
  → 已存在 session 的 model adapter
  → 下一次 classifyModelFailure
```

## 验收

1. 开关开启（默认），模拟 503 + `context deadline exceeded` → 分类为 `context_exceeded`，行为与上游一致。
2. 开关关闭，同样的 503 响应 → 分类为可重试的服务端错误，不产生 reactive compact。
3. 开关关闭，400 + `context length exceeded` → 仍分类为 `context_exceeded`。
4. 开关切换后，当前已运行的会话在下一次模型请求即生效；新建会话继承同一设置。
