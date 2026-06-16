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
const {
  EXECUTE_execute_tool: EXECUTE_xcode_tool,
  FEED_tool_result: FEED_xcode_tool_result,
  getXcodeTools,
  tryParseDirectXcodeTool,
  isXcodeSoloToolName,
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
  CODX_EDIT_PLAN_TOOL_NAME,
} = require('../codX/agent/tools');
const { PECADO_LLM_LINE_END } = require('../shared/codx-edit-plan');
const { feed_observation, feed_assistant_tool_calls } = require('./context-feeder');
const { createAgentStreamHooks } = require('./stream-hooks');
const { planTasksWithWriteGuard, attachSyntheticToolCallsToConv, pathKey } = require('./write-guard');
const { resolveAbsInProject } = require('../xcode/stream');
const {
  isCodeWriteTool,
  summarizeWriteTasks,
  composeAgentReply,
} = require('./agent-reply');
const { publishToolLog, buildAgentPhaseEntry, emitAgentLog, publishXcodeProgress, publishSkillProgress } = require('../shared/agent-log');

const MAX_TOOL_ROUNDS = 12;

async function executeSoloXcodeTask(uiSink, parsedTask, roundNo) {
  uiSink.onTool?.({ name: parsedTask.name, arguments: parsedTask.args, index: parsedTask.index });

  logAgentPhase(uiSink, 'DISPATCH', {
    round: roundNo,
    status: 'start',
    method: parsedTask.name,
  });
  const routed = route_task(parsedTask);
  if (routed.error) {
    logAgentPhase(uiSink, 'DISPATCH', {
      round: roundNo,
      status: 'error',
      method: parsedTask.name,
      note: routed.error,
      isError: true,
    });
    uiSink.onError?.(routed.error);
    return { error: routed.error };
  }

  logAgentPhase(uiSink, 'DISPATCH', {
    round: roundNo,
    status: 'done',
    method: parsedTask.name,
    module: routed.module,
  });
  logAgentPhase(uiSink, 'EXEC', {
    round: roundNo,
    status: 'start',
    method: parsedTask.name,
    module: routed.module,
  });

  let execRaw;
  try {
    execRaw = await EXECUTE_xcode_tool(routed, {
      onProgress: ({ method, line, isError, elapsedMs }) => {
        publishXcodeProgress(method, line, { isError, elapsedMs });
      },
    });
  } catch (e) {
    execRaw = {
      isError: true,
      content: [{ type: 'text', text: e.message || String(e) }],
    };
  }

  logAgentPhase(uiSink, 'EXEC', {
    round: roundNo,
    status: execRaw?.isError ? 'error' : 'done',
    method: parsedTask.name,
    module: routed.module,
    isError: Boolean(execRaw?.isError),
  });

  const toolFeed = FEED_xcode_tool_result(execRaw);
  publishToolLog(parsedTask, routed, execRaw, toolFeed);
  return {
    content: composeAgentReply({ toolObservations: [toolFeed.observation] }),
  };
}

function logAgentPhase(uiSink, phase, opts = {}) {
  const entry = { ...buildAgentPhaseEntry(phase, opts), ts: Date.now() };
  if (typeof uiSink?.onAgentLog === 'function') {
    uiSink.onAgentLog(entry);
  } else {
    emitAgentLog(entry);
  }
}

/**
 * @param {{
 *   onTextDelta?: (text: string) => void,
 *   onTool?: (info: object) => void,
 *   onToolStream?: (info: object) => void,
 *   onError?: (error: string) => void,
 * }} uiSink
 */
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
  if (!mcpTools.length) {
    return { error: 'MCP 未返回可用 tools' };
  }

  const xcodeTools = getXcodeTools();
  const devDocTools = getDevDocTools();
  const codxTools = getCodxTools();
  const allTools = [...mcpTools, ...devDocTools, ...xcodeTools, ...codxTools];

  const projectRoot = projectIo.getStatus().projectRoot;
  const conv = messages.map((m) => ({ ...m }));

  let xcodeAbsPath = null;
  if (loopOpts.xcodeStreamPath) {
    xcodeAbsPath = resolveAbsInProject(projectRoot, loopOpts.xcodeStreamPath);
  }

  const chatOpts = { apiKey, model, apiMode, endpoint, messages: conv, mcpTools: allTools };
  const diskFreshReadPaths = new Set();
  /** @type {string | null} plan 已登记、待 codx_edit 的工程相对路径 */
  let pendingCodxEditPath = null;

  try {
    const directXcode = tryParseDirectXcodeTool(loopOpts.userText);
    if (directXcode) {
      logAgentPhase(uiSink, 'FEED', { round: 1, status: 'done', note: '直达 xcode 工具' });
      logAgentPhase(uiSink, 'INFER', { round: 1, status: 'done', note: '跳过 LLM' });
      logAgentPhase(uiSink, 'PARSE', { round: 1, status: 'done', note: directXcode.name });
      return await executeSoloXcodeTask(uiSink, directXcode, 1);
    }

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const roundNo = round + 1;
      logAgentPhase(uiSink, 'FEED', {
        round: roundNo,
        status: 'start',
        note: '喂入上下文',
      });
      logAgentPhase(uiSink, 'FEED', {
        round: roundNo,
        status: 'done',
        note: `${conv.length} 条消息`,
      });
      logAgentPhase(uiSink, 'INFER', { round: roundNo, status: 'start' });

      const { hooks, streamContext } = createAgentStreamHooks({
        uiSink,
        projectRoot,
        xcodeAbsPath,
      });

      const inferRaw = await EXECUTE_call_llm(chatOpts, hooks);
      const inferFeed = FEED_infer_round(inferRaw, streamContext);
      if (!inferFeed.ok) {
        logAgentPhase(uiSink,'INFER', {
          round: roundNo,
          status: 'error',
          note: inferFeed.error,
          isError: true,
        });
        uiSink.onError?.(inferFeed.error);
        return { error: inferFeed.error };
      }
      logAgentPhase(uiSink,'INFER', { round: roundNo, status: 'done' });

      logAgentPhase(uiSink,'PARSE', { round: roundNo, status: 'start' });
      const parseRaw = EXECUTE_parse_command(inferFeed.data);
      const parseFeed = FEED_parsed_command(parseRaw);
      if (!parseFeed.ok) {
        logAgentPhase(uiSink,'PARSE', {
          round: roundNo,
          status: 'error',
          note: parseFeed.error,
          isError: true,
        });
        uiSink.onError?.(parseFeed.error);
        return { error: parseFeed.error };
      }

      const parsed = parseFeed.data;
      logAgentPhase(uiSink,'PARSE', {
        round: roundNo,
        status: 'done',
        note: parsed.finishReason || '',
      });

      if (parsed.finishReason !== 'tool_calls' || !parsed.tasks?.length) {
        if (pendingCodxEditPath) {
          conv.push({
            role: 'user',
            content:
              `【系统】${pendingCodxEditPath} 的 codx_edit_plan 尚未完成 codx_edit。` +
              `你必须调用 codx_edit（path="${pendingCodxEditPath}"），text 流式写入，段末 ${PECADO_LLM_LINE_END}。禁止文字结束。`,
          });
          chatOpts.messages = conv;
          continue;
        }
        if (parsed.content && String(parsed.content).trim()) {
          return { content: String(parsed.content) };
        }
        return { error: '模型未返回 tool_calls 且无文本内容' };
      }

      feed_assistant_tool_calls(conv, parsed.assistantMessage);
      chatOpts.messages = conv;

      const execStreamContext = inferFeed.data.parseContext;
      const roundObservations = [];
      let hadCodeWrite = false;
      let hadCodxEditStream = false;
      const { tasks: tasksToRun, deferredWrites } = planTasksWithWriteGuard(
        parsed.tasks,
        projectRoot,
        diskFreshReadPaths
      );
      attachSyntheticToolCallsToConv(conv, tasksToRun);

      for (const parsedTask of tasksToRun) {
        uiSink.onTool?.({ name: parsedTask.name, arguments: parsedTask.args, index: parsedTask.index });

        logAgentPhase(uiSink,'DISPATCH', {
          round: roundNo,
          status: 'start',
          method: parsedTask.name,
        });

        const routed = route_task(parsedTask);
        if (routed.error) {
          logAgentPhase(uiSink,'DISPATCH', {
            round: roundNo,
            status: 'error',
            method: parsedTask.name,
            note: routed.error,
            isError: true,
          });
          uiSink.onError?.(routed.error);
          return { error: routed.error };
        }

        logAgentPhase(uiSink,'DISPATCH', {
          round: roundNo,
          status: 'done',
          method: parsedTask.name,
          module: routed.module,
        });

        logAgentPhase(uiSink,'EXEC', {
          round: roundNo,
          status: 'start',
          method: parsedTask.name,
          module: routed.module,
        });

        let execRaw;
        try {
          const xcodeExecOpts = {
            onProgress: ({ method, line, isError, elapsedMs }) => {
              publishXcodeProgress(method, line, { isError, elapsedMs });
            },
          };
          if (routed.module === 'xcode') {
            execRaw = await EXECUTE_xcode_tool(routed, xcodeExecOpts);
          } else if (routed.module === 'skill') {
            execRaw = await EXECUTE_dev_doc_tool(routed, {
              onProgress: (payload) => {
                if (payload.skill || payload.module === 'skill') {
                  publishSkillProgress(payload);
                }
              },
            });
          } else if (routed.module === 'codx') {
            execRaw = await EXECUTE_codx_tool(routed, { streamContext: execStreamContext });
            if (execRaw?.codxPlan?.path && execRaw.codxPlan.edits) {
              pendingCodxEditPath = String(execRaw.codxPlan.path).trim();
              uiSink.onCodxEditPlan?.({
                path: execRaw.codxPlan.path,
                edits: execRaw.codxPlan.edits,
              });
            }
            if (parsedTask.name === CODX_EDIT_TOOL_NAME) {
              const target = execStreamContext?.codxEditTargets?.get(parsedTask.index ?? 0);
              if (target?.streamed || (target?.textLen ?? 0) > 0) {
                hadCodxEditStream = true;
                pendingCodxEditPath = null;
              }
            }
            if (isCodeWriteTool(parsedTask.name)) hadCodeWrite = true;
          } else {
            execRaw = await EXECUTE_execute_tool(routed, { streamContext: execStreamContext });
            if (isCodeWriteTool(parsedTask.name)) hadCodeWrite = true;
          }
        } catch (e) {
          execRaw = {
            isError: true,
            content: [{ type: 'text', text: e.message || String(e) }],
          };
        }

        logAgentPhase(uiSink,'EXEC', {
          round: roundNo,
          status: execRaw?.isError ? 'error' : 'done',
          method: parsedTask.name,
          module: routed.module,
          isError: Boolean(execRaw?.isError),
        });

        const toolFeed =
          routed.module === 'xcode'
            ? FEED_xcode_tool_result(execRaw)
            : routed.module === 'skill'
              ? FEED_dev_doc_tool_result(execRaw)
              : routed.module === 'codx'
                ? FEED_codx_tool_result(execRaw)
                : FEED_tool_result(execRaw);

        logAgentPhase(uiSink, 'FEED', {
          round: roundNo,
          status: 'start',
          method: parsedTask.name,
          module: routed.module,
          note: '喂回 tool 结果',
        });

        feed_observation(conv, parsedTask, toolFeed);
        roundObservations.push(toolFeed.observation);

        const observation = String(toolFeed?.observation || '').trim();
        logAgentPhase(uiSink, 'FEED', {
          round: roundNo,
          status: 'done',
          method: parsedTask.name,
          module: routed.module,
          note: observation ? '' : 'observation 已写入',
          observation,
        });

        if (routed.module !== 'skill') {
          publishToolLog(parsedTask, routed, execRaw, toolFeed);
        }

        if (
          (parsedTask.name === 'read_text_file' || parsedTask.name === 'read_file') &&
          !execRaw?.isError
        ) {
          const readPath = parsedTask.args?.path != null ? String(parsedTask.args.path).trim() : '';
          if (readPath) diskFreshReadPaths.add(pathKey(projectRoot, readPath));
        }
      }

      chatOpts.messages = conv;

      const calledCodxEdit = tasksToRun.some((t) => t.name === CODX_EDIT_TOOL_NAME);
      if (pendingCodxEditPath && !hadCodxEditStream && !calledCodxEdit) {
        conv.push({
          role: 'user',
          content:
            `【系统】已对 ${pendingCodxEditPath} 完成 codx_edit_plan。你必须在本轮立即调用 codx_edit，` +
            `path 为「${pendingCodxEditPath}」，text 从大行号到小行号流式写入，每段末尾 ${PECADO_LLM_LINE_END}。` +
            '禁止仅用文字回复、禁止再次 plan。',
        });
        chatOpts.messages = conv;
      }

      if (deferredWrites.length) {
        continue;
      }

      const soloXcodeRound =
        tasksToRun.length > 0 && tasksToRun.every((t) => isXcodeSoloToolName(t.name));
      if (soloXcodeRound) {
        return {
          content: composeAgentReply({
            leadText: parsed.content,
            toolObservations: roundObservations,
          }),
        };
      }

      if (hadCodeWrite) {
        return {
          content: composeAgentReply({
            leadText: parsed.content,
            writeSummary: summarizeWriteTasks(parsed.tasks),
            toolObservations: roundObservations,
          }),
        };
      }
    }

    return { error: `工具调用超过 ${MAX_TOOL_ROUNDS} 轮上限` };
  } finally {
    await projectIo.closeAllWriteFiles();
  }
}

module.exports = { runAppAgentLoop, MAX_TOOL_ROUNDS };
