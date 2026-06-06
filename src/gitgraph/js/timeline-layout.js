/**
 * @file timeline-layout.js
 *
 * 【功能】Git 提交时间线：分支 lane + merge/fork 连线（与每行 commit 对齐）。
 */
(function (global) {
  const ROW_HEIGHT = 36;
  const LANE_WIDTH = 16;
  const PAD_LEFT = 14;
  const NODE_RADIUS = 10;
  const LINE_WIDTH = 2;
  const CORNER_RADIUS = 6;
  /** 左侧可滚动区域 = graphWidth × GRAPH_SCROLL_WIDTH_RATIO */
  const GRAPH_SCROLL_WIDTH_RATIO = 2;

  const LANE_COLORS = ['#2eb8c5', '#9b6dd4', '#d946a8', '#e05a4f', '#6bcf7f', '#e8b84a'];

  function cx(lane) {
    return PAD_LEFT + lane * LANE_WIDTH + LANE_WIDTH / 2;
  }

  function cy(row) {
    return row * ROW_HEIGHT + ROW_HEIGHT / 2;
  }

  /** @param {string} hex #rrggbb */
  function tintColor(hex, alpha = 0.24) {
    const h = String(hex || '').replace('#', '');
    if (h.length !== 6) return `rgba(120, 120, 120, ${alpha})`;
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  /**
   * 按 git 父子关系分配 lane（支持 merge、fork）。
   * @param {object[]} commitsOldestFirst
   */
  function assignBranchLanes(commitsOldestFirst) {
    /** @type {(string|null)[]} 每条 lane 当前 tip（最新已放置 commit） */
    const laneTips = [];
    /** @type {Map<string, { lane: number, colorIdx: number }>} */
    const commitMeta = new Map();

    for (const commit of commitsOldestFirst) {
      const parents = (commit.parents || []).filter(Boolean);
      let lane = -1;

      if (parents.length > 0) {
        lane = laneTips.findIndex((tip) => tip === parents[0]);
      }

      if (lane === -1 && parents.length > 0 && commitMeta.has(parents[0])) {
        lane = laneTips.findIndex((tip) => tip === null);
        if (lane === -1) {
          lane = laneTips.length;
          laneTips.push(null);
        }
      }

      if (lane === -1) {
        lane = laneTips.findIndex((tip) => tip === null);
      }
      if (lane === -1) {
        lane = laneTips.length;
        laneTips.push(null);
      }

      commitMeta.set(commit.hash, {
        lane,
        colorIdx: lane % LANE_COLORS.length,
      });
      laneTips[lane] = commit.hash;

      if (parents.length > 1) {
        for (let i = 1; i < parents.length; i += 1) {
          const pMeta = commitMeta.get(parents[i]);
          if (pMeta != null) {
            laneTips[pMeta.lane] = null;
          }
        }
      }
    }

    let laneCount = 0;
    for (const meta of commitMeta.values()) {
      laneCount = Math.max(laneCount, meta.lane + 1);
    }
    return { commitMeta, laneCount: Math.max(1, laneCount) };
  }

  /**
   * 竖线 → 圆角 → 横线（merge 汇入）。
   */
  function roundedConnectorVerticalFirst(x1, y1, x2, y2) {
    if (x1 === x2) return `M ${x1} ${y1} L ${x2} ${y2}`;
    if (y1 === y2) return `M ${x1} ${y1} L ${x2} ${y2}`;

    const dx = Math.abs(x2 - x1);
    const dy = Math.abs(y2 - y1);
    const r = Math.min(CORNER_RADIUS, dx / 2, dy / 2);
    if (r < 1) return `M ${x1} ${y1} L ${x1} ${y2} L ${x2} ${y2}`;

    const xDir = x2 > x1 ? 1 : -1;
    const yDir = y2 > y1 ? 1 : -1;
    const yBeforeCorner = y2 - yDir * r;
    const xAfterCorner = x1 + xDir * r;

    return `M ${x1} ${y1} L ${x1} ${yBeforeCorner} Q ${x1} ${y2} ${xAfterCorner} ${y2} L ${x2} ${y2}`;
  }

  /**
   * 横线 → 圆角 → 竖线（fork 开出）。
   */
  function roundedConnectorHorizontalFirst(x1, y1, x2, y2) {
    if (x1 === x2) return `M ${x1} ${y1} L ${x2} ${y2}`;
    if (y1 === y2) return `M ${x1} ${y1} L ${x2} ${y2}`;

    const dx = Math.abs(x2 - x1);
    const dy = Math.abs(y2 - y1);
    const r = Math.min(CORNER_RADIUS, dx / 2, dy / 2);
    if (r < 1) return `M ${x1} ${y1} L ${x2} ${y1} L ${x2} ${y2}`;

    const xDir = x2 > x1 ? 1 : -1;
    const yDir = y2 > y1 ? 1 : -1;
    const xBeforeCorner = x2 - xDir * r;
    const yAfterCorner = y1 + yDir * r;

    return `M ${x1} ${y1} L ${xBeforeCorner} ${y1} Q ${x2} ${y1} ${x2} ${yAfterCorner} L ${x2} ${y2}`;
  }

  function addConnector(paths, fromLane, toLane, fromRow, toRow, colorIdx, style) {
    if (fromLane === toLane || fromRow == null || toRow == null) return;
    const color = LANE_COLORS[colorIdx % LANE_COLORS.length];
    const x1 = cx(fromLane);
    const x2 = cx(toLane);
    const y1 = cy(fromRow);
    const y2 = cy(toRow);
    const d =
      style === 'fork'
        ? roundedConnectorHorizontalFirst(x1, y1, x2, y2)
        : roundedConnectorVerticalFirst(x1, y1, x2, y2);
    paths.push({ d, color, width: LINE_WIDTH });
  }

  /**
   * @param {object[]} commitsOldestFirst
   */
  function buildTimelineModel(commitsOldestFirst) {
    const display = [...commitsOldestFirst].reverse();
    const rowOf = new Map(display.map((c, i) => [c.hash, i]));
    const { commitMeta, laneCount } = assignBranchLanes(commitsOldestFirst);

    /** @type {Array<{ d: string, color: string, width: number }>} */
    const paths = [];

    /** @type {Map<number, Array<{ row: number, colorIdx: number }>>} */
    const laneRows = new Map();

    for (const commit of commitsOldestFirst) {
      const meta = commitMeta.get(commit.hash);
      if (!meta) continue;
      const row = rowOf.get(commit.hash);
      if (row == null) continue;
      if (!laneRows.has(meta.lane)) laneRows.set(meta.lane, []);
      laneRows.get(meta.lane).push({ row, colorIdx: meta.colorIdx });
    }

    for (const [lane, items] of laneRows) {
      items.sort((a, b) => a.row - b.row);
      const color = LANE_COLORS[items[0].colorIdx % LANE_COLORS.length];
      for (let i = 0; i < items.length - 1; i += 1) {
        paths.push({
          d: `M ${cx(lane)} ${cy(items[i].row)} L ${cx(lane)} ${cy(items[i + 1].row)}`,
          color,
          width: LINE_WIDTH,
        });
      }
    }

    for (const commit of commitsOldestFirst) {
      const meta = commitMeta.get(commit.hash);
      if (!meta) continue;
      const row = rowOf.get(commit.hash);
      if (row == null) continue;
      const parents = (commit.parents || []).filter(Boolean);

      if (parents.length > 0) {
        const pMeta = commitMeta.get(parents[0]);
        if (pMeta && pMeta.lane !== meta.lane) {
          addConnector(
            paths,
            pMeta.lane,
            meta.lane,
            rowOf.get(parents[0]),
            row,
            pMeta.colorIdx,
            'fork'
          );
        }
      }

      for (let i = 1; i < parents.length; i += 1) {
        const pMeta = commitMeta.get(parents[i]);
        if (!pMeta || pMeta.lane === meta.lane) continue;
        addConnector(
          paths,
          pMeta.lane,
          meta.lane,
          rowOf.get(parents[i]),
          row,
          pMeta.colorIdx,
          'merge'
        );
      }
    }

    const nodes = display.map((commit) => {
      const meta = commitMeta.get(commit.hash) || { lane: 0, colorIdx: 0 };
      const row = rowOf.get(commit.hash) ?? 0;
      const color = LANE_COLORS[meta.colorIdx % LANE_COLORS.length];
      return {
        commit,
        row,
        lane: meta.lane,
        color,
        tint: tintColor(color),
        x: cx(meta.lane),
        y: cy(row),
        label: commit.dotText || '?',
      };
    });

    const graphWidth = PAD_LEFT * 2 + laneCount * LANE_WIDTH;
    const scrollWidth = graphWidth * GRAPH_SCROLL_WIDTH_RATIO;
    const graphHeight = display.length * ROW_HEIGHT;

    return { display, nodes, paths, graphWidth, scrollWidth, graphHeight, ROW_HEIGHT };
  }

  global.GitTimelineLayout = {
    ROW_HEIGHT,
    NODE_RADIUS,
    LINE_WIDTH,
    GRAPH_SCROLL_WIDTH_RATIO,
    buildTimelineModel,
    tintColor,
    LANE_COLORS,
  };
})(typeof window !== 'undefined' ? window : globalThis);
