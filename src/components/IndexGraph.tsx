import {
  useRef,
  useState,
  useEffect,
  useCallback,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import * as d3 from 'd3';
import type { SimulationNodeDatum, SimulationLinkDatum } from 'd3';
import type { Article } from '../types';

// ─── Types ───────────────────────────────────────────────────────────────────

type Mode = 'graph' | 'matrix';

interface ArticleNode extends SimulationNodeDatum {
  id: string;
  type: 'article';
  label: string;
  article: Article;
  r: number;
}

interface TagNode extends SimulationNodeDatum {
  id: string;
  type: 'tag';
  label: string;
  r: number;
}

type GraphNode = ArticleNode | TagNode;

interface GraphLink extends SimulationLinkDatum<GraphNode> {
  source: GraphNode | string;
  target: GraphNode | string;
}

interface Transform {
  x: number;
  y: number;
  k: number;
}

interface IndexGraphProps {
  articles: Article[];
  onSelect: (id: string) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function buildGraph(articles: Article[]): { nodes: GraphNode[]; links: GraphLink[] } {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  const tagSet = new Set<string>();

  articles.forEach((article) => {
    const articleNode: ArticleNode = {
      id: article.id,
      type: 'article',
      label: article.title,
      article,
      r: clamp(6 + article.tags.length * 2, 6, 16),
    };
    nodes.push(articleNode);
    article.tags.forEach((tag) => {
      tagSet.add(tag);
      links.push({ source: article.id, target: `tag:${tag}` });
    });
  });

  tagSet.forEach((tag) => {
    const tagNode: TagNode = {
      id: `tag:${tag}`,
      type: 'tag',
      label: tag,
      r: 5,
    };
    nodes.push(tagNode);
  });

  return { nodes, links };
}

// ─── GRAPH VIEW ───────────────────────────────────────────────────────────────

interface GraphViewProps {
  articles: Article[];
  onSelect: (id: string) => void;
}

function GraphView({ articles, onSelect }: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, k: 1 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // Refs for sim data (avoid stale closures)
  const simNodesRef = useRef<GraphNode[]>([]);
  const simLinksRef = useRef<GraphLink[]>([]);
  const simRef = useRef<d3.Simulation<GraphNode, GraphLink> | null>(null);
  const rafRef = useRef<number | null>(null);

  // Pan state
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, tx: 0, ty: 0 });

  // Drag state
  const isDraggingRef = useRef(false);
  const didDragRef = useRef(false);
  const dragNodeRef = useRef<GraphNode | null>(null);

  // ResizeObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        const { width, height } = entry.contentRect;
        setSize({ width, height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Build & run simulation
  useEffect(() => {
    const { nodes, links } = buildGraph(articles);

    // Scatter nodes near center to avoid all-at-origin collapse
    const cx = size.width / 2;
    const cy = size.height / 2;
    nodes.forEach((n) => {
      if (n.x === undefined) {
        n.x = cx + (Math.random() - 0.5) * 120;
        n.y = cy + (Math.random() - 0.5) * 120;
      }
    });

    simNodesRef.current = nodes;
    simLinksRef.current = links;

    const sim = d3
      .forceSimulation<GraphNode>(nodes)
      .force(
        'link',
        d3
          .forceLink<GraphNode, GraphLink>(links)
          .id((d) => d.id)
          .distance(90),
      )
      .force('charge', d3.forceManyBody<GraphNode>().strength(-250))
      .force('center', d3.forceCenter(cx, cy))
      .force('collide', d3.forceCollide<GraphNode>().radius((d) => d.r + 8))
      .on('tick', () => {
        if (rafRef.current !== null) return; // already scheduled
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          setTick((n) => n + 1);
        });
      });

    simRef.current = sim;

    return () => {
      sim.stop();
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [articles, size.width, size.height]);

  // ── Zoom/pan handlers ──

  const handleWheel = useCallback((e: ReactWheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    setTransform((t) => {
      const newK = clamp(t.k * factor, 0.15, 8);
      // Zoom toward cursor
      const rect = containerRef.current?.getBoundingClientRect();
      const mx = rect ? e.clientX - rect.left : e.clientX;
      const my = rect ? e.clientY - rect.top : e.clientY;
      const newX = mx - (mx - t.x) * (newK / t.k);
      const newY = my - (my - t.y) * (newK / t.k);
      return { x: newX, y: newY, k: newK };
    });
  }, []);

  const handleSVGMouseDown = useCallback((e: ReactMouseEvent<SVGSVGElement>) => {
    if (isDraggingRef.current) return;
    isPanningRef.current = true;
    panStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      tx: 0,
      ty: 0,
    };
    // capture current transform
    setTransform((t) => {
      panStartRef.current.tx = t.x;
      panStartRef.current.ty = t.y;
      return t;
    });
  }, []);

  const handleSVGMouseMove = useCallback((e: ReactMouseEvent<SVGSVGElement>) => {
    if (!isPanningRef.current || isDraggingRef.current) return;
    const dx = e.clientX - panStartRef.current.x;
    const dy = e.clientY - panStartRef.current.y;
    setTransform((t) => ({
      ...t,
      x: panStartRef.current.tx + dx,
      y: panStartRef.current.ty + dy,
    }));
  }, []);

  const handleSVGMouseUp = useCallback(() => {
    isPanningRef.current = false;
  }, []);

  // ── Node drag handlers ──

  const handleNodeMouseDown = useCallback(
    (e: ReactMouseEvent<SVGElement>, node: GraphNode) => {
      e.stopPropagation();
      isDraggingRef.current = true;
      didDragRef.current = false;
      dragNodeRef.current = node;
      node.fx = node.x;
      node.fy = node.y;
    },
    [],
  );

  const handleSVGMouseMoveForDrag = useCallback(
    (e: ReactMouseEvent<SVGSVGElement>) => {
      if (!isDraggingRef.current || !dragNodeRef.current) return;
      const node = dragNodeRef.current;
      const rect = containerRef.current?.getBoundingClientRect();
      const mx = rect ? e.clientX - rect.left : e.clientX;
      const my = rect ? e.clientY - rect.top : e.clientY;
      // Convert from screen coords to sim coords
      node.fx = (mx - transform.x) / transform.k;
      node.fy = (my - transform.y) / transform.k;
      didDragRef.current = true;
      simRef.current?.alphaTarget(0.3).restart();
    },
    [transform],
  );

  const handleSVGMouseUpForDrag = useCallback(() => {
    if (isDraggingRef.current && dragNodeRef.current) {
      dragNodeRef.current.fx = null;
      dragNodeRef.current.fy = null;
      simRef.current?.alphaTarget(0);
    }
    isDraggingRef.current = false;
    dragNodeRef.current = null;
    isPanningRef.current = false;
  }, []);

  const combinedMouseMove = useCallback(
    (e: ReactMouseEvent<SVGSVGElement>) => {
      handleSVGMouseMoveForDrag(e);
      if (!isDraggingRef.current) handleSVGMouseMove(e);
    },
    [handleSVGMouseMoveForDrag, handleSVGMouseMove],
  );

  const combinedMouseUp = useCallback(() => {
    handleSVGMouseUpForDrag();
    handleSVGMouseUp();
  }, [handleSVGMouseUpForDrag, handleSVGMouseUp]);

  // Compute connected set for hover dimming
  const connectedNodeIds = useCallback(
    (id: string | null): Set<string> => {
      if (!id) return new Set();
      const set = new Set<string>([id]);
      simLinksRef.current.forEach((link) => {
        const s = typeof link.source === 'string' ? link.source : link.source.id;
        const t = typeof link.target === 'string' ? link.target : link.target.id;
        if (s === id) set.add(t ?? '');
        if (t === id) set.add(s ?? '');
      });
      return set;
    },
    // tick is a dep so we recompute after sim updates
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tick],
  );

  const connectedIds = hoveredId ? connectedNodeIds(hoveredId) : null;

  const nodes = simNodesRef.current;
  const links = simLinksRef.current;

  const { width, height } = size;
  const patternId = 'grid-pattern';

  return (
    <div ref={containerRef} className="graph-svg-container">
      <svg
        width={width}
        height={height}
        style={{ display: 'block', cursor: isPanningRef.current ? 'grabbing' : 'grab' }}
        onWheel={handleWheel}
        onMouseDown={handleSVGMouseDown}
        onMouseMove={combinedMouseMove}
        onMouseUp={combinedMouseUp}
        onMouseLeave={combinedMouseUp}
      >
        <defs>
          <pattern
            id={patternId}
            width={40}
            height={40}
            patternUnits="userSpaceOnUse"
            x={transform.x % 40}
            y={transform.y % 40}
          >
            <line x1={0} y1={0} x2={40} y2={0} stroke="#D5D3C8" strokeWidth={0.5} opacity={0.6} />
            <line x1={0} y1={0} x2={0} y2={40} stroke="#D5D3C8" strokeWidth={0.5} opacity={0.6} />
          </pattern>
        </defs>

        {/* Graph paper background */}
        <rect width={width} height={height} fill={`url(#${patternId})`} />

        <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
          {/* Links */}
          {links.map((link, i) => {
            const s = link.source as GraphNode;
            const t = link.target as GraphNode;
            if (s.x === undefined || t.x === undefined) return null;
            const dimmed =
              connectedIds !== null &&
              !connectedIds.has(s.id) &&
              !connectedIds.has(t.id);
            const highlighted =
              connectedIds !== null &&
              (connectedIds.has(s.id) || connectedIds.has(t.id));
            return (
              <line
                key={i}
                x1={s.x}
                y1={s.y}
                x2={t.x}
                y2={t.y}
                stroke={highlighted ? 'var(--ink)' : 'var(--border)'}
                strokeWidth={0.8}
                opacity={dimmed ? 0.1 : 1}
                style={{ transition: 'opacity 0.15s, stroke 0.15s' }}
              />
            );
          })}

          {/* Nodes */}
          {nodes.map((node) => {
            if (node.x === undefined || node.y === undefined) return null;
            const dimmed = connectedIds !== null && !connectedIds.has(node.id);
            const isHovered = hoveredId === node.id;
            const baseOpacity = dimmed ? 0.1 : 1;

            if (node.type === 'tag') {
              const size2 = 10;
              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x},${node.y})`}
                  opacity={baseOpacity}
                  style={{ cursor: 'default', transition: 'opacity 0.15s' }}
                  onMouseEnter={() => setHoveredId(node.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  onMouseDown={(e) => handleNodeMouseDown(e, node)}
                >
                  {/* Diamond: rect rotated 45° */}
                  <rect
                    x={-size2 / 2}
                    y={-size2 / 2}
                    width={size2}
                    height={size2}
                    transform="rotate(45)"
                    fill="var(--bg)"
                    stroke={isHovered ? 'var(--ink)' : 'var(--border)'}
                    strokeWidth={isHovered ? 1.5 : 1}
                  />
                  {/* Tag label — always visible */}
                  <text
                    y={size2 / 2 + 11}
                    textAnchor="middle"
                    fontFamily="var(--mono)"
                    fontSize={9}
                    fill="var(--ink)"
                    letterSpacing="0.06em"
                    style={{ textTransform: 'uppercase', pointerEvents: 'none' }}
                  >
                    {node.label}
                  </text>
                </g>
              );
            }

            // Article node
            return (
              <g
                key={node.id}
                transform={`translate(${node.x},${node.y})`}
                opacity={baseOpacity}
                style={{ cursor: 'pointer', transition: 'opacity 0.15s' }}
                onMouseEnter={() => setHoveredId(node.id)}
                onMouseLeave={() => setHoveredId(null)}
                onMouseDown={(e) => handleNodeMouseDown(e, node)}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!didDragRef.current) onSelect(node.article.id);
                }}
              >
                <circle
                  r={node.r}
                  fill="var(--bg)"
                  stroke="var(--ink)"
                  strokeWidth={isHovered ? 2.5 : 1.5}
                />
                {/* Article label — only on hover */}
                {isHovered && (
                  <text
                    y={node.r + 14}
                    textAnchor="middle"
                    fontFamily="var(--serif)"
                    fontStyle="italic"
                    fontSize={12}
                    fill="var(--ink)"
                    style={{ pointerEvents: 'none' }}
                  >
                    {node.label.length > 36 ? node.label.slice(0, 36) + '…' : node.label}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

// ─── MATRIX VIEW ──────────────────────────────────────────────────────────────

interface MatrixViewProps {
  articles: Article[];
  onSelect: (id: string) => void;
}

function MatrixView({ articles, onSelect }: MatrixViewProps) {
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);
  const [hoveredCol, setHoveredCol] = useState<string | null>(null);

  const allTags = Array.from(
    new Set(articles.flatMap((a) => a.tags)),
  ).sort();

  return (
    <div className="matrix-container">
      <table className="matrix-table" cellSpacing={0} cellPadding={0}>
        <thead>
          <tr>
            {/* Corner cell */}
            <th className="matrix-th-corner" />
            {allTags.map((tag) => (
              <th
                key={tag}
                className={`matrix-th-tag${hoveredCol === tag ? ' matrix-col-hover' : ''}`}
                onMouseEnter={() => setHoveredCol(tag)}
                onMouseLeave={() => setHoveredCol(null)}
              >
                <span className="matrix-th-tag-text">
                  {tag.length > 14 ? tag.slice(0, 14) + '…' : tag}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {articles.map((article) => (
            <tr
              key={article.id}
              className={`matrix-row${hoveredRow === article.id ? ' matrix-row--hovered' : ''}`}
              onMouseEnter={() => setHoveredRow(article.id)}
              onMouseLeave={() => setHoveredRow(null)}
            >
              <td
                className="matrix-td-title"
                onClick={() => onSelect(article.id)}
                title={article.title}
              >
                {article.title.length > 40
                  ? article.title.slice(0, 40) + '…'
                  : article.title}
              </td>
              {allTags.map((tag) => (
                <td
                  key={tag}
                  className={`matrix-td-cell${hoveredCol === tag ? ' matrix-col-hover' : ''}`}
                  onMouseEnter={() => setHoveredCol(tag)}
                  onMouseLeave={() => setHoveredCol(null)}
                >
                  {article.tags.includes(tag) && (
                    <span className="matrix-dot">●</span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export default function IndexGraph({ articles, onSelect }: IndexGraphProps) {
  const [mode, setMode] = useState<Mode>('graph');

  return (
    <div className="index-view">
      {/* Header */}
      <div className="index-header">
        <div className="index-header-left">
          <h1 className="index-title">Index</h1>
          <p className="index-subtitle">A network of your articles and themes</p>
        </div>
        <div className="index-toggle">
          <button
            className={`index-toggle-btn${mode === 'graph' ? ' index-toggle-btn--active' : ''}`}
            onClick={() => setMode('graph')}
          >
            Graph
          </button>
          <button
            className={`index-toggle-btn${mode === 'matrix' ? ' index-toggle-btn--active' : ''}`}
            onClick={() => setMode('matrix')}
          >
            Matrix
          </button>
        </div>
      </div>

      {/* Body */}
      {articles.length === 0 ? (
        <div className="index-empty">
          <span className="index-empty-headline">No articles yet</span>
          <span className="index-empty-sub">
            Add articles and themes to build your index.
          </span>
        </div>
      ) : mode === 'graph' ? (
        <GraphView articles={articles} onSelect={onSelect} />
      ) : (
        <MatrixView articles={articles} onSelect={onSelect} />
      )}
    </div>
  );
}
