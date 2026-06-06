/**
 * @file app-agent-loop.js
 * @module agent-loop / AppAgentLoop
 *
 * 【编排】串联 llm-server / mcp-filesystem；UI+xcode 流副作用在 stream-hooks。
 */
const projectIo = require('../mcp-filesystem');
const { EXECUTE_call_llm, FEED_infer_round } = require('../llm-server/llm-infer-service');
const { EXECUTE_parse_command, FEED_parsed_command } = require('../llm-server/command-parser');
const { route_task } = require('./task-dispatcher');
const { EXECUTE_execute_tool, FEED_tool_result } = require('../mcp-filesystem/tool-executor');
const { feed_observation, feed_assistant_tool_calls } = require('./context-feeder');
const { createAgentStreamHooks } = require('./stream-hooks');
const { resolveAbsInProject } = require('../xcode/live-stream');

const MAX_TOOL_ROUNDS = 12;

/**
 * @param {{
 *   onTextDelta?: (text: string) => void,
 *   onTool?: (info: object) => void,
 *   onToolStream?: (info: object) => void,
 *   onError?: (error: string) => void,
 * }} uiSink
 */
async function runAppAgentLoop(uiSink, apiKey, model, messages, loopOpts = {}) {
  if (!projectIo.getStatus().connected) {
    return { error: 'MCP 未连接，请先用 File → Open Folder 打开工程目录' };
  }

  let mcpTools;
  try {
    mcpTools = await projectIo.listTools();
  } catch (e) {
    return { error: `读取 MCP tools 失败：${e.message || String(e)}` };
  }
  if (!mcpTools.length) {
    return { error: 'MCP 未返回可用 tools' };
  }

  const projectRoot = projectIo.getStatus().projectRoot;
  const conv = messages.map((m) => ({ ...m }));

  let xcodeAbsPath = null;
  if (loopOpts.xcodeStreamPath) {
    xcodeAbsPath = resolveAbsInProject(projectRoot, loopOpts.xcodeStreamPath);
  }

  const chatOpts = { apiKey, model, messages: conv, mcpTools };

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const { hooks, streamContext } = createAgentStreamHooks({
        uiSink,
        projectRoot,
        xcodeAbsPath,
      });

      const inferRaw = await EXECUTE_call_llm(chatOpts, hooks);
      const inferFeed = FEED_infer_round(inferRaw, streamContext);
      if (!inferFeed.ok) {
        uiSink.onError?.(inferFeed.error);
        return { error: inferFeed.error };
      }

      const parseRaw = EXECUTE_parse_command(inferFeed.data);
      const parseFeed = FEED_parsed_command(parseRaw);
      if (!parseFeed.ok) {
        uiSink.onError?.(parseFeed.error);
        return { error: parseFeed.error };
      }

      const parsed = parseFeed.data;
      if (parsed.finishReason !== 'tool_calls' || !parsed.tasks?.length) {
        if (parsed.content && String(parsed.content).trim()) {
          return { content: String(parsed.content) };
        }
        return { error: '模型未返回 tool_calls 且无文本内容' };
      }

      feed_assistant_tool_calls(conv, parsed.assistantMessage);
      chatOpts.messages = conv;

      const execStreamContext = inferFeed.data.parseContext;

      for (const parsedTask of parsed.tasks) {
        uiSink.onTool?.({ name: parsedTask.name, arguments: parsedTask.args });

        const routed = route_task(parsedTask);
        if (routed.error) {
          uiSink.onError?.(routed.error);
          return { error: routed.error };
        }

        let execRaw;
        try {
          execRaw = await EXECUTE_execute_tool(routed, { streamContext: execStreamContext });
        } catch (e) {
          execRaw = {
            isError: true,
            content: [{ type: 'text', text: e.message || String(e) }],
          };
        }
        const toolFeed = FEED_tool_result(execRaw);
        feed_observation(conv, parsedTask, toolFeed);
      }

      chatOpts.messages = conv;
    }

    return { error: `工具调用超过 ${MAX_TOOL_ROUNDS} 轮上限` };
  } finally {
    await projectIo.closeAllWriteFiles();
  }
}

module.exports = { runAppAgentLoop, MAX_TOOL_ROUNDS };
