import { parse, testLabel } from '../regex/parser';
import { buildNfa, simulate, startStates, type Nfa } from '../regex/nfa';
import { buildDfa, dfaSimulate, type Dfa } from '../regex/dfa';

const REPO_URL = 'https://github.com/rajpalgelot-tech/regex-engine-simulator';
const GUIDE_URL = REPO_URL + '/blob/main/GUIDE.md';

const EXAMPLES = [
  { name: '(a|b)*abb', note: 'the dragon book classic' },
  { name: 'a*b+', note: 'star then plus' },
  { name: '(0|1)*1', note: 'binary ending in 1' },
  { name: '[a-z]+\\.(com|org)', note: 'tiny web address' },
  { name: 'colou?r', note: 'british optional' },
  { name: '[^abc]+', note: 'negated class' },
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text) node.textContent = text;
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag: string, attrs: Record<string, string | number>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

// Longest-path layering over the forward edges. Thompson graphs are DAGs in
// the forward direction (every edge with from < to), so one ascending pass
// settles every layer; loop edges (from > to) render as arcs instead.
function layers(nfa: Nfa): number[] {
  const layer = new Array(nfa.stateCount).fill(0);
  const sorted = [...nfa.edges].sort((a, b) => a.from - b.from);
  for (const e of sorted) {
    if (e.to > e.from && layer[e.to] < layer[e.from] + 1) {
      layer[e.to] = layer[e.from] + 1;
    }
  }
  // the start state anchors layer 0
  if (layer[nfa.start] !== 0) {
    for (let i = 0; i < layer.length; i++) layer[i] -= layer[nfa.start];
  }
  return layer;
}

interface GraphPos {
  x: number;
  y: number;
  layer: number;
}

function layout(nfa: Nfa): { pos: Map<number, GraphPos>; width: number; height: number } {
  const layer = layers(nfa);
  const maxLayer = Math.max(...layer);
  const byLayer: number[][] = Array.from({ length: maxLayer + 1 }, () => []);
  for (let s = 0; s < nfa.stateCount; s++) byLayer[layer[s]].push(s);
  byLayer.forEach((col) => col.sort((a, b) => a - b));

  const pos = new Map<number, GraphPos>();
  const colGap = 108;
  const rowGap = 52;
  const padX = 44;
  const padY = 40;
  const nodeR = 17;
  byLayer.forEach((col, li) => {
    const spread = (col.length - 1) * rowGap;
    col.forEach((s, ri) => {
      pos.set(s, {
        x: padX + li * colGap,
        y: padY + (col.length > 1 ? (spread * ri) / (col.length - 1) : spread / 2),
        layer: li,
      });
    });
  });
  const widest = Math.max(...byLayer.map((c) => c.length));
  return {
    pos,
    width: padX * 2 + maxLayer * colGap,
    height: padY * 2 + Math.max(0, widest - 1) * rowGap + nodeR * 2,
  };
}

function drawNfa(svg: SVGSVGElement, nfa: Nfa, active: Set<number> | null): void {
  svg.replaceChildren();
  const { pos, width, height } = layout(nfa);
  svg.setAttribute('viewBox', `0 0 ${width} ${Math.max(height, 120)}`);
  svg.setAttribute('width', '100%');

  const defs = svgEl('defs', {});
  defs.innerHTML =
    `<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">` +
    `<path d="M 0 0 L 10 5 L 0 10 z" fill="#7dd3fc"></path></marker>` +
    `<marker id="arrow-eps" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">` +
    `<path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b"></path></marker>`;
  svg.append(defs);

  // edges first so nodes sit on top
  for (const e of nfa.edges) {
    const a = pos.get(e.from)!;
    const b = pos.get(e.to)!;
    const eps = e.test === null;
    const label = e.test === null ? '\u03B5' : testLabel(e.test);
    const backward = e.to <= e.from;
    const activeEdge = active !== null && active.has(e.from) && (eps || active.has(e.from));
    let d: string;
    if (backward) {
      // loop: arc above the source node
      const r = 16;
      d = `M ${a.x} ${a.y - r} C ${a.x - 30} ${a.y - r - 26}, ${a.x + 30} ${a.y - r - 26}, ${a.x} ${a.y - r}`;
    } else if (Math.abs(a.y - b.y) < 1) {
      d = `M ${a.x + 12} ${a.y} L ${b.x - 12} ${b.y}`;
    } else {
      d = `M ${a.x} ${a.y} C ${(a.x + b.x) / 2} ${a.y}, ${(a.x + b.x) / 2} ${b.y}, ${b.x - 10} ${b.y}`;
    }
    const path = svgEl('path', {
      d,
      fill: 'none',
      stroke: eps ? '#64748b' : '#7dd3fc',
      'stroke-width': activeEdge ? 2.4 : 1.4,
      'stroke-dasharray': eps ? '4 3' : 'none',
      'marker-end': eps ? 'url(#arrow-eps)' : 'url(#arrow)',
      opacity: activeEdge ? 1 : 0.8,
    });
    svg.append(path);

    const mx = (a.x + b.x) / 2;
    const my = backward ? a.y - 34 : (a.y + b.y) / 2 - 5;
    const text = svgEl('text', {
      x: backward ? a.x : mx,
      y: my,
      'text-anchor': 'middle',
      'font-size': 11,
      'font-family': 'monospace',
      fill: eps ? '#94a3b8' : '#bae6fd',
    });
    text.textContent = label;
    svg.append(text);
  }

  // states
  for (let s = 0; s < nfa.stateCount; s++) {
    const p = pos.get(s)!;
    const isActive = active !== null && active.has(s);
    const isAccept = s === nfa.accept;
    const group = svgEl('g', {});
    if (isActive) {
      group.append(svgEl('circle', { cx: p.x, cy: p.y, r: 17, fill: 'rgba(52, 211, 153, 0.25)' }));
    }
    group.append(svgEl('circle', {
      cx: p.x, cy: p.y, r: 12,
      fill: isActive ? 'rgba(52, 211, 153, 0.35)' : '#0e1a26',
      stroke: isAccept ? '#34d399' : '#38bdf8',
      'stroke-width': isAccept ? 2.4 : 1.6,
    }));
    if (isAccept) {
      group.append(svgEl('circle', { cx: p.x, cy: p.y, r: 8, fill: 'none', stroke: '#34d399', 'stroke-width': 1.4 }));
    }
    const label = svgEl('text', {
      x: p.x, y: p.y + 3.5, 'text-anchor': 'middle', 'font-size': 9.5,
      'font-family': 'monospace', fill: isActive ? '#d1fae5' : '#7dd3fc',
    });
    label.textContent = String(s);
    group.append(label);
    if (s === nfa.start) {
      const arrow = svgEl('path', {
        d: `M ${p.x - 34} ${p.y} L ${p.x - 13} ${p.y}`,
        stroke: '#fbbf24', 'stroke-width': 1.8, fill: 'none',
        'marker-end': 'url(#arrow)',
      });
      group.append(arrow);
    }
    svg.append(group);
  }
}

interface Engine {
  nfa: Nfa | null;
  dfa: Dfa | null;
  errors: string[];
}

function compile(pattern: string): Engine {
  const res = parse(pattern);
  if (!res.ok) return { nfa: null, dfa: null, errors: res.errors };
  const nfa = buildNfa(res.ast);
  return { nfa, dfa: buildDfa(nfa), errors: [] };
}

export function startApp(root: HTMLElement): void {
  let engine: Engine = { nfa: null, dfa: null, errors: [] };

  // -- chrome -----------------------------------------------------------------

  const header = el('header', 'top');
  const brand = el('div', 'brand');
  brand.append(
    el('span', 'brand-name', 'Regex'),
    el('span', 'brand-sub', 'watch a pattern become a machine'),
  );
  const nav = el('nav', 'top-nav');
  const repoLink = el('a', 'nav-link', 'GitHub');
  repoLink.href = REPO_URL;
  repoLink.target = '_blank';
  const guideLink = el('a', 'nav-link', 'Guide');
  guideLink.href = GUIDE_URL;
  guideLink.target = '_blank';
  nav.append(repoLink, guideLink);
  header.append(brand, nav);

  const controls = el('section', 'controls');
  const patternWrap = el('div', 'pattern-wrap');
  const patternInput = el('input', 'pattern-input mono') as HTMLInputElement;
  patternInput.placeholder = 'type a regex, e.g. (a|b)*abb';
  patternInput.value = EXAMPLES[0].name;
  patternWrap.append(patternInput);
  const exampleWrap = el('div', 'examples');
  const exampleButtons = EXAMPLES.map((ex) => {
    const b = el('button', 'btn tiny mono', ex.name);
    b.title = ex.note;
    b.addEventListener('click', () => {
      patternInput.value = ex.name;
      rebuild();
    });
    return b;
  });
  exampleWrap.append('examples:', ...exampleButtons);
  const statsBar = el('div', 'stats-bar mono');
  controls.append(patternWrap, exampleWrap, statsBar);

  const banner = el('section', 'banner idle');
  const bannerText = el('span', 'banner-text');
  banner.append(bannerText);

  const testBar = el('section', 'test-bar');
  const inputWrap = el('label', 'input-wrap');
  const inputField = el('input', 'input-field mono') as HTMLInputElement;
  inputField.placeholder = 'test input to run through the machine';
  inputWrap.append(el('span', 'input-label', 'test input'), inputField);
  const verdict = el('span', 'verdict mono');
  testBar.append(inputWrap, verdict);

  const main = el('main', 'layout');
  const nfaPanel = el('section', 'panel nfa-panel');
  nfaPanel.append(el('h2', 'panel-title', 'NFA (Thompson construction)'));
  const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
  svg.classList.add('nfa-svg');
  nfaPanel.append(svg);

  const sidePanel = el('section', 'side');
  const tracePanel = el('div', 'panel');
  tracePanel.append(el('h2', 'panel-title', 'match trace (parallel state sets)'));
  const traceBox = el('div', 'trace-box mono');
  tracePanel.append(traceBox);
  const dfaPanel = el('div', 'panel');
  dfaPanel.append(el('h2', 'panel-title', 'DFA (subset construction)'));
  const dfaBox = el('div', 'dfa-box');
  dfaPanel.append(dfaBox);
  sidePanel.append(tracePanel, dfaPanel);

  main.append(nfaPanel, sidePanel);

  const footer = el('footer', 'foot', 'Regex is a teaching engine: the whole input must match, there are no captures, and repetition counts like {2,4} are not supported.');
  root.append(header, controls, banner, testBar, main, footer);

  // -- rendering ----------------------------------------------------------------

  function renderStats(): void {
    statsBar.replaceChildren();
    if (!engine.nfa || !engine.dfa) return;
    const items = [
      `NFA states: ${engine.nfa.stateCount}`,
      `NFA edges: ${engine.nfa.edges.length}`,
      `DFA states: ${engine.dfa.states.length}`,
      `DFA symbols: ${engine.dfa.symbols.length}`,
    ];
    for (const t of items) statsBar.append(el('span', 'stat-chip', t));
  }

  function renderBanner(): void {
    if (engine.errors.length > 0) {
      banner.className = 'banner bad';
      bannerText.textContent = engine.errors.join('  |  ');
      return;
    }
    const input = inputField.value;
    if (input === '') {
      banner.className = 'banner idle';
      bannerText.textContent = 'type a test input to send it through the machine';
      return;
    }
    if (engine.nfa) {
      const res = simulate(engine.nfa, input);
      banner.className = 'banner ' + (res.accepted ? 'ok' : 'bad');
      bannerText.textContent = res.accepted
        ? `"${input}" matches the pattern`
        : `"${input}" does not match: ${res.steps.length === input.length ? 'the machine got stuck before consuming everything' : 'no accepting path'}`;
    }
  }

  function renderTrace(): void {
    traceBox.replaceChildren();
    if (!engine.nfa) return;
    const input = inputField.value;
    if (input === '') {
      traceBox.append(el('div', 'trace-empty', 'the trace will show the set of states alive after each character'));
      return;
    }
    const res = simulate(engine.nfa, input);
    const row0 = el('div', 'trace-row head');
    row0.append(el('span', 'trace-pos', 'start'), el('span', 'trace-set', `[${[...startStates(engine.nfa)].sort((a, b) => a - b).join(',')}]`));
    traceBox.append(row0);
    res.steps.forEach((step, i) => {
      const row = el('div', 'trace-row' + (i === res.steps.length - 1 ? ' last' : ''));
      row.append(el('span', 'trace-pos mono', `${i + 1} '${step.ch}'`));
      const set = [...step.states].sort((a, b) => a - b).join(',');
      row.append(el('span', 'trace-set', step.states.size === 0 ? 'dead (stuck)' : `{${set}}`));
      traceBox.append(row);
    });
  }

  function renderDfaTable(): void {
    dfaBox.replaceChildren();
    if (!engine.dfa) return;
    const dfa = engine.dfa;
    const table = el('table', 'dfa-table mono');
    const head = el('tr', 'dfa-head');
    head.append(el('th', '', 'state'));
    head.append(el('th', '', 'NFA set'));
    for (const sym of dfa.symbols) head.append(el('th', '', testLabel(sym)));
    table.append(head);
    for (let i = 0; i < dfa.states.length; i++) {
      const row = el('tr', (dfa.states[i].accepting ? 'dfa-accept ' : '') + (i === dfa.start ? 'dfa-start' : ''));
      row.append(el('td', '', (i === dfa.start ? '\u2192 ' : '') + dfa.states[i].name));
      row.append(el('td', 'dfa-set', `{${dfa.states[i].nfaStates.join(',')}}`));
      for (const target of dfa.transitions[i]) {
        row.append(el('td', '', dfa.states[target].name));
      }
      table.append(row);
    }
    dfaBox.append(table);
  }

  function renderGraph(): void {
    if (!engine.nfa) {
      svg.replaceChildren();
      return;
    }
    const input = inputField.value;
    let active: Set<number> | null = null;
    if (input !== '') {
      const res = simulate(engine.nfa, input);
      active = res.steps.length > 0 ? res.steps[res.steps.length - 1].states : startStates(engine.nfa);
    }
    drawNfa(svg, engine.nfa, active);
  }

  function renderAll(): void {
    renderStats();
    renderBanner();
    renderTrace();
    renderDfaTable();
    renderGraph();
    const input = inputField.value;
    if (engine.nfa && input !== '') {
      const nfaRes = simulate(engine.nfa, input);
      const dfaRes = dfaSimulate(engine.dfa!, input);
      verdict.textContent = `NFA: ${nfaRes.accepted ? 'match' : 'no match'} | DFA: ${dfaRes.accepted ? 'match' : 'no match'}`;
      verdict.className = 'verdict mono ' + (nfaRes.accepted === dfaRes.accepted ? (nfaRes.accepted ? 'yes' : 'no') : 'mismatch');
    } else {
      verdict.textContent = '';
    }
  }

  function rebuild(): void {
    engine = compile(patternInput.value);
    renderAll();
  }

  // -- wiring ----------------------------------------------------------------

  let debounce: number | undefined;
  patternInput.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = window.setTimeout(rebuild, 250);
  });
  inputField.addEventListener('input', renderAll);

  rebuild();
}
