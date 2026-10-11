import { type CharTest, testEquals, testLabel } from './parser';
import { epsilonClosure, startStates, type Nfa } from './nfa';

// Subset construction: turn the NFA into a DFA whose states are sets of NFA
// states. DFA states get friendly names (A, B, C...) for the transition table.

export interface DfaState {
  name: string;
  nfaStates: number[];
  accepting: boolean;
}

export interface Dfa {
  states: DfaState[];
  start: number; // index into states
  // transitions[fromIndex][symbolIndex] = toIndex
  transitions: number[][];
  symbols: CharTest[]; // the distinct edge predicates, sorted by label
}

const NAME_POOL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function buildDfa(nfa: Nfa): Dfa {
  // collect the distinct predicates so the table has one column per symbol
  const symbols: CharTest[] = [];
  for (const e of nfa.edges) {
    const t = e.test;
    if (t !== null && !symbols.some((s) => testEquals(s, t))) {
      symbols.push(t);
    }
  }
  symbols.sort((a, b) => testLabel(a).localeCompare(testLabel(b)));

  const start = startStates(nfa);
  const keyOf = (set: Set<number>): string => [...set].sort((a, b) => a - b).join(',');

  const sets: Set<number>[] = [];
  const keys = new Map<string, number>();
  const transitions: number[][] = [];
  const accepting: boolean[] = [];

  const key = keyOf(start);
  keys.set(key, 0);
  sets.push(start);
  accepting.push(start.has(nfa.accept));

  // worklist of unexplored DFA states
  for (let i = 0; i < sets.length; i++) {
    const row: number[] = [];
    for (const sym of symbols) {
      // move on this predicate, then close over epsilon edges
      const moved = new Set<number>();
      for (const e of nfa.edges) {
        if (e.test !== null && testEquals(e.test, sym) && sets[i].has(e.from)) {
          moved.add(e.to);
        }
      }
      const target = epsilonClosure(nfa, moved);
      const tk = keyOf(target);
      let ti = keys.get(tk);
      if (ti === undefined) {
        ti = sets.length;
        keys.set(tk, ti);
        sets.push(target);
        accepting.push(target.has(nfa.accept));
      }
      row.push(ti);
    }
    transitions.push(row);
  }

  const states: DfaState[] = sets.map((set, i) => ({
    name: NAME_POOL[i] ?? `S${i}`,
    nfaStates: [...set].sort((a, b) => a - b),
    accepting: accepting[i],
  }));

  return { states, start: 0, transitions, symbols };
}

// Runs the DFA over the input; used by the UI to show both engines agreeing.
export function dfaSimulate(dfa: Dfa, input: string): { accepted: boolean; path: number[] } {
  let state = dfa.start;
  const path = [state];
  for (const ch of input) {
    const symIndex = dfa.symbols.findIndex((s) => {
      if (s.kind === 'char') return ch === s.ch;
      if (s.kind === 'any') return true;
      const inside = s.items.some((i) => ch >= i.from && ch <= i.to);
      return s.negated ? !inside : inside;
    });
    if (symIndex === -1) return { accepted: false, path };
    state = dfa.transitions[state][symIndex];
    path.push(state);
  }
  return { accepted: dfa.states[state].accepting, path };
}
