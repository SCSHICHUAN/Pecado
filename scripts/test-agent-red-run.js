#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

async function main() {
  const cfgPath = path.join(process.env.HOME, 'Library/Application Support/pecado/volc-user-config.json');
  if (!fs.existsSync(cfgPath)) {
    console.error('no volc config');
    process.exit(1);
  }
  const projectIo = require('../src/mcp-filesystem');
  const { runAppAgentLoop } = require('../src/agent-loop');
  const { AGENT_SYSTEM_PROMPT } = require('../src/pecado/js/prompts/agent');
  const { buildCodxEditorContextForAi } = require('../src/codX/agent/context');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const projectRoot = '/Users/stan/Desktop/PecadoTest';
  const codxFile = 'PecadoTest/ViewController.m';
  const userText = process.argv[2] || '背景红色 运行';

  await projectIo.connect(projectRoot);
  const tools = [];
  const uiSink = {
    onTool(ev) {
      if (ev.arguments && Object.keys(ev.arguments).length) tools.push(ev.name);
      else if (!tools.includes(ev.name) || ev.name === 'finish_task') tools.push(ev.name);
    },
    onError(e) {
      console.error('[error]', e);
    },
  };

  const result = await runAppAgentLoop(
    uiSink,
    { apiKey: cfg.volcArkApiKey, model: cfg.volcArkModel, apiMode: cfg.volcApiMode || 'coding_plan' },
    [
      { role: 'system', content: AGENT_SYSTEM_PROMPT + '\n\n' + buildCodxEditorContextForAi(codxFile) },
      { role: 'user', content: userText },
    ],
    { userText, xcodeStreamPath: codxFile }
  );

  console.log('tools:', [...new Set(tools)].join(' → '));
  console.log('finish_task:', tools.includes('finish_task'));
  console.log('xcode_run:', tools.includes('xcode_run'));
  if (result.error) console.error('ERROR:', result.error);
  else console.log('RESULT:', (result.content || '').slice(0, 400));
  await projectIo.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
