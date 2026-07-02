/**
 * @file read-media.js
 *
 * LLM 工具：read_media_file — 从工程目录读取图片 / SVG，注入多模态上下文。
 * 使用共享模块 media-utils.js 完成 Base64 / SVG 文本转化。
 */

const fs = require('fs');
const pathLib = require('path');
var media;

function loadMedia() {
  if (!media) {
    try {
      media = require('../shared/media-utils');
    } catch (_) {
      media = null;
    }
  }
  return media;
}

var TOOL_NAME = 'read_media_file';

function getReadMediaFileTool() {
  loadMedia();
  return {
    type: 'function',
    function: {
      name: TOOL_NAME,
      description:
        'Read an image or SVG file from the project. ' +
        'Only use it when the user explicitly wants you to see a Figma design preview, ' +
        'screenshot, or any visual file. Returns the image as base64 data URI (for raster) ' +
        'or SVG XML text. Supports: jpg, png, gif, webp, bmp, svg. Max 10 MB per file.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Relative path to the image/SVG file under the project root, e.g. "previewAssets/abc.png".',
          },
        },
        required: ['path'],
      },
    },
  };
}

function isReadMediaFileToolName(name) {
  return name === TOOL_NAME;
}

function getMediaCallbacks(root, { feedObservationOfReadMedia } = {}) {
  loadMedia();
  return function executeReadMediaFile(task) {
    var p = task && task.args && task.args.path;
    if (!p) return { error: 'read_media_file: 缺少 path 参数' };
    var abs = pathLib.isAbsolute(p) ? p : pathLib.resolve(root, p);
    if (!abs || abs.indexOf(pathLib.resolve(root)) !== 0) {
      return { error: 'read_media_file: 路径越界' };
    }
    if (!media) {
      return { error: 'read_media_file: media-utils 模块加载失败' };
    }
    var item = media.fromDisk(abs, fs, pathLib);
    if (!item) return { error: 'read_media_file: 无法读取或文件不是支持的格式' };

    var result;
    if (item.kind === 'svg' && item.svgText) {
      result = 'SVG content:\n' + item.svgText.substring(0, 2000) +
        (item.svgText.length > 2000 ? '\n...(truncated)' : '');
    } else if (item.kind === 'raster') {
      result = 'Image ' + (item.name || '') + ' (' + item.mimeType + ') loaded.';
    } else {
      result = 'Media loaded.';
    }

    if (typeof feedObservationOfReadMedia === 'function') {
      var chatBlock = media.toChatContent(item);
      if (chatBlock) feedObservationOfReadMedia(chatBlock);
    }

    return { toolResult: result };
  };
}

module.exports = {
  getReadMediaFileTool,
  getMediaCallbacks,
  isReadMediaFileToolName,
};
