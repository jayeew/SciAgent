# ChatAlibabaTongyi 图片上传能力（Chatflow）详细试验方案

## 1. Summary

-   目标：为 `ChatAlibabaTongyi` 节点补齐与现有多模态节点一致的图片上传能力，并在 Chatflow 的 5 类链路中完成真实 DashScope 验证。
-   范围：仅 Chatflow（`LLMChain`、`Conversation Chain`、`ReAct Agent`、`Conversational Agent`、`Tool Agent`）。
-   固定条件：先固定北京 endpoint（`https://dashscope.aliyuncs.com/compatible-mode/v1`），使用真实 API 调用验证。
-   非目标：本轮不覆盖 Agentflow，不扩展地域 endpoint 参数。

## 2. 当前实现基线（已确认）

-   当前 Tongyi 节点返回的是 LangChain 原生 `ChatOpenAI`，没有 `multiModalOption`，因此不会进入图片注入逻辑。
-   Chatflow 图片入口依赖两层条件：

1. 节点输入里有 `allowImageUploads=true`（控制前端是否开放上传）。
2. 运行时模型实例实现了 `IVisionChatModal`（`multiModalOption` 存在），链路才会把上传图片转为 `image_url`。

-   关键现状文件：

1. [ChatAlibabaTongyi.ts](/home/jayee/workspace/SciAgent/packages/components/nodes/chatmodels/ChatAlibabaTongyi/ChatAlibabaTongyi.ts)
2. [multiModalUtils.ts](/home/jayee/workspace/SciAgent/packages/components/src/multiModalUtils.ts)
3. [getUploadsConfig.ts](/home/jayee/workspace/SciAgent/packages/server/src/utils/getUploadsConfig.ts)
4. [FlowiseChatOpenAI.ts](/home/jayee/workspace/SciAgent/packages/components/nodes/chatmodels/ChatOpenAI/FlowiseChatOpenAI.ts)

## 3. 实现规格（决策完成）

-   仅改一个节点文件，复用现有 `FlowiseChatOpenAI` 包装类，不新建 Tongyi 专属 wrapper。
-   具体改动：

1. 在 [ChatAlibabaTongyi.ts](/home/jayee/workspace/SciAgent/packages/components/nodes/chatmodels/ChatAlibabaTongyi/ChatAlibabaTongyi.ts) 增加输入参数：
   `allowImageUploads: boolean`（默认 `false`）  
   `imageResolution: options(low/high/auto)`（仅在 `allowImageUploads=true` 显示，默认 `low`）
2. `init()` 中读取上述参数，构造 `multiModalOption.image`。
3. 返回模型从 `new ChatOpenAI(obj)`（LangChain）改为 `new ChatOpenAI(nodeData.id, obj)`（Flowise wrapper），并调用 `setMultiModalOption(multiModalOption)`。
4. 节点版本号从 `2.0` 提升到 `3.0`。

-   设计原因：复用 `FlowiseChatOpenAI` 可直接接入现有视觉链路，并兼容 `ConversationChain` 中对 OpenAI 类模型的分支处理。

## 4. 对外接口/类型变更

-   节点输入 schema 新增：

1. `allowImageUploads?: boolean`
2. `imageResolution?: 'low' | 'high' | 'auto'`

-   无全局接口改动（`IMultiModalOption` 不变）。
-   节点运行时返回对象具备 `IVisionChatModal` 能力（通过现有 Flowise wrapper 实现）。

## 5. 测试与试验设计

### 5.1 本地单测（不依赖外网）

-   新增测试文件：
    [ChatAlibabaTongyi.test.ts](/home/jayee/workspace/SciAgent/packages/components/test/nodes/chatmodels/ChatAlibabaTongyi.test.ts)
-   用例：

1. `allowImageUploads` 未配置时，`multiModalOption.image.allowImageUploads === false`
2. `allowImageUploads=true` 且 `imageResolution=high` 时，配置正确写入模型
3. 返回模型满足 `llmSupportsVision(model) === true`
4. `configuration.baseURL` 仍为北京 endpoint

-   执行命令：
    `pnpm test --filter=flowise-components --testNamePattern="ChatAlibabaTongyi"`

### 5.2 Chatflow 真实联调（DashScope）

-   环境前提：

1. 配置可用的 `DASHSCOPE_API_KEY`（北京地域）
2. 在 Flowise 凭据中配置 `AlibabaApi`
3. 准备测试图：PNG/JPEG/WEBP（各 1 张，<=5MB）

-   流程来源：复用 marketplace 模板并替换模型为 Tongyi。
    模板文件：

1. [LLM Chain.json](/home/jayee/workspace/SciAgent/packages/server/marketplaces/chatflows/LLM%20Chain.json)
2. [Conversation Chain.json](/home/jayee/workspace/SciAgent/packages/server/marketplaces/chatflows/Conversation%20Chain.json)
3. [ReAct Agent.json](/home/jayee/workspace/SciAgent/packages/server/marketplaces/chatflows/ReAct%20Agent.json)
4. [Conversational Agent.json](/home/jayee/workspace/SciAgent/packages/server/marketplaces/chatflows/Conversational%20Agent.json)
5. [Tool Agent.json](/home/jayee/workspace/SciAgent/packages/server/marketplaces/chatflows/Tool%20Agent.json)

-   试验批次：

1. 批次 A（功能覆盖）：5 种链路 × `qwen3.5-plus` × PNG 上传
2. 批次 B（格式覆盖）：`LLMChain` × `qwen3.5-plus` × PNG/JPEG/WEBP/URL 图片
3. 批次 C（模型覆盖）：`LLMChain` × `qwen-plus`/`qwen3.5-flash`/`qwen3.5-plus` × PNG
4. 批次 D（回归）：5 种链路文本-only（无图片）行为不变

-   每条用例统一输入：
    `图中描绘的是什么景象？请列出3个关键物体。`

### 5.3 验收标准（必须全部满足）

1. `allowImageUploads=true` 时，聊天界面出现图片上传入口；`false` 时不出现
2. 5 条主链路（批次 A）全部返回可解释的图像内容，不报 4xx/5xx
3. 格式覆盖（批次 B）全部通过
4. 模型覆盖（批次 C）至少 `qwen3.5-plus` 稳定通过；其余模型若失败需明确“模型不支持视觉”而非系统错误
5. 文本-only 回归（批次 D）通过，无行为退化

## 6. 失败分支与处理规则（预定义）

-   若出现 `400` 且报错指向 `image_url.detail` 字段不兼容：

1. 启动二阶段补丁：在 [multiModalUtils.ts](/home/jayee/workspace/SciAgent/packages/components/src/multiModalUtils.ts) 对 Tongyi 路径去掉 `detail` 字段再测
2. 复测批次 A + B

-   若某模型不支持图片：

1. 保留功能实现
2. 在节点描述或测试报告中标注“该模型不支持视觉输入”，不作为实现失败

## 7. 交付物

1. 代码改动（Tongyi 节点 + 单测）
2. 试验报告（建议 CSV/表格）：
   `chainType, model, imageType, imageResolution, success, latencyMs, errorCode, errorMessage`

## 8. Assumptions & Defaults

-   已锁定默认策略：

1. 仅 Chatflow
2. 使用真实 DashScope 调用验证
3. endpoint 固定北京
4. 主验证模型为 `qwen3.5-plus`
5. 不在本轮扩展 Agentflow 和多地域 endpoint 参数
