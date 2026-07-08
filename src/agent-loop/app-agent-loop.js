/**
 * @file app-agent-loop.js
 * 薄循环：LLM 自选 tools 编排；本地仅 EXEC/FEED、硬约束、finish_task 结束。
 */
const projectIo = require('../mcp-filesystem');
const { EXECUTE_call_llm, FEED_infer_round } = require('../llm-server/llm-infer-service');
const { EXECUTE_parse_command, FEED_parsed_command } = require('../llm-server/command-parser');
const { route_task } = require('./task-dispatcher');
const { EXECUTE_execute_tool, FEED_tool_result } = require('../mcp-filesystem/tool-executor');
const {
  EXECUTE_execute_tool: EXECUTE_xcode_tool,
  FEED_tool_result: FEED_xcode_tool_result,
  getXcodeTools,
  tryParseDirectXcodeTool,
} = require('../xcode/agent/tools');
const {
  getDevDocTools,
  EXECUTE_execute_tool: EXECUTE_dev_doc_tool,
  FEED_tool_result: FEED_dev_doc_tool_result,
} = require('../workflow/skill/agent/tools');
const {
  getCodxTools,
  EXECUTE_codx_tool,
  FEED_codx_tool_result,
  CODX_EDIT_TOOL_NAME,
} = require('../codX/agent/tools');
const { PECADO_BLOCK_END } = require('../shared/codx-edit-plan');
const { getReadMediaFileTool, getMediaCallbacks, isReadMediaFileToolName } = require('../mcp-filesystem/read-media');
const {
  getFinishTaskTool,
  isFinishTaskName,
  extractFinishSummary,
  FINISH_NUDGE,
} = require('./finish-tool');
const { feed_observation, feed_assistant_tool_calls } = require('./context-feeder');
const { createAgentStreamHooks } = require('./stream-hooks');
const { planTasksWithWriteGuard, attachSyntheticToolCallsToConv, pathKey } = require('./write-guard');
const { resolveAbsInProject } = require('../xcode/stream');
const { composeAgentReply } = require('./agent-reply');
const { publishToolLog, buildAgentPhaseEntry, emitAgentLog, publishXcodeProgress, publishSkillProgress } = require('../shared/agent-log');
const codxDiskSync = require('./codx-disk-sync');
const { EXECUTE_read_text_file, isReadTextFileToolName } = require('./read-text-file');
const { CODX_REASONING_ROUND_NUDGE } = require('../shared/prompt-language');

const MAX_TOOL_ROUNDS = 12;

/** MCP 工具不向 LLM 暴露（改已有代码走 codx_edit） */
const MCP_HIDDEN_FROM_LLM = new Set(['edit_file']);

function messagesForInfer(conv, { codxChat, round }) {
  if (!codxChat || round <= 0) return conv;
  return [...conv, { role: 'user', content: CODX_REASONING_ROUND_NUDGE }];
}

/** 用户消息是否像需要调 tool 的任务（闲聊如「你好」不算） */
function messageImpliesToolWork(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  return /运行|编译|测试|读取|修改|改成|改为|背景|颜色|xcode|编辑|写入|build|run|edit|fix|bug|implement|viewcontroller/i.test(
    t
  );
}

/**
 * 无 tool_calls 的纯文本回复是否应直接结束（避免 FINISH_NUDGE 空转）
 */
function shouldReturnPlainTextReply({ round, text, userText, textOnlyNudges }) {
  if (!text) return false;
  if (round > 0) return true;
  if (!messageImpliesToolWork(userText)) return true;
  return textOnlyNudges >= 1;
}

async function executeSoloXcodeTask(uiSink, parsedTask, roundNo) {
  uiSink.onTool?.({ name: parsedTask.name, arguments: parsedTask.args, index: parsedTask.index });
  logAgentPhase(uiSink, 'DISPATCH', { round: roundNo, status: 'start', method: parsedTask.name });
  const routed = route_task(parsedTask);
  if (routed.error) {
    uiSink.onError?.(routed.error);
    return { error: routed.error };
  }
  let execRaw;
  try {
    execRaw = await EXECUTE_xcode_tool(routed, {
      onProgress: ({ method, line, isError, elapsedMs }) => {
        publishXcodeProgress(method, line, { isError, elapsedMs });
      },
    });
  } catch (e) {
    execRaw = { isError: true, content: [{ type: 'text', text: e.message || String(e) }] };
  }
  const toolFeed = FEED_xcode_tool_result(execRaw);
  publishToolLog(parsedTask, routed, execRaw, toolFeed);
  return { content: composeAgentReply({ toolObservations: [toolFeed.observation] }) };
}

function logAgentPhase(uiSink, phase, opts = {}) {
  const entry = { ...buildAgentPhaseEntry(phase, opts), ts: Date.now() };
  if (typeof uiSink?.onAgentLog === 'function') uiSink.onAgentLog(entry);
  emitAgentLog(entry);
}

async function runAppAgentLoop(uiSink, llmOpts, messages, loopOpts = {}) {
  const { apiKey, model, apiMode, endpoint } = llmOpts || {};
  if (!projectIo.getStatus().connected) {
    return { error: 'MCP 未连接，请先用 File → Open Folder 打开工程目录' };
  }

  let mcpTools;
  try {
    mcpTools = await projectIo.listTools();
  } catch (e) {
    return { error: `读取 MCP tools 失败：${e.message || String(e)}` };
  }
  if (!mcpTools.length) return { error: 'MCP 未返回可用 tools' };

  const visibleMcpTools = mcpTools.filter((t) => !MCP_HIDDEN_FROM_LLM.has(t?.name));
  const allTools = [
    getFinishTaskTool(),
    getReadMediaFileTool(),
    ...visibleMcpTools,
    ...getDevDocTools(),
    ...getXcodeTools(),
    ...getCodxTools(),
  ];

  const projectRoot = projectIo.getStatus().projectRoot;
  const conv = messages.map((m) => ({ ...m }));
  let xcodeAbsPath = null;
  if (loopOpts.xcodeStreamPath) {
    xcodeAbsPath = resolveAbsInProject(projectRoot, loopOpts.xcodeStreamPath);
  }

  const chatOpts = { apiKey, model, apiMode, endpoint, messages: conv, mcpTools: allTools };
  const diskFreshReadPaths = new Set();
  let pendingCodxEditPath = null;
  let textOnlyNudges = 0;

  try {
    const directXcode = tryParseDirectXcodeTool(loopOpts.userText);
    if (directXcode) {
      return await executeSoloXcodeTask(uiSink, directXcode, 1);
    }

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const roundNo = round + 1;
      logAgentPhase(uiSink, 'FEED', {
        round: roundNo,
        status: 'start',
        note: `合并 ${conv.length} 条对话上下文`,
      });
      logAgentPhase(uiSink, 'FEED', {
        round: roundNo,
        status: 'done',
        note: `已合并 ${conv.length} 条上下文`,
      });
      logAgentPhase(uiSink, 'INFER', { round: roundNo, status: 'start' });

      const { hooks, streamContext } = createAgentStreamHooks({ uiSink, projectRoot, xcodeAbsPath });
      const inferMessages = messagesForInfer(conv, { codxChat: loopOpts.codxChat, round });
      const inferFeed = FEED_infer_round(
        await EXECUTE_call_llm({ ...chatOpts, messages: inferMessages }, hooks),
        streamContext
      );
      if (!inferFeed.ok) {
        uiSink.onError?.(inferFeed.error);
        return { error: inferFeed.error };
      }
      // 流非正常结束（未收到 [DONE]）且 LLM 正在写代码 → 通知渲染器触发续写，提前返回
      if (inferFeed.data.doneReceived === false) {
        const hasCodeTool = (inferFeed.data.toolCalls || []).some(
          (tc) => tc?.function?.name === 'codx_edit' || tc?.function?.name === 'write_file'
        );
        if (hasCodeTool) {
          uiSink.onError?.('流式输出中断：未收到结束标记');
          return { error: '流式输出中断：未收到结束标记' };
        }
      }
      logAgentPhase(uiSink, 'INFER', { round: roundNo, status: 'done' });

      logAgentPhase(uiSink, 'PARSE', { round: roundNo, status: 'start' });
      const parseFeed = FEED_parsed_command(EXECUTE_parse_command(inferFeed.data));
      logAgentPhase(uiSink, 'PARSE', { round: roundNo, status: 'done' });
      if (!parseFeed.ok) {
        uiSink.onError?.(parseFeed.error);
        return { error: parseFeed.error };
      }

      const parsed = parseFeed.data;

      if (parsed.finishReason !== 'tool_calls' || !parsed.tasks?.length) {
        if (pendingCodxEditPath) {
          conv.push({
            role: 'user',
            content:
              `【系统】${pendingCodxEditPath} 的 codx_edit_plan 尚未完成 codx_edit。` +
              `须调用 codx_edit path="${pendingCodxEditPath}"，段末 ${PECADO_BLOCK_END}。`,
          });
          chatOpts.messages = conv;
          continue;
        }
        const text = String(parsed.content || '').trim();
        if (
          shouldReturnPlainTextReply({
            round,
            text,
            userText: loopOpts.userText,
            textOnlyNudges,
          })
        ) {
          return { content: text };
        }
        if (text) conv.push({ role: 'assistant', content: text });
        conv.push({ role: 'user', content: FINISH_NUDGE });
        textOnlyNudges += 1;
        chatOpts.messages = conv;
        continue;
      }

      feed_assistant_tool_calls(conv, parsed.assistantMessage);
      chatOpts.messages = conv;

      const execStreamContext = inferFeed.data.parseContext;
      const { tasks: plannedTasks, deferredWrites } = planTasksWithWriteGuard(
        parsed.tasks,
        projectRoot,
        diskFreshReadPaths
      );
      attachSyntheticToolCallsToConv(conv, plannedTasks);

      const finishTasks = plannedTasks.filter((t) => isFinishTaskName(t.name));
      const workTasks = plannedTasks.filter((t) => !isFinishTaskName(t.name));

      let hadCodxEditStream = false;

      if (workTasks.length) {
        logAgentPhase(uiSink, 'EXEC', { round: roundNo, status: 'start', note: `${workTasks.length} 个 tool` });
      }

      for (const parsedTask of workTasks) {
        logAgentPhase(uiSink, 'DISPATCH', {
          round: roundNo,
          status: 'start',
          method: parsedTask.name,
          methodLabel: parsedTask.name,
        });
        uiSink.onTool?.({ name: parsedTask.name, arguments: parsedTask.args, index: parsedTask.index });
        const routed = route_task(parsedTask);
        if (routed.error) {
          uiSink.onError?.(routed.error);
          return { error: routed.error };
        }

        let execRaw;
        try {
          if (
            routed.module === 'xcode' &&
            (parsedTask.name === 'xcode_run' || parsedTask.name === 'xcode_build') &&
            codxDiskSync.hasPending()
          ) {
            for (const t of workTasks) {
              if (t.name !== CODX_EDIT_TOOL_NAME) continue;
              const parser = execStreamContext?.codxEditParsers?.get(t.index ?? 0);
              const relPath =
                parser?.getFinalArgs?.()?.path || (t.args?.path != null ? String(t.args.path).trim() : '');
              if (relPath) await codxDiskSync.flushFromParser(relPath, parser, t.args);
            }
          }

          if (routed.module === 'xcode') {
            execRaw = await EXECUTE_xcode_tool(routed, {
              onProgress: ({ method, line, isError, elapsedMs }) => {
                publishXcodeProgress(method, line, { isError, elapsedMs });
              },
            });
          } else if (routed.module === 'skill') {
            execRaw = await EXECUTE_dev_doc_tool(routed, {
              onProgress: (p) => {
                if (p.skill || p.module === 'skill') publishSkillProgress(p);
              },
            });
          } else if (routed.module === 'codx') {
            execRaw = await EXECUTE_codx_tool(routed, { streamContext: execStreamContext });
            if (execRaw?.codxPlan?.path && execRaw.codxPlan.edits) {
              pendingCodxEditPath = String(execRaw.codxPlan.path).trim();
              codxDiskSync.registerPlan(execRaw.codxPlan.path, execRaw.codxPlan.edits);
              uiSink.onCodxEditPlan?.({ path: execRaw.codxPlan.path, edits: execRaw.codxPlan.edits });
            }
            if (parsedTask.name === CODX_EDIT_TOOL_NAME) {
              const target = execStreamContext?.codxEditTargets?.get(parsedTask.index ?? 0);
              if (target?.streamed || (target?.textLen ?? 0) > 0) {
                hadCodxEditStream = true;
                pendingCodxEditPath = null;
              }
            }
          } else if (isReadMediaFileToolName(parsedTask.name)) {
            var mediaCb = getMediaCallbacks(projectRoot, {
              feedObservationOfReadMedia: function (chatBlock) {
                var toolMsg = { role: 'user', content: ['The file has been read. Here is the content:', chatBlock] };
                conv.push(toolMsg);
              },
            });
            var mediaResult = mediaCb(parsedTask);
            execRaw = mediaResult.error
              ? { isError: true, content: [{ type: 'text', text: mediaResult.error }] }
              : { content: [{ type: 'text', text: mediaResult.toolResult || 'ok' }] };
          } else if (isReadTextFileToolName(parsedTask.name)) {
            execRaw = await EXECUTE_read_text_file(routed, {
              streamContext: execStreamContext,
              sender: loopOpts.sender,
            });
          } else {
            execRaw = await EXECUTE_execute_tool(routed, { streamContext: execStreamContext });
          }
        } catch (e) {
          execRaw = { isError: true, content: [{ type: 'text', text: e.message || String(e) }] };
        }

        let toolFeed =
          routed.module === 'xcode'
            ? FEED_xcode_tool_result(execRaw)
            : routed.module === 'skill'
              ? FEED_dev_doc_tool_result(execRaw)
              : routed.module === 'codx'
                ? FEED_codx_tool_result(execRaw)
                : FEED_tool_result(execRaw);

        if (
          routed.module === 'codx' &&
          parsedTask.name === CODX_EDIT_TOOL_NAME &&
          !execRaw?.isError
        ) {
          const parser = execStreamContext?.codxEditParsers?.get(parsedTask.index ?? 0);
          const relPath =
            parser?.getFinalArgs?.()?.path ||
            (parsedTask.args?.path != null ? String(parsedTask.args.path).trim() : '');
          const flush = relPath
            ? await codxDiskSync.flushFromParser(relPath, parser, parsedTask.args)
            : null;
          if (flush?.ok) {
            toolFeed = {
              ...toolFeed,
              observation: `${toolFeed.observation}\n（已同步到磁盘：${relPath}）`,
            };
          } else if (flush && flush.reason !== 'no-plan') {
            toolFeed = {
              ...toolFeed,
              observation: `${toolFeed.observation}\n（磁盘同步失败：${flush.reason}）`,
            };
          }
        }

        feed_observation(conv, parsedTask, toolFeed);
        if (routed.module !== 'skill') publishToolLog(parsedTask, routed, execRaw, toolFeed);

        if (isReadTextFileToolName(parsedTask.name) && !execRaw?.isError) {
          const readPath = parsedTask.args?.path != null ? String(parsedTask.args.path).trim() : '';
          if (readPath) diskFreshReadPaths.add(pathKey(projectRoot, readPath));
        }

        logAgentPhase(uiSink, 'DISPATCH', {
          round: roundNo,
          status: 'done',
          method: parsedTask.name,
          methodLabel: parsedTask.name,
          isError: Boolean(execRaw?.isError),
        });
      }

      if (workTasks.length) {
        logAgentPhase(uiSink, 'EXEC', { round: roundNo, status: 'done' });
      }

      for (const ft of finishTasks) {
        logAgentPhase(uiSink, 'EXEC', { round: roundNo, status: 'start', method: 'finish_task' });
        uiSink.onTool?.({ name: ft.name, arguments: ft.args, index: ft.index });
        feed_observation(conv, ft, { observation: '已记录任务完成。' });
      }

      chatOpts.messages = conv;

      if (finishTasks.length) {
        return { content: extractFinishSummary(finishTasks, parsed.content) };
      }

      const calledCodxEdit = workTasks.some((t) => t.name === CODX_EDIT_TOOL_NAME);
      if (pendingCodxEditPath && !hadCodxEditStream && !calledCodxEdit) {
        conv.push({
          role: 'user',
          content:
            `【系统】${pendingCodxEditPath} 已完成 plan，须在本轮调用 codx_edit，` +
            `path="${pendingCodxEditPath}"，段末 ${PECADO_BLOCK_END}。`,
        });
        chatOpts.messages = conv;
      }

      if (deferredWrites.length) continue;
    }

    return { error: `工具调用超过 ${MAX_TOOL_ROUNDS} 轮上限（未收到 finish_task）` };
  } finally {
    codxDiskSync.clear();
    await projectIo.closeAllWriteFiles();
  }
}

module.exports = { runAppAgentLoop, MAX_TOOL_ROUNDS };
