/**
 * @file agent-loop.js
 * @domain agent
 *
 * Agent 多轮 Function Calling 编排（tool 循环）。
 */
const volc = require('../llm-volc');
const projectIo = require('../mcp-filesystem');
const { createUiStreamSink } = require('./stream-ui');
const { consumeAgentStream } = require('./agent-stream-consumer');
const { executeTool } = require('./tool-executor');
const { resolveAbsInProject, IS_DARWIN } = require('../xcode/live-stream');

const MAX_TOOL_ROUNDS = 12;

function formatToolResultForMessage(result) {
  if (!result || typeof result !== 'object') return String(result ?? '');
  const parts = Array.isArray(result.content) ? result.content : [];
  const texts = parts
    .filter((p) => p && p.type === 'text' && p.text != null)
    .map((p) => String(p.text));
  const joined = texts.join('\n');
  if (joined) return joined;
  if (result.isError) return 'MCP tool error (no text payload)';
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

/**
 * @param {ReturnType<typeof createUiStreamSink>} uiSink
 * @param {string} _streamId
 * @param {string} apiKey
 * @param {string} model
 * @param {Array<{ role: string, content: string }>} messages
 * @param {{ xcodeStreamPath?: string }} [loopOpts]
 */
async function runAgentLoop(uiSink, _streamId, apiKey, model, messages, loopOpts = {}) {
  if (!projectIo.getStatus().connected) {
    return { error: 'MCP 未连接，请先用 File → Open Folder 打开工程目录' };
  }

  let tools;
  try {
    tools = volc.mcpToolsToFunctionTools(await projectIo.listTools());
  } catch (e) {
    return { error: `读取 MCP tools 失败：${e.message || String(e)}` };
  }
  if (!tools.length) {
    return { error: 'MCP 未返回可用 tools' };
  }

  const projectRoot = projectIo.getStatus().projectRoot;
  const conv = volc.sanitizeMessagesForVolcApi(messages.map((m) => ({ ...m })));

  let xcodeAbsPath = null;
  if (loopOpts.xcodeStreamPath) {
    xcodeAbsPath = resolveAbsInProject(projectRoot, loopOpts.xcodeStreamPath);
  }

  const chatOpts = { apiKey, model, messages: conv, tools };

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const roundOut = await consumeAgentStream(uiSink, chatOpts, {
        projectRoot,
        xcodeAbsPath,
      });
      if (roundOut.error) {
        uiSink.onError(roundOut.error);
        return { error: roundOut.error };
      }

      const { finishReason, content, toolCalls, writeParsers, writeTargets } = roundOut;

      if (finishReason === 'tool_calls' && toolCalls.length) {
        conv.push({
          role: 'assistant',
          content: content ? String(content) : '',
          tool_calls: volc.sanitizeToolCallsForApi(toolCalls),
        });
        chatOpts.messages = conv;

        for (const tc of toolCalls) {
          const idx = tc.index ?? 0;
          const name = tc.function?.name;
          let args = {};
          try {
            args = JSON.parse(tc.function?.arguments || '{}');
          } catch (_) {
            const parser = writeParsers.get(idx);
            if (parser) args = parser.getFinalArgs();
          }

          const target = writeTargets.get(idx);
          const parser = writeParsers.get(idx);
          const alreadyStreamed =
            name === 'write_file' &&
            target?.absPath &&
            IS_DARWIN &&
            target.xcodeLiveStream &&
            (target.fileStarted || (parser?.streamedContentLen ?? 0) > 0);

          if (alreadyStreamed && target?.absPath) {
            await projectIo.awaitWritePending(target.absPath);
            await projectIo.closeWriteFile(target.absPath);
          }

          uiSink.onTool({ name, arguments: args });

          let result;
          try {
            result = await executeTool(name, args, {
              alreadyStreamedToDisk: alreadyStreamed,
              xcodeIntegrate: target?.xcodeIntegrate,
              xcodeMeta: target?.xcodeMeta,
              cancelled: target?.cancelled,
              skipPrompt: name === 'write_file' && !!target,
            });
          } catch (e) {
            result = {
              isError: true,
              content: [{ type: 'text', text: e.message || String(e) }],
            };
          }

          conv.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: formatToolResultForMessage(result),
          });
        }
        chatOpts.messages = conv;
        continue;
      }

      if (content && String(content).trim()) {
        return { content: String(content) };
      }

      return { error: '模型未返回 tool_calls 且无文本内容' };
    }

    return { error: `工具调用超过 ${MAX_TOOL_ROUNDS} 轮上限` };
  } finally {
    await projectIo.closeAllWriteFiles();
  }
}

/**
 * Agent 模式 IPC 入口。
 * @param {import('electron').WebContents} sender
 * @param {string} streamId
 * @param {string} apiKey
 * @param {string} model
 * @param {Array<{ role: string, content: string }>} messages
 * @param {{ xcodeStreamPath?: string }} [loopOpts]
 */
async function runAgentChat(sender, streamId, apiKey, model, messages, loopOpts = {}) {
  const uiSink = createUiStreamSink(sender, streamId);
  try {
    return await runAgentLoop(uiSink, streamId, apiKey, model, messages, loopOpts);
  } catch (e) {
    const msg = e.message || String(e);
    uiSink.onError(msg);
    return { error: msg };
  }
}

module.exports = { runAgentLoop, runAgentChat };
