import { type Ast, type CharTest, testMatches } from './parser';

// Thompson's construction: every AST node becomes a fragment with one start
// and one accept state, glued together with epsilon edges. States are plain
// numbers; edge 0 of every fragment list is the start.

export interface NfaEdge {
  from: number;
  to: number;
  test: CharTest | null; // null means epsilon
}

export interface Nfa {
  stateCount: number;
  start: number;
  accept: number;
  edges: NfaEdge[];
}

interface Fragment {
  start: number;
  accept: number;
}

export function buildNfa(ast: Ast): Nfa {
  const edges: NfaEdge[] = [];
  let next = 0;

  const newState = (): number => next++;

  const edge = (from: number, to: number, test: CharTest | null): void => {
    edges.push({ from, to, test });
  };

  const build = (node: Ast): Fragment => {
    switch (node.kind) {
      case 'empty': {
        const s = newState();
        return { start: s, accept: s };
      }
      case 'char': {
        const s = newState();
        const e = newState();
        edge(s, e, { kind: 'char', ch: node.ch });
        return { start: s, accept: e };
      }
      case 'any': {
        const s = newState();
        const e = newState();
        edge(s, e, { kind: 'any' });
        return { start: s, accept: e };
      }
      case 'class': {
        const s = newState();
        const e = newState();
        edge(s, e, { kind: 'class', negated: node.negated, items: node.items });
        return { start: s, accept: e };
      }
      case 'concat': {
        let left = build(node.parts[0]);
        for (let i = 1; i < node.parts.length; i++) {
          const right = build(node.parts[i]);
          edge(left.accept, right.start, null);
          left = { start: left.start, accept: right.accept };
        }
        return left;
      }
      case 'alt': {
        const s = newState();
        const e = newState();
        const frags = node.options.map(build);
        for (const f of frags) {
          edge(s, f.start, null);
          edge(f.accept, e, null);
        }
        return { start: s, accept: e };
      }
      case 'star': {
        const s = newState();
        const e = newState();
        const inner = build(node.node);
        edge(s, inner.start, null);
        edge(inner.accept, e, null);
        edge(s, e, null); // skip it entirely
        edge(inner.accept, inner.start, null); // go around again
        return { start: s, accept: e };
      }
      case 'plus': {
        const s = newState();
        const e = newState();
        const inner = build(node.node);
        edge(s, inner.start, null);
        edge(inner.accept, e, null);
        edge(inner.accept, inner.start, null); // at least once, then repeat
        return { start: s, accept: e };
      }
      case 'opt': {
        const s = newState();
        const e = newState();
        const inner = build(node.node);
        edge(s, inner.start, null);
        edge(inner.accept, e, null);
        edge(s, e, null); // or skip it
        return { start: s, accept: e };
      }
    }
  };

  const frag = build(ast);
  return { stateCount: next, start: frag.start, accept: frag.accept, edges };
}

// Every state reachable from `from` without consuming a character.
export function epsilonClosure(nfa: Nfa, from: Iterable<number>): Set<number> {
  const seen = new Set<number>(from);
  const stack = [...seen];
  while (stack.length > 0) {
    const s = stack.pop()!;
    for (const e of nfa.edges) {
      if (e.from === s && e.test === null && !seen.has(e.to)) {
        seen.add(e.to);
        stack.push(e.to);
      }
    }
  }
  return seen;
}

// One simulation step on a single character.
export function move(nfa: Nfa, states: Set<number>, ch: string): Set<number> {
  const reached = new Set<number>();
  for (const e of nfa.edges) {
    if (e.test !== null && states.has(e.from) && testMatches(e.test, ch)) {
      reached.add(e.to);
    }
  }
  return epsilonClosure(nfa, reached);
}

export function startStates(nfa: Nfa): Set<number> {
  return epsilonClosure(nfa, [nfa.start]);
}

export interface MatchResult {
  accepted: boolean;
  steps: { ch: string; states: Set<number> }[]; // one entry per input character
}

// Runs the NFA the way the textbook does: a set of parallel states, one step
// per character. Returns the state set after each character for the UI.
export function simulate(nfa: Nfa, input: string): MatchResult {
  let states = startStates(nfa);
  const steps: { ch: string; states: Set<number> }[] = [];
  for (const ch of input) {
    states = move(nfa, states, ch);
    steps.push({ ch, states: new Set(states) });
  }
  return { accepted: states.has(nfa.accept), steps };
}
