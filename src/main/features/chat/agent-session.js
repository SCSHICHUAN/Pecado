/**
 * @file agent-session.js
 * @domain chat
 *
 * Agent 模式会话：多轮 Function Calling 编排。
 * 火山数据经 `llm-volc` 事件流进出。
 */
const volc = require('../../llm-volc');
const mcpFs = require('../../mcp/filesystem-client');
const { mcpToolsToFunctionTools } = require('../../mcp/tools-schema');
const { formatToolResultForMessage } = require('../../mcp/tool-result');
const { resolveUnderProject } = require('../../mcp/project-path');
const xcodeWrite = require('../../mcp/xcode-write-stream');
const { consumeAgentRound } = require('./agent-round');
const { executeMcpTool } = require('./mcp-tool-executor');

const IS_DARWIN = process.platform === 'darwin';
const MAX_TOOL_ROUNDS = 12;

/**
 * @param {ReturnType<typeof import('./ui-stream-sink').createUiStreamSink>} uiSink
 * @param {string} _streamId
 * @param {string} apiKey
 * @param {string} model
 * @param {Array<{ role: string, content: string }>} messages
 * @param {{ xcodeStreamPath?: string }} [loopOpts]
 */
async function runAgentSession(uiSink, _streamId, apiKey, model, messages, loopOpts = {}) {
  if (!mcpFs.getStatus().connected) {
    return { error: 'MCP 未连接，请先用 File → Open Folder 打开工程目录' };
  }

  let tools;
  try {
    tools = mcpToolsToFunctionTools(await mcpFs.listTools());
  } catch (e) {
    return { error: `读取 MCP tools 失败：${e.message || String(e)}` };
  }
  if (!tools.length) {
    return { error: 'MCP 未返回可用 tools' };
  }

  const projectRoot = mcpFs.getStatus().projectRoot;
  const conv = volc.sanitizeMessagesForVolcApi(messages.map((m) => ({ ...m })));

  let xcodeAbsPath = null;
  if (IS_DARWIN && loopOpts.xcodeStreamPath) {
    try {
      xcodeAbsPath = resolveUnderProject(projectRoot, loopOpts.xcodeStreamPath);
    } catch (e) {
      console.warn('[xcode-stream] ignore path:', e.message);
    }
  }

  const chatOpts = { apiKey, model, messages: conv, tools };

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const roundOut = await consumeAgentRound(uiSink, chatOpts, {
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
            await xcodeWrite.awaitPending(target.absPath);
            await xcodeWrite.closeCodeFile(target.absPath);
          }

          uiSink.onTool({ name, arguments: args });

          let result;
          try {
            result = await executeMcpTool(name, args, {
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
    await xcodeWrite.closeAllCodeFiles();
  }
}

module.exports = { runAgentSession, mcpToolsToFunctionTools };
