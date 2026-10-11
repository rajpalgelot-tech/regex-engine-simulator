# Regex Guide

A short guide to [Regex](https://rajpalgelot-tech.github.io/regex-engine-simulator/), where you can watch a pattern turn into a machine. No theory background needed; if you have ever typed `*` in a search box, you can run every experiment here.

## Why is this useful?

Regular expressions feel like magic incantations until you see the machine that runs them. Every regex is secretly a flow diagram: circles (states) and arrows (what characters move you between them). Once you have watched a pattern get built into that diagram and pushed a word through it one letter at a time, regex stops being a mysterious string language and starts being what it really is: a tiny drawing of a machine. If you are a student, this is the classic compilers-course exercise, and being able to explain Thompson's construction and the subset construction from memory is a solid interview moment.

## What is a regex engine, in really simple words?

1. **The pattern becomes a map.** The engine reads your pattern and draws a map of states connected by arrows. An arrow labeled `a` means "if the next letter is a, walk this arrow". Dashed arrows labeled with a tiny epsilon cost nothing; you may walk them for free. A star draws a loop so you can go around again.
2. **Matching is walking the map in parallel.** Instead of guessing one path and backtracking, the engine keeps a list of every state it could possibly be in, and after each letter of your input, it moves all of them at once. If, after the last letter, the accept state (the double circle) is on the list, the pattern matches.
3. **The DFA is the same map, pre-merged.** Sets of parallel NFA states get fused into single named states (A, B, C...), producing a machine with exactly one possible move per letter. Same answers, simpler machine, one column per distinct symbol in the table.

## Quick start

Open [the demo](https://rajpalgelot-tech.github.io/regex-engine-simulator/). The classic pattern `(a|b)*abb` is loaded. Type `aabb` into the test input: the banner turns green, the glowing states in the graph show where the machine ended up, and the trace lists the parallel state set after every letter. Now type `abba` and watch the set die.

## The buttons

| Control | What it does |
| --- | --- |
| Pattern input | Rebuilds the NFA graph and DFA table as you type |
| Test input | Runs your text through both engines and reports the verdict |
| Example chips | Six classic patterns, one click each |
| NFA graph | The state map; green glow shows the states alive after your input |
| Match trace | The state set after each character, in order |
| DFA table | The merged machine: named states, their NFA sets, transitions |

## Three experiments

1. **The dragon book classic.** `(a|b)*abb` with input `aabb`: watch state 13 join the set at the last letter. Then try `aabb` with one letter removed and watch the trace end in "dead (stuck)".
2. **Shrink the machine.** Compare the "NFA states" and "DFA states" chips across patterns. `[a-z]+\.(com|org)` builds a big NFA (lots of class edges) but the DFA stays small. The table's "NFA set" column shows the fusing.
3. **Meet the parser's taste.** Type `(ab` and read the error position. Type `*a` and learn why a star needs something in front of it. The parser never crashes; it just tells you where it got confused.

## Reading the trace

- `start` is the set of states reachable before consuming anything (epsilon closure of the start).
- Each row shows the set after one character; the last row is highlighted.
- `dead (stuck)` means the empty set: no path through the map can consume that letter, so the match is already impossible.
- The graph glows with exactly the states in the last row.

## Questions people ask

**Why epsilon arrows?** They are the glue that lets small pieces compose: alternation forks with free arrows, a star loops with a free arrow. The machine never consumes input on them, so they only ever add states to the parallel set.

**Is the DFA faster?** Per character, yes: exactly one lookup instead of fanning out across a set. That is why real regex libraries compile to DFAs (or DFA-like machines) before matching. This project shows both engines agreeing on every input.

**Why must the whole input match?** Anchored matching keeps the story clean: the verdict is about the map, not about searching inside text. Substring search is just a small addition (restart the machine at every position) that would clutter the picture.

**What is missing from the syntax?** Captures, anchors, counted repetition like `{2,4}`, and lookahead. They are features of practical engines, not of the core theory this project teaches.
