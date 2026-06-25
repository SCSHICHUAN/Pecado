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
const { PECADO_LLM_LINE_END } = require('../shared/codx-edit-plan');
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
const { isCodeWriteTool, composeAgentReply } = require('./agent-reply');
const { publishToolLog, buildAgentPhaseEntry, emitAgentLog, publishXcodeProgress, publishSkillProgress } = require('../shared/agent-log');
const codxDiskSync = require('./codx-disk-sync');

const MAX_TOOL_ROUNDS = 12;

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
  else emitAgentLog(entry);
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

  const allTools = [
    getFinishTaskTool(),
    ...mcpTools,
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

  try {
    const directXcode = tryParseDirectXcodeTool(loopOpts.userText);
    if (directXcode) {
      return await executeSoloXcodeTask(uiSink, directXcode, 1);
    }

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const roundNo = round + 1;
      logAgentPhase(uiSink, 'FEED', { round: roundNo, status: 'done', note: `${conv.length} 条消息` });
      logAgentPhase(uiSink, 'INFER', { round: roundNo, status: 'start' });

      const { hooks, streamContext } = createAgentStreamHooks({ uiSink, projectRoot, xcodeAbsPath });
      const inferFeed = FEED_infer_round(await EXECUTE_call_llm(chatOpts, hooks), streamContext);
      if (!inferFeed.ok) {
        uiSink.onError?.(inferFeed.error);
        return { error: inferFeed.error };
      }
      logAgentPhase(uiSink, 'INFER', { round: roundNo, status: 'done' });

      const parseFeed = FEED_parsed_command(EXECUTE_parse_command(inferFeed.data));
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
              `须调用 codx_edit path="${pendingCodxEditPath}"，段末 ${PECADO_LLM_LINE_END}。`,
          });
          chatOpts.messages = conv;
          continue;
        }
        const text = String(parsed.content || '').trim();
        if (text) conv.push({ role: 'assistant', content: text });
        conv.push({ role: 'user', content: FINISH_NUDGE });
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

      for (const parsedTask of workTasks) {
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

        if (
          (parsedTask.name === 'read_text_file' || parsedTask.name === 'read_file') &&
          !execRaw?.isError
        ) {
          const readPath = parsedTask.args?.path != null ? String(parsedTask.args.path).trim() : '';
          if (readPath) diskFreshReadPaths.add(pathKey(projectRoot, readPath));
        }
      }

      for (const ft of finishTasks) {
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
            `path="${pendingCodxEditPath}"，段末 ${PECADO_LLM_LINE_END}。`,
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
