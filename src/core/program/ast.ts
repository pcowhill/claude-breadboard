// Constrained internal behaviour model that block programs compile into.
// This is deliberately NOT a general-purpose language: no unbounded loops
// other than `forever` (which yields every iteration), no function calls.

export type Expr =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'bool'; v: boolean }
  | { k: 'var'; name: string }
  | { k: 'readDigital'; pin: number }
  | { k: 'readAnalog'; pin: number }
  | { k: 'binop'; op: BinOp; a: Expr; b: Expr }
  | { k: 'not'; a: Expr }
  | { k: 'map'; x: Expr; a: Expr; b: Expr; c: Expr; d: Expr };

export type BinOp = '+' | '-' | '*' | '/' | '==' | '!=' | '<' | '>' | '<=' | '>=' | 'and' | 'or';

export type Stmt =
  | { k: 'setDigital'; pin: number; value: Expr }
  | { k: 'toggleDigital'; pin: number }
  | { k: 'setPwm'; pin: number; duty: Expr }
  | { k: 'wait'; ms: Expr }
  | { k: 'forever'; body: Stmt[] }
  | { k: 'repeat'; times: Expr; body: Stmt[] }
  | { k: 'if'; cond: Expr; then: Stmt[]; else?: Stmt[] }
  | { k: 'setVar'; name: string; value: Expr }
  | { k: 'changeVar'; name: string; by: Expr }
  | { k: 'print'; value: Expr }
  | { k: 'shiftOut'; value: Expr; data: number; clock: number; latch: number }
  | { k: 'displayDigit'; digit: Expr; data: number; clock: number; latch: number }
  | { k: 'pulse'; pin: number }
  | { k: 'highlightPin'; pin: number }
  | { k: 'probeLabel'; text: string };

export interface Script {
  body: Stmt[];
}

export interface Program {
  scripts: Script[];
}

/** Segment patterns for 0-9 (bit0 = a … bit6 = g, bit7 = dp). */
export const DIGIT_SEGMENTS = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f];

export function collectUsedPins(p: Program): { digital: Set<number>; analog: Set<number> } {
  const digital = new Set<number>();
  const analog = new Set<number>();
  const expr = (e: Expr | undefined) => {
    if (!e) return;
    switch (e.k) {
      case 'readDigital':
        digital.add(e.pin);
        break;
      case 'readAnalog':
        analog.add(e.pin);
        break;
      case 'binop':
        expr(e.a);
        expr(e.b);
        break;
      case 'not':
        expr(e.a);
        break;
      case 'map':
        expr(e.x);
        expr(e.a);
        expr(e.b);
        expr(e.c);
        expr(e.d);
        break;
      default:
        break;
    }
  };
  const stmt = (s: Stmt) => {
    switch (s.k) {
      case 'setDigital':
        digital.add(s.pin);
        expr(s.value);
        break;
      case 'toggleDigital':
      case 'pulse':
      case 'highlightPin':
        digital.add(s.pin);
        break;
      case 'setPwm':
        digital.add(s.pin);
        expr(s.duty);
        break;
      case 'wait':
        expr(s.ms);
        break;
      case 'forever':
        s.body.forEach(stmt);
        break;
      case 'repeat':
        expr(s.times);
        s.body.forEach(stmt);
        break;
      case 'if':
        expr(s.cond);
        s.then.forEach(stmt);
        s.else?.forEach(stmt);
        break;
      case 'setVar':
        expr(s.value);
        break;
      case 'changeVar':
        expr(s.by);
        break;
      case 'print':
        expr(s.value);
        break;
      case 'shiftOut':
        expr(s.value);
        digital.add(s.data);
        digital.add(s.clock);
        digital.add(s.latch);
        break;
      case 'displayDigit':
        expr(s.digit);
        digital.add(s.data);
        digital.add(s.clock);
        digital.add(s.latch);
        break;
      default:
        break;
    }
  };
  for (const sc of p.scripts) sc.body.forEach(stmt);
  return { digital, analog };
}
