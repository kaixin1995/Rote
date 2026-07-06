# 用户本地 AI

Rote 支持让已登录用户在自己的电脑上运行模型。模型请求由浏览器直接发送到用户电脑上的本地桥接器，不经过 Rote 后端。

## 权限

- 访客不能进入 AI 页面。
- 所有已登录用户都可以使用本地模型进行普通对话。
- 只有满足站点原有 AI 使用条件的用户，才能让本地模型检索自己的 Rote 数据：
  - 用户已认证；
  - 管理员已启用 AI 与向量能力；
  - 笔记已经完成向量索引。
- 本地模型配置与桥接器 Token 仅保存在当前浏览器设备。

## 1. 启动 Gemma

安装支持 `llama-server` 的最新版 llama.cpp，然后运行：

```bash
llama-server \
  -hf google/gemma-4-12B-it-qat-q4_0-gguf \
  --alias gemma-4-12b-it-local \
  --host 127.0.0.1 \
  --port 8080 \
  --jinja \
  -ngl 99
```

如果需要限制上下文或 16GB 内存设备出现内存压力，可以手动添加 `--ctx-size 4096`。

## 2. 启动本地桥接器

在 Rote 仓库根目录运行：

```bash
ROTE_ALLOWED_ORIGINS=https://your-rote.example \
ROTE_LOCAL_AI_TOKEN=change-this-local-token \
bun run scripts/local-ai-bridge.ts
```

本地开发时，默认允许 `http://localhost:3001` 和 `http://localhost:18001`。线上站点必须通过 `ROTE_ALLOWED_ORIGINS` 填写浏览器地址，多个地址使用逗号分隔。

桥接器仅监听 `127.0.0.1:11435`，只代理 `/v1/models` 和 `/v1/chat/completions`，并处理桌面 Chrome / Edge 所需的 CORS 与本地网络预检。

可选环境变量：

| 变量                           | 默认值                  | 说明                              |
| ------------------------------ | ----------------------- | --------------------------------- |
| `ROTE_LOCAL_AI_BRIDGE_PORT`    | `11435`                 | 本地桥接器端口                    |
| `ROTE_LOCAL_AI_UPSTREAM`       | `http://127.0.0.1:8080` | llama-server 地址                 |
| `ROTE_LOCAL_AI_TOKEN`          | 启动时随机生成          | 浏览器连接桥接器使用的 Token      |
| `ROTE_LOCAL_AI_UPSTREAM_TOKEN` | 空                      | llama-server 自身配置的 API Token |
| `ROTE_ALLOWED_ORIGINS`         | 本地开发地址            | 允许访问桥接器的 Rote 页面来源    |

## 3. 在 Rote 中连接

1. 登录 Rote 并进入 `记忆`。
2. 选择 `本地模型`。
3. 填写：
   - 桥接器地址：`http://127.0.0.1:11435`
   - 模型名称：`gemma-4-12b-it-local`
   - Token：启动桥接器时显示或配置的 Token
4. 点击 `测试本地连接`。

本地模型连接失败时，Rote 不会自动回退到站点模型。
