/**
 * @file tools.js
 * 【功能】Agent 按需读取 Skill Layer / Resources / 分层节点
 */
const path = require('path');
const {
  listDevDocMeta,
  readSkillMarkdown,
  readLayerTreeForMeta,
  layerJsonBasename,
  getSkillMdPath,
  getLayerJsonPath,
} = require('../store');
const {
  normalizeDocMeta,
  extractResourcesFromSkill,
} = require('../document');
const { readSkillSectionByPath } = require('../../../markdown/skill-layer');

const {
  readResourceFileContent,
  runResourceScript,
  getSkillResourcesDir,
} = require('../resources');
const { emitAgentLog, publishSkillProgress } = require('../../../shared/agent-log');
const projectIo = require('../../../mcp-filesystem');

const DEV_DOC_TOOL_NAMES = new Set([
  'read_dev_doc_resources',
  'read_skill_layer',
  'read_skill_section',
  'read_skill_resource_file',
  'run_skill_resource_script',
]);
const MAX_TOOL_BODY = 6000;
const MAX_FEED_OBSERVATION = 10000;

const METHOD_LABELS = {
  read_skill_layer: '读取 Layer 树',
  read_skill_section: '读取 Layer 节点',
  read_dev_doc_resources: '读取 Resources',
  read_skill_resource_file: '读取资源文件',
  run_skill_resource_script: '执行资源脚本',
};

function inferLayerPath(name, args, extra = {}) {
  if (name === 'read_skill_section') return String(args.path || '').trim();
  if (name === 'read_skill_layer') return 'layer tree';
  if (name === 'read_dev_doc_resources') return 'resources';
  const rel = String(extra.relPath || args.path || '')
    .trim()
    .replace(/\\/g, '/');
  if (!rel) return String(args.path || '').trim();
  const parts = rel.split('/').filter(Boolean);
  if (name === 'read_skill_resource_file' || name === 'run_skill_resource_script') {
    if (parts[0] !== 'resources') parts.unshift('resources');
  }
  return parts.join(' · ');
}

function stripObservationHeader(text) {
  return String(text || '')
    .replace(/^【[^】]+】\n\n?/, '')
    .trim();
}

function buildLogSections(name, args, extra, execRaw) {
  const detail = [];
  if (extra.requestedPath && extra.relPath && extra.requestedPath !== extra.relPath) {
    detail.push({ k: '路径解析', v: `${extra.requestedPath} → ${extra.relPath}` });
  } else if (extra.relPath) {
    detail.push({ k: '资源路径', v: extra.relPath });
  } else if (args.path) {
    detail.push({ k: '路径', v: String(args.path) });
  }
  if (extra.matchKind) detail.push({ k: '匹配方式', v: String(extra.matchKind) });
  if (Array.isArray(args.args) && args.args.length) {
    detail.push({ k: '脚本参数', v: args.args.join(' ') });
  }
  if (extra.exitCode != null && extra.exitCode !== '') {
    detail.push({ k: '退出码', v: String(extra.exitCode) });
  }

  let output = '';
  if (name === 'run_skill_resource_script') {
    const chunks = [];
    if (String(extra.stdout || '').trim()) chunks.push(String(extra.stdout).trim());
    if (String(extra.stderr || '').trim()) chunks.push(String(extra.stderr).trim());
    output = chunks.join('\n\n');
    if (!output) output = '(无输出)';
  } else if (execRaw?.isError) {
    output = formatObservationText(execRaw);
  } else {
    output = stripObservationHeader(formatObservationText(execRaw));
  }
  if (output.length > 2400) output = `${output.slice(0, 2400)}\n…(已截断)`;
  return { detail, output };
}

function getDevDocTools() {
  return [
    {
      name: 'read_skill_layer',
      description:
        '仅在 system 未含 Layer 树时使用。system 已有 Layer 树时禁止调用；直接 run_skill_resource_script。',
      inputSchema: {
        type: 'object',
        properties: {
          skill_name: { type: 'string', description: 'Skill name 或文档标题' },
        },
        required: ['skill_name'],
      },
    },
    {
      name: 'read_skill_section',
      description:
        '按 Layer 树 path 读取 Skill 分层内容。path 示例：metadata | instructions | resources | resources/子标题-slug。',
      inputSchema: {
        type: 'object',
        properties: {
          skill_name: { type: 'string', description: 'Skill name 或文档标题' },
          path: {
            type: 'string',
            description: 'Layer 节点 path',
          },
        },
        required: ['skill_name', 'path'],
      },
    },
    {
      name: 'read_dev_doc_resources',
      description: '读取 Skill 的 Resources 全文。需要整篇原文时用；若只需一节请优先 read_skill_section。',
      inputSchema: {
        type: 'object',
        properties: {
          skill_name: { type: 'string', description: 'Skill name 或文档标题' },
        },
        required: ['skill_name'],
      },
    },
    {
      name: 'read_skill_resource_file',
      description:
        '读取 Skill 附属资源文件（已拷贝到 workflow-dev-docs/skills/{skill}/）。path 示例：scripts/sim_health_check.sh。Skill 正文若引用 bash scripts/xxx.sh 等路径，用此 tool 读取本地资源。',
      inputSchema: {
        type: 'object',
        properties: {
          skill_name: { type: 'string', description: 'Skill name 或文档标题' },
          path: {
            type: 'string',
            description: '资源文件相对 path，如 scripts/sim_health_check.sh',
          },
        },
        required: ['skill_name', 'path'],
      },
    },
    {
      name: 'run_skill_resource_script',
      description:
        '执行 Skill 附属脚本。path 按 Skill 正文（如 scripts/app_launcher.py）；args 传脚本参数。应用 exec 层会按磁盘资源树解析真实 relPath，勿先 read_skill_resource_file。',
      inputSchema: {
        type: 'object',
        properties: {
          skill_name: { type: 'string', description: 'Skill name 或文档标题' },
          path: {
            type: 'string',
            description: '脚本相对 path，如 scripts/sim_health_check.sh 或 scripts/check.py',
          },
          args: {
            type: 'array',
            items: { type: 'string' },
            description: '可选：传给脚本的命令行参数',
          },
        },
        required: ['skill_name', 'path'],
      },
    },
  ];
}

function isDevDocToolName(name) {
  return DEV_DOC_TOOL_NAMES.has(String(name || '').trim());
}

const SKILL_PROGRESS_SKIP =
  /^[\s\u2500─━=]+$/;

function shouldPublishSkillProgressLine(line) {
  const t = String(line || '').trim();
  if (!t || SKILL_PROGRESS_SKIP.test(t)) return false;
  if (/^\[\d+\/\d+\]/.test(t)) return true;
  if (/^[✓✔⚠✗]/.test(t)) return true;
  if (/^(Checks passed|Environment is ready|Next steps:|Summary|iOS Simulator)/i.test(t)) return true;
  if (/error|fail|warning|ready|booted|simulator|install|launch|BUILD/i.test(t)) return true;
  if (t.startsWith('Run:')) return true;
  return t.length <= 80;
}

function emitSkillProgress(meta, name, args, line, execOpts = {}) {
  const text = String(line || '').trim();
  if (!text || !shouldPublishSkillProgressLine(text)) return;
  const skillName = meta?.skillName || args?.skill_name || '';
  const payload = {
    skill: skillName,
    skillDocId: meta?.id ? String(meta.id) : '',
    method: name,
    methodLabel: METHOD_LABELS[name] || name,
    line: text,
    path: args?.path,
    relPath: args?.path,
    isError: Boolean(execOpts.isError),
  };
  if (typeof execOpts.onProgress === 'function') {
    execOpts.onProgress({ ...payload, module: 'skill' });
  } else {
    publishSkillProgress(payload);
  }
}

function findEnabledDocBySkillName(skillName) {
  const key = String(skillName || '').trim().toLowerCase();
  if (!key) return null;
  const metas = listDevDocMeta().map(normalizeDocMeta).filter((d) => d.aiEnabled === true);
  return (
    metas.find((d) => String(d.skillName || '').toLowerCase() === key) ||
    metas.find((d) => String(d.title || '').toLowerCase() === key) ||
    metas.find((d) => String(d.id || '').toLowerCase() === key) ||
    null
  );
}

function readResourcesForMeta(meta) {
  const skillMd = readSkillMarkdown(meta);
  let body = extractResourcesFromSkill(skillMd);
  if (!body.trim()) {
    const { stripSkillFrontmatter } = require('../document');
    body = stripSkillFrontmatter(skillMd);
  }
  return String(body || '').trim();
}

function capBody(body) {
  let text = String(body || '').trim();
  if (text.length > MAX_TOOL_BODY) text = `${text.slice(0, MAX_TOOL_BODY)}\n…(已截断)`;
  return text;
}

function formatObservationText(result) {
  if (!result || typeof result !== 'object') return String(result ?? '');
  const parts = Array.isArray(result.content) ? result.content : [];
  return parts
    .filter((p) => p && p.type === 'text' && p.text != null)
    .map((p) => String(p.text))
    .join('\n');
}

function publishSkillLog(name, args, meta, execRaw, extra = {}) {
  const status = projectIo.getStatus();
  let skillRoot = '';
  if (meta?.id) {
    try {
      skillRoot = getSkillResourcesDir(meta.skillName || meta.id, meta.id);
    } catch (_) {}
  }

  let sourcePath = String(extra.sourcePath || extra.absPath || '').trim();
  if (!sourcePath && skillRoot && extra.relPath) {
    sourcePath = path.join(skillRoot, String(extra.relPath));
  }

  const layerPath = String(extra.layerPath || inferLayerPath(name, args, extra)).trim();
  const { detail, output } = buildLogSections(name, args, extra, execRaw);
  const skillName = String(meta?.skillName || args?.skill_name || '').trim();
  const method = String(name || '').trim();
  let command = String(extra.command || '').trim();
  if (!command) {
    const parts = [method];
    if (args.path) parts.push(String(args.path));
    if (Array.isArray(args.args) && args.args.length) parts.push(args.args.join(' '));
    command = parts.filter(Boolean).join(' ');
  }

  let layerSectionPath = String(extra.layerSectionPath || '').trim();
  if (!layerSectionPath) {
    if (name === 'read_skill_section') layerSectionPath = String(args.path || '').trim();
    else if (name === 'read_dev_doc_resources') layerSectionPath = 'resources';
    else if (name === 'read_skill_layer') layerSectionPath = '__layer__';
  }
  let layerPreviewKind = '';
  if (layerSectionPath && skillName) layerPreviewKind = 'section';
  else if (sourcePath) layerPreviewKind = 'file';

  emitAgentLog({
    module: 'skill',
    moduleLabel: 'skill',
    skill: skillName,
    skillDocId: meta?.id ? String(meta.id) : '',
    method,
    methodLabel: METHOD_LABELS[name] || method,
    command,
    layerPath,
    layerSectionPath,
    layerPreviewKind,
    previewResourcePath: String(args.path || extra.path || '').trim(),
    path: String(args?.path || extra.path || '').trim(),
    sourcePath,
    sourceLabel: String(extra.sourceLabel || extra.relPath || args?.path || path.basename(sourcePath || '') || '').trim(),
    args: Array.isArray(args?.args) ? args.args.map((a) => String(a)) : undefined,
    relPath: extra.relPath != null ? String(extra.relPath) : '',
    matchKind: extra.matchKind != null ? String(extra.matchKind) : '',
    exitCode: extra.exitCode,
    src: status.connected ? String(status.projectRoot || '') : '',
    skillRoot,
    detail,
    output,
    isError: Boolean(execRaw?.isError),
  });
  return execRaw;
}

async function EXECUTE_execute_tool(routedTask, execOpts = {}) {
  if (routedTask.module !== 'skill') {
    return {
      isError: true,
      content: [{ type: 'text', text: `EXEC：未支持的模块 ${routedTask.module}` }],
    };
  }

  const { name, args = {} } = routedTask.task;
  const meta = findEnabledDocBySkillName(args.skill_name);
  if (!meta) {
    return publishSkillLog(name, args, null, {
      isError: true,
      content: [
        {
          type: 'text',
          text: `未找到已启用 skill 的开发文档「${args.skill_name || ''}」。请确认 Workflow 中已勾选 skill。`,
        },
      ],
    });
  }

  const skillMd = readSkillMarkdown(meta);
  const label = meta.title;
  const jsonFile = layerJsonBasename(meta.skillName || meta.id, meta.id);

  if (name === 'read_skill_layer') {
    const tree = readLayerTreeForMeta(meta);
    if (!tree?.nodes?.length) {
      return publishSkillLog(name, args, meta, {
        isError: true,
        content: [{ type: 'text', text: `文档「${label}」无 Layer 分层树。` }],
      });
    }
    const body = `Layer JSON 文件：${jsonFile}\n\n${JSON.stringify(tree, null, 2)}`;
    return publishSkillLog(name, args, meta, {
      isError: false,
      content: [
        {
          type: 'text',
          text: `【${label} · Layer · ${meta.skillName || meta.id}】\n\n${capBody(body)}`,
        },
      ],
    }, {
      layerPath: 'layer tree',
      sourcePath: getLayerJsonPath(meta.skillName || meta.id, meta.id),
      sourceLabel: jsonFile,
    });
  }

  if (name === 'read_skill_section') {
    const res = readSkillSectionByPath(skillMd, args.path);
    if (!res.ok) {
      return publishSkillLog(name, args, meta, {
        isError: true,
        content: [{ type: 'text', text: res.error || `无法读取 path「${args.path}」` }],
      }, { layerPath: args.path });
    }
    const mdPath = getSkillMdPath(meta.skillName || meta.id, meta.id);
    return publishSkillLog(name, args, meta, {
      isError: false,
      content: [
        {
          type: 'text',
          text: `【${label} · ${args.path} · ${meta.skillName || meta.id}】\n\n${capBody(res.body)}`,
        },
      ],
    }, {
      layerPath: args.path,
      sourcePath: mdPath,
      sourceLabel: path.basename(mdPath),
    });
  }

  if (name === 'read_dev_doc_resources') {
    let body = readResourcesForMeta(meta);
    if (!body) {
      return publishSkillLog(name, args, meta, {
        isError: true,
        content: [{ type: 'text', text: `文档「${label}」无 Resources 内容。` }],
      }, { layerPath: 'resources' });
    }
    const mdPath = getSkillMdPath(meta.skillName || meta.id, meta.id);
    return publishSkillLog(name, args, meta, {
      isError: false,
      content: [
        {
          type: 'text',
          text: `【${label} · Resources · ${meta.skillName || meta.id}】\n\n${capBody(body)}`,
        },
      ],
    }, {
      layerPath: 'resources',
      sourcePath: mdPath,
      sourceLabel: path.basename(mdPath),
    });
  }

  if (name === 'read_skill_resource_file') {
    const res = readResourceFileContent(meta.skillName || meta.id, meta.id, args.path);
    if (!res.ok) {
      return publishSkillLog(name, args, meta, {
        isError: true,
        content: [{ type: 'text', text: res.error || `无法读取资源「${args.path}」` }],
      }, { path: args.path });
    }
    return publishSkillLog(name, args, meta, {
      isError: false,
      content: [
        {
          type: 'text',
          text: `【${label} · resource · ${args.path} · ${meta.skillName || meta.id}】\n\n${capBody(res.body)}`,
        },
      ],
    }, {
      relPath: res.relPath,
      absPath: res.absPath,
      sourceLabel: res.relPath,
    });
  }

  if (name === 'run_skill_resource_script') {
    const extraArgs = Array.isArray(args.args) ? args.args : [];
    const skillName = meta.skillName || meta.id;
    emitSkillProgress(meta, name, args, `开始 ${args.path}`, execOpts);
    const res = await runResourceScript(skillName, meta.id, args.path, extraArgs, {
      onLine: (line) => emitSkillProgress(meta, name, args, line, execOpts),
    });
    if (!res.ok) {
      emitSkillProgress(meta, name, args, `失败：${res.error || args.path}`, {
        ...execOpts,
        isError: true,
      });
      return publishSkillLog(name, args, meta, {
        isError: true,
        content: [{ type: 'text', text: res.error || `无法执行脚本「${args.path}」` }],
      }, { path: args.path });
    }
    emitSkillProgress(
      meta,
      name,
      args,
      res.exitCode === 0 ? `完成 ${args.path} (exit 0)` : `结束 ${args.path} (exit ${res.exitCode})`,
      { ...execOpts, isError: res.exitCode !== 0 }
    );
    return publishSkillLog(name, args, meta, {
      isError: res.exitCode !== 0,
      content: [{ type: 'text', text: '(see output)' }],
    }, {
      path: args.path,
      relPath: res.relPath,
      requestedPath: res.requestedPath,
      matchKind: res.matchKind,
      command: res.command,
      exitCode: res.exitCode,
      stdout: res.stdout,
      stderr: res.stderr,
      absPath: res.absPath,
      sourceLabel: res.relPath,
    });
  }

  return {
    isError: true,
    content: [{ type: 'text', text: `EXEC：未知 dev-doc tool「${name}」` }],
  };
}

function FEED_tool_result(execRaw) {
  let observation = formatObservationText(execRaw);
  if (observation.length > MAX_FEED_OBSERVATION) {
    observation = `${observation.slice(0, MAX_FEED_OBSERVATION)}\n…(observation 已截断)`;
  }
  return { observation: observation || '(empty dev-doc tool result)' };
}

module.exports = {
  getDevDocTools,
  isDevDocToolName,
  DEV_DOC_TOOL_NAMES,
  EXECUTE_execute_tool,
  FEED_tool_result,
  findEnabledDocBySkillName,
};
