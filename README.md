# PI 自定义供应商

用于在 PI 中连接和管理自定义模型网关。安装后运行 `/providers`，即可添加供应商、发现模型和配置请求协议，不需要手工编辑 JSON 文件。

## 功能

- 管理多个自定义供应商
- 手工添加模型，或通过 `/v1/models` 自动发现
- 为不同模型选择 Anthropic Messages 或 OpenAI Responses
- 使用精准规则和 `*`、`?` 通配规则分配请求协议
- 移除并持续忽略不需要的自动发现模型
- PI 启动后自动刷新模型列表
- API 密钥隐藏输入，并交给 PI 保存
- 支持简体中文、英文和自动语言检测

目前不支持 Chat Completions。

## 安装

### 从 GitHub 安装（推荐）

为当前用户全局安装：

```bash
pi install git:github.com/fangzhengjin/pi-custom-provider
```

也可以使用完整的 HTTPS 地址：

```bash
pi install https://github.com/fangzhengjin/pi-custom-provider
```

PI 会克隆仓库并自动安装运行依赖。安装完成后重新启动 PI，再执行 `/providers`。

更新通过 Git 安装的扩展：

```bash
pi update --extensions
```

卸载：

```bash
pi remove git:github.com/fangzhengjin/pi-custom-provider
```

### 临时试用

无需安装即可运行：

```bash
pi -e git:github.com/fangzhengjin/pi-custom-provider
```

### 关于 npm

目前直接从 GitHub 安装即可，不依赖 npm 发布。

## 快速开始

1. 启动 PI，运行 `/providers`。
2. 选择“添加供应商”。
3. 输入供应商名称、网关根地址和 API 密钥。
4. 选择默认请求协议。
5. 选择从 `/v1/models` 自动发现模型，或手工输入模型标识。
6. 保存后通过 `/model` 选择新模型。

网关地址填写根地址即可，例如：

```text
https://gateway.example.com
```

扩展会自动使用：

- `/v1/models` 发现模型
- `/v1/messages` 发送 Anthropic Messages 请求
- `/v1/responses` 发送 OpenAI Responses 请求

## 常用操作

进入 `/providers` 并选择供应商后，可以：

- 修改网关地址、API 密钥和默认协议
- 管理模型列表
- 为指定模型设置请求协议
- 添加有序通配兜底规则
- 调整高级协议能力
- 刷新自动发现的模型
- 删除供应商

编辑地址或密钥时，留空表示保留当前值。

### 管理模型

手工模型可以直接移除。自动发现的模型在移除后会持续忽略，后续刷新不会重新加入；需要时可以从“恢复已忽略模型”中找回。

扩展不会根据名称猜测模型类型。图片生成、`embedding`（嵌入）、`rerank`（重排）和语音模型需要由用户自行移除。当前活动模型和供应商的最后一个模型不能移除。

### 请求协议

请求协议按以下顺序决定：

1. 指定模型的精准设置
2. 第一个命中的 `*` 或 `?` 通配规则
3. 供应商默认协议

### 自动刷新

PI 启动后会在后台刷新自动发现的模型。列表发生变化时会显示新增和移除数量；刷新失败或超时则继续使用原列表，不影响启动。

`pi --list-models` 只显示上次保存的模型列表，不会主动访问网关。

## 高级协议能力

大多数用户不需要修改高级设置。只有网关不支持某项协议能力，或需要特定兼容行为时，才进入“模型协议能力（高级）”调整。

切换模型请求协议后，扩展会自动应用对应协议的默认能力。新的 Anthropic 兼容模型默认启用自适应思考。

## 使用限制

- 只支持 Anthropic Messages 和 OpenAI Responses
- 不支持 Chat Completions
- 不自动识别模型是否适合普通对话
- 不提供模型价格或价格倍率
- 专用图片生成、嵌入、重排和语音模型不能直接作为普通对话模型使用

更详细的实现和数据安全说明见 [设计文档](docs/design.md)。

## 开发

项目统一使用 Bun。

```bash
bun install
bun test
bun run check
```
