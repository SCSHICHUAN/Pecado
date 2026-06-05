/**
 * @file agent-stream-consumer.js
 * @domain chat
 *
 * 消费 llm-volc 事件流，处理 write_file 流式解析与 UI / Xcode 副作用。
 */
const fs = require('fs');
const volc = require('../../llm-volc');
const { resolveUnderProject } = require('../../mcp/project-path');
const xcodeWrite = require('../../mcp/xcode-write-stream');
const { getMainWindow } = require('../../mcp/context');
const { confirmCreateOperation } = require('../../mcp/xcode-prompt');
const { createWriteFileArgsStreamer } = require('../../mcp/write-file-args-stream');

const IS_DARWIN = process.platform === 'darwin';

/**
 * @param {ReturnType<typeof import('./ui-stream-sink').createUiStreamSink>} uiSink
 * @param {{
 *   apiKey: string,
 *   model: string,
 *   messages: Array<Record<string, unknown>>,
 *   tools: Array<object>,
 * }} chatOpts
 * @param {{ projectRoot: string, xcodeAbsPath?: string|null }} ctx
 */
async function consumeAgentStream(uiSink, chatOpts, ctx) {
  /** @type {Map<number, ReturnType<typeof createWriteFileArgsStreamer>>} */
  const writeParsers = new Map();
  /** @type {Map<number, object>} */
  const writeTargets = new Map();
  /** @type {Set<number>} */
  const writeSeeded = new Set();

  const projectRoot = ctx.projectRoot;
  const xcodeTextLiveStream = ctx.xcodeAbsPath && IS_DARWIN;
  if (xcodeTextLiveStream) {
    const exists = fs.existsSync(ctx.xcodeAbsPath);
    xcodeWrite.beginWriteSession(ctx.xcodeAbsPath, { preserveExisting: exists });
  }

  function ensureWriteParser(index) {
    if (writeParsers.has(index)) return writeParsers.get(index);
    const parser = createWriteFileArgsStreamer({
      onPath: (relPath) => {
        if (!IS_DARWIN) return;
        try {
          const absPath = resolveUnderProject(projectRoot, relPath);
          const isNew = !fs.existsSync(absPath);
          let xcodeLiveStream = IS_DARWIN;
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

          if (xcodeLiveStream) {
            xcodeWrite.beginWriteSession(absPath, { preserveExisting: !isNew });
          }
          console.log(
            '[xcode-stream] write_file →',
            absPath,
            xcodeLiveStream
              ? isNew
                ? '(live stream, new file)'
                : '(live stream, overlay existing)'
              : '(skipped)'
          );
        } catch (e) {
          console.warn('[xcode-stream] path rejected:', e.message);
        }
      },
      onContentDelta: (delta, relPath) => {
        const target = writeTargets.get(index);
        if (target?.cancelled) return;
        if (target?.absPath && target.xcodeLiveStream && IS_DARWIN && delta) {
          target.fileStarted = true;
          xcodeWrite.scheduleLiveDelta(target.absPath, delta);
        }
        if (delta) {
          uiSink.onToolStream({ name: 'write_file', path: relPath, text: delta });
        }
      },
    });
    writeParsers.set(index, parser);
    return parser;
  }

  for await (const ev of volc.streamChat(chatOpts)) {
    if (ev.type === 'error') return { error: ev.message };

    if (ev.type === 'text_delta') {
      uiSink.onTextDelta(ev.text);
      if (ctx.xcodeAbsPath && xcodeTextLiveStream) {
        xcodeWrite.scheduleLiveDelta(ctx.xcodeAbsPath, ev.text);
      }
    }

    if (ev.type === 'tool_call_delta') {
      const name = ev.accumulated?.function?.name || ev.name || '';
      if (name === 'write_file') {
        const parser = ensureWriteParser(ev.index);
        if (!writeSeeded.has(ev.index)) {
          const args = ev.accumulated?.function?.arguments;
          if (args) parser.push(args);
          writeSeeded.add(ev.index);
        } else if (ev.argumentsFragment) {
          parser.push(ev.argumentsFragment);
        }
      } else if (name) {
        uiSink.onTool({ name, streaming: true });
      }
    }

    if (ev.type === 'round_complete') {
      if (ctx.xcodeAbsPath && xcodeTextLiveStream) {
        await xcodeWrite.awaitPending(ctx.xcodeAbsPath);
        await xcodeWrite.closeCodeFile(ctx.xcodeAbsPath);
      }

      return {
        finishReason: ev.finishReason,
        content: ev.content,
        toolCalls: ev.toolCalls,
        writeParsers,
        writeTargets,
      };
    }
  }

  return { error: '流式响应未正常结束' };
}

module.exports = { consumeAgentStream };
