# AI 会话到 Draft 修改的实现方案

## 目标
- 让 AI 基于会话与所选 PDF 笔记，返回结构化“DraftOps JSON”，前端解析后对 `draft` 执行最小修改（patch/追加/替换）。

## 数据流
1) 渲染端收集上下文：当前 `draft`、最近会话（<=10 条）、选中的 `groups/notes` 摘要。
2) 构造请求：`system` 采用 `src/prompts/SystemPrompt.md`，`user` 提供需求 + 上下文。
3) 通过新 IPC `ai:complete` 发送到主进程；主进程用 `fetch` 调用模型（`BASE_URL`、`API_KEY`、`MODEL_NAME`）。
4) 渲染端接收回复，提取唯一的 JSON 代码块并解析为 DraftOps。
5) 应用 DraftOps 到本地 `draft`，并生成预览 diff；用户确认后提交。

## DraftOps 支持（v1）
- `replace_all(text)`：整体替换。
- `append_section(heading,text)`：在末尾追加新节。
- `patch(find,replace,count?)`：字符串级查找替换，默认替换首次。
- `set_title(text)`：若 `draft` 首行是标题则替换，否则在顶部添加。
- `replace_range(start,end,text)`：按字符区间替换（解析失败时忽略）。

## 解析与防御
- 仅接受首个 ` ```json … ``` ` 代码块；超出大小丢弃。
- 校验字段与类型，不合法的 `op` 直接跳过；逐条容错执行。
- 引用编号 `[n]` 不做联网校验，仅保留文本标注。

## UI/交互
- 聊天面板新增“应用到草稿”按钮：显示变更摘要与 diff（左右或内联）。
- 支持“回滚上次 AI 修改”。

## 主进程实现（概述）
- 新增 `ipcMain.handle('ai:complete', handler)`；读取 `.env` 配置并请求模型。
- 超时/错误返回明确 message，渲染端展示并保留会话。

## 里程碑
- M1：支持 v1 操作集与预览 diff。
- M2：支持基于 anchor 的插入/重写段落、分节目录同步。
- M3：可配置风格/长度约束与更细粒度的段落定位。
