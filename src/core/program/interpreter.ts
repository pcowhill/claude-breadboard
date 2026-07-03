import { DIGIT_SEGMENTS, type Expr, type Program, type Stmt } from './ast';

// Cooperative interpreter. Each hat block becomes a thread (generator).
// A thread yields once per simulated millisecond tick at loop boundaries and
// waits, so infinite `forever` loops can never lock up the browser.

export interface ProgramIO {
  pinWrite(pin: number, value: 0 | 1): void;
  pinPwm(pin: number, duty: number): void;
  pinToggle(pin: number): void;
  pinRead(pin: number): 0 | 1;
  analogRead(index: number): number;
  print(line: string): void;
  highlightPin(pin: number): void;
  setProbeLabel(text: string): void;
  now(): number; // sim ms
}

type Value = number | string | boolean;

interface Thread {
  gen: Generator<void, void, void>;
  wakeAt: number;
  done: boolean;
}

export class Interpreter {
  private threads: Thread[] = [];
  private vars = new Map<string, Value>();
  running = false;
  /** total statements executed (rough activity metric for the UI) */
  steps = 0;

  constructor(private io: ProgramIO) {}

  start(program: Program) {
    this.stop();
    this.vars.clear();
    this.running = true;
    for (const script of program.scripts) {
      const self = this;
      const gen = (function* () {
        yield* self.execBody(script.body, { wakeAt: 0 } as Thread);
      })();
      this.threads.push({ gen, wakeAt: 0, done: false });
    }
  }

  stop() {
    this.threads = [];
    this.running = false;
  }

  get finished(): boolean {
    return this.running && this.threads.every((t) => t.done);
  }

  getVars(): ReadonlyMap<string, Value> {
    return this.vars;
  }

  /** advance every runnable thread by one slice (call once per sim tick) */
  tick() {
    if (!this.running) return;
    const now = this.io.now();
    for (const t of this.threads) {
      if (t.done || now < t.wakeAt) continue;
      this.currentThread = t;
      try {
        const r = t.gen.next();
        if (r.done) t.done = true;
      } catch (err) {
        this.io.print(`⚠ program error: ${err instanceof Error ? err.message : String(err)}`);
        t.done = true;
      }
    }
    this.currentThread = null;
  }

  private currentThread: Thread | null = null;

  private *execBody(body: Stmt[], _t: Thread): Generator<void, void, void> {
    for (const s of body) yield* this.execStmt(s);
  }

  private *execStmt(s: Stmt): Generator<void, void, void> {
    this.steps++;
    switch (s.k) {
      case 'setDigital':
        this.io.pinWrite(s.pin, this.truthy(this.evalExpr(s.value)) ? 1 : 0);
        return;
      case 'toggleDigital':
        this.io.pinToggle(s.pin);
        return;
      case 'setPwm':
        this.io.pinPwm(s.pin, this.num(this.evalExpr(s.duty)));
        return;
      case 'wait': {
        const ms = Math.max(0, this.num(this.evalExpr(s.ms)));
        this.currentThread!.wakeAt = this.io.now() + ms;
        yield;
        return;
      }
      case 'forever':
        for (;;) {
          yield* this.execBody(s.body, this.currentThread!);
          yield; // one tick per iteration, guarantees progress
        }
      case 'repeat': {
        const n = Math.min(1_000_000, Math.max(0, Math.floor(this.num(this.evalExpr(s.times)))));
        for (let i = 0; i < n; i++) {
          yield* this.execBody(s.body, this.currentThread!);
          yield;
        }
        return;
      }
      case 'if':
        if (this.truthy(this.evalExpr(s.cond))) yield* this.execBody(s.then, this.currentThread!);
        else if (s.else) yield* this.execBody(s.else, this.currentThread!);
        return;
      case 'setVar':
        this.vars.set(s.name, this.evalExpr(s.value));
        return;
      case 'changeVar': {
        const cur = this.vars.get(s.name);
        this.vars.set(s.name, this.num(cur ?? 0) + this.num(this.evalExpr(s.by)));
        return;
      }
      case 'print': {
        const v = this.evalExpr(s.value);
        this.io.print(typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v));
        return;
      }
      case 'shiftOut':
        yield* this.doShiftOut(this.num(this.evalExpr(s.value)) & 0xff, s.data, s.clock, s.latch, true);
        return;
      case 'displayDigit': {
        const d = Math.abs(Math.floor(this.num(this.evalExpr(s.digit)))) % 10;
        yield* this.doShiftOut(DIGIT_SEGMENTS[d], s.data, s.clock, s.latch, true);
        return;
      }
      case 'pulse':
        this.io.pinWrite(s.pin, 1);
        yield;
        yield;
        this.io.pinWrite(s.pin, 0);
        yield;
        return;
      case 'highlightPin':
        this.io.highlightPin(s.pin);
        return;
      case 'probeLabel':
        this.io.setProbeLabel(s.text);
        return;
      default: {
        const never: never = s;
        throw new Error(`unknown stmt ${(never as { k: string }).k}`);
      }
    }
  }

  /**
   * Bit-bang a byte MSB-first into a 74HC595. Yields between edges so the
   * simulated shift register actually sees each clock edge. In the 595 the
   * first bit shifted ends up at QH, so MSB-first puts byte bit 7 on QH and
   * bit 0 on QA.
   */
  private *doShiftOut(byte: number, data: number, clock: number, latch: number, doLatch: boolean): Generator<void, void, void> {
    if (doLatch) {
      this.io.pinWrite(latch, 0);
      yield;
    }
    for (let bit = 7; bit >= 0; bit--) {
      this.io.pinWrite(data, ((byte >> bit) & 1) as 0 | 1);
      this.io.pinWrite(clock, 0);
      yield;
      this.io.pinWrite(clock, 1);
      yield;
    }
    this.io.pinWrite(clock, 0);
    yield;
    if (doLatch) {
      this.io.pinWrite(latch, 1);
      yield;
      this.io.pinWrite(latch, 0);
      yield;
    }
  }

  private evalExpr(e: Expr): Value {
    switch (e.k) {
      case 'num':
        return e.v;
      case 'str':
        return e.v;
      case 'bool':
        return e.v;
      case 'var':
        return this.vars.get(e.name) ?? 0;
      case 'readDigital':
        return this.io.pinRead(e.pin) === 1;
      case 'readAnalog':
        return this.io.analogRead(e.pin);
      case 'not':
        return !this.truthy(this.evalExpr(e.a));
      case 'map': {
        const x = this.num(this.evalExpr(e.x));
        const a = this.num(this.evalExpr(e.a));
        const b = this.num(this.evalExpr(e.b));
        const c = this.num(this.evalExpr(e.c));
        const d = this.num(this.evalExpr(e.d));
        if (b === a) return c;
        return Math.round(c + ((x - a) * (d - c)) / (b - a));
      }
      case 'binop': {
        const av = this.evalExpr(e.a);
        const bv = this.evalExpr(e.b);
        switch (e.op) {
          case '+':
            return this.num(av) + this.num(bv);
          case '-':
            return this.num(av) - this.num(bv);
          case '*':
            return this.num(av) * this.num(bv);
          case '/': {
            const d = this.num(bv);
            return d === 0 ? 0 : this.num(av) / d;
          }
          case '==':
            return this.looseEq(av, bv);
          case '!=':
            return !this.looseEq(av, bv);
          case '<':
            return this.num(av) < this.num(bv);
          case '>':
            return this.num(av) > this.num(bv);
          case '<=':
            return this.num(av) <= this.num(bv);
          case '>=':
            return this.num(av) >= this.num(bv);
          case 'and':
            return this.truthy(av) && this.truthy(bv);
          case 'or':
            return this.truthy(av) || this.truthy(bv);
        }
      }
    }
  }

  private looseEq(a: Value, b: Value): boolean {
    if (typeof a === 'number' || typeof b === 'number') return this.num(a) === this.num(b);
    return a === b;
  }

  private num(v: Value): number {
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  private truthy(v: Value): boolean {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    return v.length > 0;
  }
}
