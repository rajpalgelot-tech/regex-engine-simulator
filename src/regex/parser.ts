// A recursive-descent parser for a classic regex subset: literals, ., character
// classes [a-z0-9^], groups, alternation |, and the postfix quantifiers * + ?.
// Everything is parsed into an AST; the NFA builder walks it later.

export type Ast =
  | { kind: 'empty' }
  | { kind: 'char'; ch: string }
  | { kind: 'any' }
  | { kind: 'class'; negated: boolean; items: ClassItem[] }
  | { kind: 'star'; node: Ast }
  | { kind: 'plus'; node: Ast }
  | { kind: 'opt'; node: Ast }
  | { kind: 'concat'; parts: Ast[] }
  | { kind: 'alt'; options: Ast[] };

export interface ClassItem {
  from: string; // single char when to === from
  to: string;
}

export type ParseResult =
  | { ok: true; ast: Ast }
  | { ok: false; errors: string[] };

class Parser {
  private pos = 0;
  errors: string[] = [];

  constructor(private src: string) {}

  parse(): Ast {
    const node = this.parseAlt();
    if (this.pos < this.src.length) {
      this.errors.push(`position ${this.pos + 1}: unexpected "${this.src[this.pos]}"`);
    }
    return node;
  }

  private peek(): string {
    return this.src[this.pos] ?? '';
  }

  private parseAlt(): Ast {
    const options: Ast[] = [this.parseConcat()];
    while (this.peek() === '|') {
      this.pos++;
      options.push(this.parseConcat());
    }
    return options.length === 1 ? options[0] : { kind: 'alt', options };
  }

  private parseConcat(): Ast {
    const parts: Ast[] = [];
    while (this.pos < this.src.length && this.peek() !== '|' && this.peek() !== ')') {
      parts.push(this.parseRepeat());
    }
    if (parts.length === 0) return { kind: 'empty' };
    return parts.length === 1 ? parts[0] : { kind: 'concat', parts };
  }

  private parseRepeat(): Ast {
    let node = this.parseAtom();
    for (;;) {
      const c = this.peek();
      if (c === '*') { this.pos++; node = { kind: 'star', node }; }
      else if (c === '+') { this.pos++; node = { kind: 'plus', node }; }
      else if (c === '?') { this.pos++; node = { kind: 'opt', node }; }
      else break;
    }
    return node;
  }

  private parseAtom(): Ast {
    const start = this.pos;
    const c = this.peek();
    if (c === '') return { kind: 'empty' };
    if (c === '(') {
      this.pos++;
      const inner = this.parseAlt();
      if (this.peek() === ')') {
        this.pos++;
        return inner;
      }
      this.errors.push(`position ${start + 1}: unclosed "("`);
      return inner;
    }
    if (c === ')') {
      this.errors.push(`position ${this.pos + 1}: unmatched ")"`);
      this.pos++;
      return { kind: 'empty' };
    }
    if (c === '*') {
      this.errors.push(`position ${this.pos + 1}: "*" has nothing to repeat`);
      this.pos++;
      return { kind: 'empty' };
    }
    if (c === '+' || c === '?') {
      this.errors.push(`position ${this.pos + 1}: "${c}" has nothing to repeat`);
      this.pos++;
      return { kind: 'empty' };
    }
    if (c === '[') return this.parseClass();
    if (c === '.') { this.pos++; return { kind: 'any' }; }
    if (c === '\\') {
      this.pos++;
      const esc = this.peek();
      if (esc === '') {
        this.errors.push(`position ${this.pos}: "\\" at the end of the pattern`);
        return { kind: 'empty' };
      }
      this.pos++;
      return { kind: 'char', ch: esc };
    }
    if (c === '|' || c === ')') return { kind: 'empty' };
    this.pos++;
    return { kind: 'char', ch: c };
  }

  private parseClass(): Ast {
    const start = this.pos;
    this.pos++; // consume [
    const items: ClassItem[] = [];
    let negated = false;
    if (this.peek() === '^') {
      negated = true;
      this.pos++;
    }
    let first = true;
    for (;;) {
      const c = this.peek();
      if (c === '') {
        this.errors.push(`position ${start + 1}: unclosed "["`);
        break;
      }
      if (c === ']' && !first) {
        this.pos++;
        break;
      }
      // a leading ] inside a class is a literal, classic POSIX behavior
      this.pos++;
      first = false;
      if (this.peek() === '-' && this.src[this.pos + 1] !== ']' && this.src[this.pos + 1] !== '') {
        this.pos++;
        const hi = this.peek();
        this.pos++;
        if (hi.charCodeAt(0) < c.charCodeAt(0)) {
          this.errors.push(`position ${start + 1}: range "${c}-${hi}" is backwards`);
        } else {
          items.push({ from: c, to: hi });
        }
      } else {
        items.push({ from: c, to: c });
      }
    }
    return { kind: 'class', negated, items };
  }
}

// What a transition edge accepts, kept in a normalized form so NFA and DFA
// can compare predicates by value.
export type CharTest = {
  kind: 'char';
  ch: string;
} | {
  kind: 'any';
} | {
  kind: 'class';
  negated: boolean;
  items: ClassItem[];
}

export function parse(pattern: string): ParseResult {
  if (pattern.trim() === '') return { ok: false, errors: ['type a pattern first'] };
  const p = new Parser(pattern);
  const ast = p.parse();
  if (p.errors.length > 0) return { ok: false, errors: p.errors };
  return { ok: true, ast };
}

export function testMatches(t: CharTest, ch: string): boolean {
  switch (t.kind) {
    case 'char': return ch === t.ch;
    case 'any': return true;
    case 'class': {
      let inside = t.items.some((i) => ch >= i.from && ch <= i.to);
      return t.negated ? !inside : inside;
    }
  }
}

export function testEquals(a: CharTest, b: CharTest): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'char' && b.kind === 'char') return a.ch === b.ch;
  if (a.kind === 'any' && b.kind === 'any') return true;
  if (a.kind === 'class' && b.kind === 'class') {
    return a.negated === b.negated && JSON.stringify(a.items) === JSON.stringify(b.items);
  }
  return false;
}

export function testLabel(t: CharTest): string {
  switch (t.kind) {
    case 'char': return t.ch;
    case 'any': return 'any';
    case 'class': {
      const body = t.items
        .map((i) => (i.from === i.to ? i.from : `${i.from}-${i.to}`))
        .join('');
      return t.negated ? `[^${body}]` : `[${body}]`;
    }
  }
}
