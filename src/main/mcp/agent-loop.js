/**
 * @file agent-loop.js
 *
 * 豆包 Function Calling + 本地 MCP filesystem（**全程 SSE 流式**）。
 *
 * - 每轮 POST stream:true，聚合 delta.tool_calls
 * - write_file：arguments 边收边解析 content → WriteStream 落盘 → Xcode 实时刷新
 * - 聊天 UI：phase tool_stream / delta 同步显示代码片段
 */
const { VOLC_ARK } = require('../../shared/ipc-channels');
const fs = require('fs');
const mcpFs = require('./filesystem-client');
const { mcpToolsToFunctionTools } = require('./tools-schema');
const { formatToolResultForMessage } = require('./tool-result');
const { resolveUnderProject } = require('./project-path');
const { shouldLiveStreamToXcode } = require('./xcode-stream-target');
const xcodeWrite = require('./xcode-write-stream');
const { getMainWindow } = require('./context');
const { confirmCreateOperation, integrateAfterCreate } = require('./xcode-prompt');
const xcodeProject = require('./xcode-project');
const {
  createToolCallAccumulator,
  createWriteFileArgsStreamer,
} = require('./stream-tool-acc');

const IS_DARWIN = process.platform === 'darwin';
const ARK_BOTS_URL = 'https://ark.cn-beijing.volces.com/api/v3/bots/chat/completions';
const MAX_TOOL_ROUNDS = 12;

function safeSend(sender, payload) {
  try {
    if (sender && !sender.isDestroyed()) sender.send(VOLC_ARK.BOTS_STREAM_EVENT, payload);
  } catch (_) {}
}

async function parseApiError(res) {
  let msg = `HTTP ${res.status}`;
  const errText = await res.text();
  try {
    const j = JSON.parse(errText);
    msg = j.error?.message || j.message || msg;
  } catch (_) {
    if (errText && errText.length < 500) msg = errText;
  }
  return msg;
}

/** 将 message.content 规范为 API 接受的字符串（拒绝 null / 多模态数组原样回传） */
function normalizeMessageContent(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (p && p.type === 'text' && p.text != null ? String(p.text) : ''))
      .join('');
  }
  return String(content);
}

/** 火山 Bots API：assistant+tool_calls 时 content 不能为 null；tool_calls 不含 SSE 的 index */
function sanitizeToolCallsForApi(toolCalls) {
  if (!Array.isArray(toolCalls)) return [];
  return toolCalls.map((tc) => ({
    id: tc.id || '',
    type: tc.type || 'function',
    function: {
      name: tc.function?.name || '',
      arguments: tc.function?.arguments ?? '{}',
    },
  }));
}

/**
 * 发送前规范化 messages，避免 content:null 或多模态 part 结构触发 400。
 * @param {Array<Record<string, unknown>>} messages
 */
function sanitizeMessagesForVolcApi(messages) {
  return messages.map((m) => {
    const role = m.role;
    if (role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      return {
        role: 'assistant',
        content: normalizeMessageContent(m.content),
        tool_calls: sanitizeToolCallsForApi(m.tool_calls),
      };
    }
    if (role === 'tool') {
      const text = normalizeMessageContent(m.content);
      return {
        role: 'tool',
        tool_call_id: m.tool_call_id,
        content: text || '(empty tool result)',
      };
    }
    return {
      role,
      content: normalizeMessageContent(m.content),
    };
  });
}

async function postChatCompletion(opts) {
  const body = {
    model: opts.model,
    messages: sanitizeMessagesForVolcApi(opts.messages),
    stream: !!opts.stream,
  };
  if (opts.tools?.length) {
    body.tools = opts.tools;
    body.tool_choice = 'auto';
  }
  if (opts.stream) {
    body.stream_options = { include_usage: true };
  }

  return fetch(ARK_BOTS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
      Accept: opts.stream ? 'text/event-stream' : 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function extractDeltaText(json) {
  const c0 = json?.choices?.[0];
  if (!c0) return '';
  const d = c0.delta;
  if (d && typeof d.content === 'string') return d.content;
  if (d && Array.isArray(d.content)) {
    return d.content.map((p) => (p?.type === 'text' ? p.text || '' : '')).join('');
  }
  return '';
}

function streamJsonError(json) {
  return json?.error?.message || json?.error?.msg || '';
}

/**
 * 读取一轮 SSE（stream:true + tools）：聚合 tool_calls 或最终正文
 * @param {import('electron').WebContents} sender
 * @param {string} streamId
 * @param {ReadableStream} body
 * @param {{ projectRoot: string, xcodeAbsPath?: string|null }} ctx
 */
async function readSseMcpRound(sender, streamId, body, ctx) {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let carry = '';
  let fullContent = '';
  let finishReason = null;
  const toolAcc = createToolCallAccumulator();
  /** @type {Map<number, ReturnType<typeof createWriteFileArgsStreamer>>} */
  const writeParsers = new Map();
  /** @type {Map<number, { absPath: string, relPath: string, fileStarted?: boolean, xcodeLiveStream?: boolean, cancelled?: boolean, xcodeIntegrate?: boolean, xcodeMeta?: object|null }>} */
  const writeTargets = new Map();

  /** @type {Set<number>} */
  const writeSeeded = new Set();

  const projectRoot = ctx.projectRoot;
  const xcodeTextLiveStream =
    ctx.xcodeAbsPath && IS_DARWIN ? shouldLiveStreamToXcode(ctx.xcodeAbsPath) : false;

  function ensureWriteParser(index) {
    if (writeParsers.has(index)) return writeParsers.get(index);
    const parser = createWriteFileArgsStreamer({
      onPath: (relPath) => {
        if (!IS_DARWIN) return;
        try {
          const absPath = resolveUnderProject(projectRoot, relPath);
          const isNew = !fs.existsSync(absPath);
          let xcodeLiveStream = isNew && shouldLiveStreamToXcode(absPath);
          let cancelled = false;
          let xcodeIntegrate = false;
          let xcodeMeta = null;

          if (isNew) {
            const confirm = confirmCreateOperation(getMainWindow(), 'write_file', projectRoot, relPath);
            if (!confirm.proceed) {
              cancelled = true;
            } else {
              xcodeIntegrate = confirm.integrateXcode;
              xcodeMeta = confirm.xcodeMeta;
              console.log('[xcode-prompt]', confirm.message);
            }
          }

          writeTargets.set(index, {
            absPath,
            relPath,
            fileStarted: false,
            xcodeLiveStream: cancelled ? false : xcodeLiveStream,
            cancelled,
            xcodeIntegrate,
            xcodeMeta,
          });

          if (cancelled) {
            console.log('[xcode-stream] write_file cancelled:', relPath);
            return;
          }

          if (xcodeLiveStream) xcodeWrite.prepareNewFile(absPath);
          console.log(
            '[xcode-stream] write_file →',
            absPath,
            xcodeLiveStream ? '(live stream)' : '(existing file, defer disk until done)'
          );
        } catch (e) {
          console.warn('[xcode-stream] path rejected:', e.message);
        }
      },
      onContentDelta: (delta, relPath) => {
        const target = writeTargets.get(index);
        if (target?.cancelled) return;
        if (target?.absPath && target.xcodeLiveStream && IS_DARWIN && delta) {
          const truncate = !target.fileStarted;
          target.fileStarted = true;
          xcodeWrite.scheduleLiveDelta(target.absPath, delta, { truncate });
        }
        if (delta) {
          safeSend(sender, {
            streamId,
            phase: 'tool_stream',
            name: 'write_file',
            path: relPath,
            text: delta,
          });
        }
      },
    });
    writeParsers.set(index, parser);
    return parser;
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    carry += decoder.decode(value, { stream: true });
    const lines = carry.split(/\r?\n/);
    carry = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(':')) continue;
      let data = '';
      if (trimmed.startsWith('data:')) data = trimmed.slice(5).trim();
      else if (trimmed.startsWith('{')) data = trimmed;
      else continue;
      if (data === '[DONE]') continue;

      let json;
      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }

      const err = streamJsonError(json);
      if (err) return { error: String(err) };

      const c0 = json?.choices?.[0];
      if (c0?.finish_reason) finishReason = c0.finish_reason;

      const content = extractDeltaText(json);
      if (content) {
        fullContent += content;
        safeSend(sender, { streamId, phase: 'delta', text: content });
        if (ctx.xcodeAbsPath && xcodeTextLiveStream) {
          xcodeWrite.scheduleLiveDelta(ctx.xcodeAbsPath, content);
        }
      }

      const deltaToolCalls = c0?.delta?.tool_calls;
      if (Array.isArray(deltaToolCalls) && deltaToolCalls.length) {
        toolAcc.merge(deltaToolCalls);
        for (const tc of deltaToolCalls) {
          const idx = tc.index ?? 0;
          const acc = toolAcc.getAt(idx);
          const name = acc?.function?.name || tc.function?.name || '';
          if (name === 'write_file') {
            const parser = ensureWriteParser(idx);
            if (!writeSeeded.has(idx)) {
              if (acc?.function?.arguments) parser.push(acc.function.arguments);
              writeSeeded.add(idx);
            } else if (tc.function?.arguments) {
              parser.push(tc.function.arguments);
            }
          } else if (tc.function?.name) {
            safeSend(sender, {
              streamId,
              phase: 'tool',
              name: tc.function.name,
              streaming: true,
            });
          }
        }
      }
    }
  }

  if (ctx.xcodeAbsPath && xcodeTextLiveStream) {
    await xcodeWrite.awaitPending(ctx.xcodeAbsPath);
    await xcodeWrite.closeCodeFile(ctx.xcodeAbsPath);
  }

  const toolCalls = toolAcc.toArray();
  if (!finishReason && toolCalls.length) finishReason = 'tool_calls';

  return {
    finishReason,
    content: fullContent,
    toolCalls,
    writeParsers,
    writeTargets,
  };
}

function appendXcodeIntegrateNote(result, kind, relPath, projectRoot, xcodeMeta) {
  if (!xcodeMeta || !relPath) return result;
  const r = integrateAfterCreate(xcodeMeta, kind, relPath, projectRoot);
  let suffix = '';
  if (r.ok && !r.already) suffix = `\n已加入 Xcode 工程（${r.path}）。`;
  else if (r.already) suffix = '\n已在 Xcode 工程中。';
  else if (r.skipped) suffix = `\n${r.reason}`;
  else if (!r.ok) suffix = `\n加入 Xcode 失败：${r.reason}`;

  if (!suffix) return result;
  if (result?.content?.[0]?.text != null) {
    result.content[0].text += suffix;
  } else if (typeof result === 'object' && result.content) {
    result.content.push({ type: 'text', text: suffix.trim() });
  }
  return result;
}

async function executeMcpTool(name, args, opts = {}) {
  const projectRoot = mcpFs.getStatus().projectRoot;
  const relPath = args?.path != null ? String(args.path) : '';

  if (opts.cancelled) {
    return {
      isError: true,
      content: [{ type: 'text', text: '用户取消了创建操作。' }],
    };
  }

  if (opts.alreadyStreamedToDisk && name === 'write_file') {
    let result = {
      content: [{ type: 'text', text: `Successfully wrote to ${args.path}` }],
    };
    if (opts.xcodeIntegrate && opts.xcodeMeta) {
      result = appendXcodeIntegrateNote(result, 'write_file', relPath, projectRoot, opts.xcodeMeta);
    }
    return result;
  }

  const isCreateDir = name === 'create_directory';
  const isWriteFile = name === 'write_file';
  const isNewPath =
    relPath && !xcodeProject.pathExistsUnderRoot(projectRoot, relPath);

  let xcodeIntegrate = !!opts.xcodeIntegrate;
  let xcodeMeta = opts.xcodeMeta || null;

  if ((isCreateDir || isWriteFile) && isNewPath && !opts.skipPrompt) {
    const confirm = confirmCreateOperation(getMainWindow(), name, projectRoot, relPath);
    if (!confirm.proceed) {
      return {
        isError: true,
        content: [{ type: 'text', text: confirm.message }],
      };
    }
    xcodeIntegrate = confirm.integrateXcode;
    xcodeMeta = confirm.xcodeMeta;
    console.log('[xcode-prompt]', confirm.message);
  }

  let result;
  if (IS_DARWIN && isWriteFile && relPath) {
    const abs = resolveUnderProject(projectRoot, relPath);
    await xcodeWrite.writeWholeFileStreaming(abs, args.content);
    result = {
      content: [{ type: 'text', text: `Successfully wrote to ${args.path}` }],
    };
  } else {
    result = await mcpFs.callTool(name, args);
  }

  if (xcodeIntegrate && xcodeMeta && (isCreateDir || isWriteFile) && relPath) {
    result = appendXcodeIntegrateNote(result, name, relPath, projectRoot, xcodeMeta);
  }

  return result;
}

async function runMcpAgentLoop(sender, streamId, apiKey, model, messages, loopOpts = {}) {
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
  const conv = sanitizeMessagesForVolcApi(messages.map((m) => ({ ...m })));

  let xcodeAbsPath = null;
  if (IS_DARWIN && loopOpts.xcodeStreamPath) {
    try {
      xcodeAbsPath = resolveUnderProject(projectRoot, loopOpts.xcodeStreamPath);
    } catch (e) {
      console.warn('[xcode-stream] ignore path:', e.message);
    }
  }

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const res = await postChatCompletion({
        apiKey,
        model,
        messages: conv,
        tools,
        stream: true,
      });

      if (!res.ok) {
        const msg = await parseApiError(res);
        safeSend(sender, { streamId, phase: 'error', error: msg });
        return { error: msg };
      }
      if (!res.body) return { error: '流式响应无 body' };

      const roundOut = await readSseMcpRound(sender, streamId, res.body, {
        projectRoot,
        xcodeAbsPath,
      });
      if (roundOut.error) return { error: roundOut.error };

      const { finishReason, content, toolCalls, writeParsers, writeTargets } = roundOut;

      if (finishReason === 'tool_calls' && toolCalls.length) {
        conv.push({
          role: 'assistant',
          content: content ? String(content) : '',
          tool_calls: sanitizeToolCallsForApi(toolCalls),
        });

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

          safeSend(sender, {
            streamId,
            phase: 'tool',
            name,
            arguments: args,
          });

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

module.exports = { runMcpAgentLoop, mcpToolsToFunctionTools };
