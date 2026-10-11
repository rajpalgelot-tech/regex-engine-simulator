import { describe, expect, it } from 'vitest';
import { parse, testLabel } from '../src/regex/parser';
import { buildNfa, epsilonClosure, simulate, startStates } from '../src/regex/nfa';
import { buildDfa, dfaSimulate } from '../src/regex/dfa';

function nfaFor(pattern: string) {
  const res = parse(pattern);
  if (!res.ok) throw new Error(res.errors.join('; '));
  return buildNfa(res.ast);
}

function accept(pattern: string, input: string): boolean {
  return simulate(nfaFor(pattern), input).accepted;
}

// -- parser -----------------------------------------------------------------

describe('parser', () => {
  it('reports useful errors with positions', () => {
    expect(parse('(ab').ok).toBe(false);
    expect(parse('ab)').ok).toBe(false);
    expect(parse('a[bc').ok).toBe(false);
    expect(parse('*a').ok).toBe(false);
    expect(parse('a\\').ok).toBe(false);
    expect(parse('a[z-a]').ok).toBe(false);
    expect(parse('').ok).toBe(false);
    const bad = parse('(ab');
    if (!bad.ok) expect(bad.errors[0]).toContain('unclosed');
  });

  it('accepts the whole supported syntax', () => {
    for (const p of ['a', 'ab', 'a*', 'a+', 'a?', 'a|b', '(a|b)*c', '[a-z0-9]+', '[^abc]', 'a\\.b', '.', '((x))']) {
      expect(parse(p).ok).toBe(true);
    }
  });

  it('labels predicates readably', () => {
    const res = parse('[a-cx]');
    expect(res.ok).toBe(true);
    if (res.ok && res.ast.kind === 'class') {
      expect(res.ast.items).toEqual([{ from: 'a', to: 'c' }, { from: 'x', to: 'x' }]);
    }
  });
});

// -- matching ------------------------------------------------------------------

describe('matching', () => {
  it('matches literals and concatenation', () => {
    expect(accept('abc', 'abc')).toBe(true);
    expect(accept('abc', 'ab')).toBe(false);
    expect(accept('abc', 'abcd')).toBe(false);
  });

  it('handles the empty string', () => {
    expect(accept('a*', '')).toBe(true);
    expect(accept('a+', '')).toBe(false);
    expect(accept('a?', '')).toBe(true);
    expect(accept('a|', '')).toBe(true); // empty right alternative
  });

  it('implements star, plus, and question', () => {
    expect(accept('a*b', 'b')).toBe(true);
    expect(accept('a*b', 'aaab')).toBe(true);
    expect(accept('a*b', 'ba')).toBe(false);
    expect(accept('ab+c', 'abc')).toBe(true);
    expect(accept('ab+c', 'ac')).toBe(false);
    expect(accept('colou?r', 'color')).toBe(true);
    expect(accept('colou?r', 'colour')).toBe(true);
    expect(accept('colou?r', 'colouur')).toBe(false);
  });

  it('implements alternation, including empty branches', () => {
    expect(accept('cat|dog', 'cat')).toBe(true);
    expect(accept('cat|dog', 'dog')).toBe(true);
    expect(accept('cat|dog', 'cow')).toBe(false);
    expect(accept('(a|b|c)+', 'abcab')).toBe(true);
    expect(accept('(a|b|c)+', 'abd')).toBe(false);
  });

  it('implements character classes and negation', () => {
    expect(accept('[abc]+', 'cabba')).toBe(true);
    expect(accept('[abc]+', 'cabbad')).toBe(false);
    expect(accept('[a-z]+', 'hello')).toBe(true);
    expect(accept('[a-z]+', 'hello5')).toBe(false);
    expect(accept('[^abc]', 'd')).toBe(true);
    expect(accept('[^abc]', 'a')).toBe(false);
    expect(accept('[a-cx]', 'x')).toBe(true);
    expect(accept('[a-cx]', 'd')).toBe(false);
  });

  it('makes the dot match exactly one character', () => {
    expect(accept('a.c', 'abc')).toBe(true);
    expect(accept('a.c', 'a.c')).toBe(true);
    expect(accept('a.c', 'ac')).toBe(false);
    expect(accept('a.c', 'abbc')).toBe(false);
  });

  it('treats escaped characters as literals', () => {
    expect(accept('a\\.b', 'a.b')).toBe(true);
    expect(accept('a\\.b', 'axb')).toBe(false);
    expect(accept('\\*\\+', '*+')).toBe(true);
    expect(accept('\\(\\)', '()')).toBe(true);
  });

  it('anchors implicitly at both ends', () => {
    // the whole input must be consumed, like a anchored regex
    expect(accept('abc', 'xabcx')).toBe(false);
    expect(accept('a|ab', 'ab')).toBe(true);
  });

  it('handles nested groups and quantifiers', () => {
    expect(accept('((a|b)c)*', 'acbcac')).toBe(true);
    expect(accept('((a|b)c)*', 'acd')).toBe(false);
    expect(accept('(a+)+b', 'aaab')).toBe(true);
    expect(accept('(a+)+b', 'b')).toBe(false); // a+ needs at least one a
    expect(accept('(a*)+b', 'b')).toBe(true); // a* can be empty, so can the group
    expect(accept('(a+)+b', 'aaa')).toBe(false);
  });

  it('returns one trace step per character', () => {
    const nfa = nfaFor('a*b');
    const res = simulate(nfa, 'aab');
    expect(res.steps).toHaveLength(3);
    expect(res.steps.map((s) => s.ch)).toEqual(['a', 'a', 'b']);
  });
});

// -- NFA construction ------------------------------------------------------------

describe('NFA construction', () => {
  it('builds distinct fragments per construct', () => {
    const nfa = nfaFor('a');
    expect(nfa.stateCount).toBe(2);
    expect(nfa.edges).toHaveLength(1);

    const star = nfaFor('a*');
    // star adds two glue states and four epsilon edges around the char edge
    expect(star.stateCount).toBe(nfa.stateCount + 2);
    expect(star.edges.filter((e) => e.test === null)).toHaveLength(4);
  });

  it('computes epsilon closures across chains', () => {
    const nfa = nfaFor('a|');
    const start = startStates(nfa);
    // the empty alternative connects the start straight to the accept state
    expect(start.has(nfa.accept)).toBe(true);
  });

  it('keeps closure idempotent', () => {
    const nfa = nfaFor('(ab)*');
    const s = startStates(nfa);
    expect(epsilonClosure(nfa, s)).toEqual(s);
  });
});

// -- DFA -----------------------------------------------------------------------

describe('DFA subset construction', () => {
  it('agrees with the NFA on every case', () => {
    const cases: [string, string[], string[]][] = [
      ['(a|b)*abb', ['aabb', 'babb', 'abb', 'aaababb'], ['', 'ab', 'abba', 'bb']],
      ['[a-z]+[0-9]*', ['hello', 'abc123', 'z9'], ['', '123', 'HELLO', 'abc 12']],
      ['a?b+', ['bb', 'abb', 'b'], ['', 'a', 'ba', 'aab']],
    ];
    for (const [pattern, yes, no] of cases) {
      const nfa = nfaFor(pattern);
      const dfa = buildDfa(nfa);
      for (const input of yes) {
        expect(simulate(nfa, input).accepted).toBe(true);
        expect(dfaSimulate(dfa, input).accepted).toBe(true);
      }
      for (const input of no) {
        expect(simulate(nfa, input).accepted).toBe(false);
        expect(dfaSimulate(dfa, input).accepted).toBe(false);
      }
    }
  });

  it('names states with letters and marks accepting ones', () => {
    const dfa = buildDfa(nfaFor('(a|b)*abb'));
    expect(dfa.states[0].name).toBe('A');
    expect(dfa.states[0].nfaStates).toContain(0);
    expect(dfa.states.some((s) => s.accepting)).toBe(true);
  });

  it('is deterministic: same pattern, same DFA', () => {
    const a = buildDfa(nfaFor('(a|b)*abb'));
    const b = buildDfa(nfaFor('(a|b)*abb'));
    expect(a.states.map((s) => s.nfaStates)).toEqual(b.states.map((s) => s.nfaStates));
    expect(a.transitions).toEqual(b.transitions);
  });

  it('produces one column per distinct predicate', () => {
    const dfa = buildDfa(nfaFor('[ab]c|[ab]d'));
    expect(dfa.symbols).toHaveLength(3); // [ab], c, d
    expect(dfa.symbols.map(testLabel)).toEqual(['[ab]', 'c', 'd']);
  });

  it('follows the dragon book example shape', () => {
    // (a|b)*abb is the classic teaching example. Thompson's construction,
    // without hand optimizations, gives 14 NFA states; the subset construction
    // folds them into a much smaller deterministic machine.
    const nfa = nfaFor('(a|b)*abb');
    const dfa = buildDfa(nfa);
    expect(nfa.stateCount).toBe(14);
    expect(dfa.states.length).toBeLessThan(nfa.stateCount);
    expect(dfaSimulate(dfa, 'aabb').accepted).toBe(true);
  });
});
