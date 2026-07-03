import * as Blockly from 'blockly';
import type { Expr, Program, Stmt } from './ast';

// Walks a Blockly workspace and produces the internal AST. Unknown or
// unplugged inputs degrade to safe defaults and are reported, never thrown.

export interface CompileResult {
  program: Program;
  warnings: string[];
}

export function compileWorkspace(ws: Blockly.Workspace): CompileResult {
  const warnings: string[] = [];
  const program: Program = { scripts: [] };

  const tops = ws.getTopBlocks(true);
  let loose = 0;
  let disabled = 0;
  for (const top of tops) {
    if (top.type === 'event_start') {
      if (!top.isEnabled()) {
        disabled++;
        continue;
      }
      const body = stmtChain(top.getNextBlock(), warnings);
      program.scripts.push({ body });
    } else if (!top.isInsertionMarker() && top.isEnabled()) {
      loose++;
    }
  }
  if (disabled > 0) warnings.push(`${disabled} disabled script(s) were skipped.`);
  if (loose > 0) {
    warnings.push(`${loose} block stack(s) are not attached to a "when simulation starts" hat and will not run.`);
  }
  if (program.scripts.length === 0) {
    warnings.push('No "when simulation starts" block — the program is empty.');
  }
  return { program, warnings };
}

function stmtChain(block: Blockly.Block | null, warnings: string[]): Stmt[] {
  const out: Stmt[] = [];
  let b = block;
  while (b) {
    if (b.isEnabled()) {
      const s = stmt(b, warnings);
      if (s) out.push(s);
    }
    b = b.getNextBlock();
  }
  return out;
}

function pinField(b: Blockly.Block, name: string): number {
  return Number(b.getFieldValue(name) ?? 0);
}

function varName(b: Blockly.Block): string {
  const f = b.getField('VAR');
  return f ? f.getText() : 'item';
}

function stmt(b: Blockly.Block, warnings: string[]): Stmt | null {
  switch (b.type) {
    case 'io_set_digital':
      return { k: 'setDigital', pin: pinField(b, 'PIN'), value: { k: 'bool', v: b.getFieldValue('VALUE') === 'HIGH' } };
    case 'io_toggle_digital':
      return { k: 'toggleDigital', pin: pinField(b, 'PIN') };
    case 'io_set_pwm':
      return { k: 'setPwm', pin: pinField(b, 'PIN'), duty: expr(b, 'DUTY', warnings, { k: 'num', v: 0 }) };
    case 'control_wait':
      return { k: 'wait', ms: expr(b, 'MS', warnings, { k: 'num', v: 100 }) };
    case 'control_forever':
      return { k: 'forever', body: stmtChain(b.getInputTargetBlock('DO'), warnings) };
    case 'control_repeat':
      return { k: 'repeat', times: expr(b, 'TIMES', warnings, { k: 'num', v: 1 }), body: stmtChain(b.getInputTargetBlock('DO'), warnings) };
    case 'io_if_pin':
      return {
        k: 'if',
        cond: { k: 'readDigital', pin: pinField(b, 'PIN') },
        then: stmtChain(b.getInputTargetBlock('DO'), warnings),
      };
    case 'controls_if': {
      // possibly with else-if / else via mutation
      let node: Stmt | null = null;
      let n = 0;
      while (b.getInput(`IF${n}`)) n++;
      let elseBody: Stmt[] | undefined = b.getInput('ELSE') ? stmtChain(b.getInputTargetBlock('ELSE'), warnings) : undefined;
      for (let i = n - 1; i >= 0; i--) {
        const cond = expr(b, `IF${i}`, warnings, { k: 'bool', v: false });
        const then = stmtChain(b.getInputTargetBlock(`DO${i}`), warnings);
        node = { k: 'if', cond, then, else: elseBody };
        elseBody = node ? [node] : undefined;
      }
      return node;
    }
    case 'variables_set':
      return { k: 'setVar', name: varName(b), value: expr(b, 'VALUE', warnings, { k: 'num', v: 0 }) };
    case 'math_change':
      return { k: 'changeVar', name: varName(b), by: expr(b, 'DELTA', warnings, { k: 'num', v: 1 }) };
    case 'debug_print':
      return { k: 'print', value: expr(b, 'VALUE', warnings, { k: 'str', v: '' }) };
    case 'ic_shift_out':
      return {
        k: 'shiftOut',
        value: expr(b, 'VALUE', warnings, { k: 'num', v: 0 }),
        data: pinField(b, 'DATA'),
        clock: pinField(b, 'CLOCK'),
        latch: pinField(b, 'LATCH'),
      };
    case 'ic_display_digit':
      return {
        k: 'displayDigit',
        digit: expr(b, 'DIGIT', warnings, { k: 'num', v: 0 }),
        data: pinField(b, 'DATA'),
        clock: pinField(b, 'CLOCK'),
        latch: pinField(b, 'LATCH'),
      };
    case 'ic_pulse':
      return { k: 'pulse', pin: pinField(b, 'PIN') };
    case 'debug_highlight':
      return { k: 'highlightPin', pin: pinField(b, 'PIN') };
    case 'debug_probe_label':
      return { k: 'probeLabel', text: String(b.getFieldValue('TEXT') ?? '') };
    default:
      warnings.push(`Skipped unsupported block "${b.type}".`);
      return null;
  }
}

function expr(b: Blockly.Block, inputName: string, warnings: string[], fallback: Expr): Expr {
  const target = b.getInputTargetBlock(inputName);
  if (!target) return fallback;
  return exprOf(target, warnings, fallback);
}

function exprOf(b: Blockly.Block, warnings: string[], fallback: Expr): Expr {
  switch (b.type) {
    case 'math_number':
      return { k: 'num', v: Number(b.getFieldValue('NUM') ?? 0) };
    case 'text':
      return { k: 'str', v: String(b.getFieldValue('TEXT') ?? '') };
    case 'logic_boolean':
      return { k: 'bool', v: b.getFieldValue('BOOL') === 'TRUE' };
    case 'variables_get':
      return { k: 'var', name: varName(b) };
    case 'io_read_digital':
      return { k: 'readDigital', pin: pinField(b, 'PIN') };
    case 'io_read_analog':
      return { k: 'readAnalog', pin: pinField(b, 'PIN') };
    case 'logic_negate':
      return { k: 'not', a: expr(b, 'BOOL', warnings, { k: 'bool', v: false }) };
    case 'logic_compare': {
      const ops: Record<string, '==' | '!=' | '<' | '<=' | '>' | '>='> = {
        EQ: '==',
        NEQ: '!=',
        LT: '<',
        LTE: '<=',
        GT: '>',
        GTE: '>=',
      };
      return {
        k: 'binop',
        op: ops[b.getFieldValue('OP') ?? 'EQ'] ?? '==',
        a: expr(b, 'A', warnings, { k: 'num', v: 0 }),
        b: expr(b, 'B', warnings, { k: 'num', v: 0 }),
      };
    }
    case 'logic_operation':
      return {
        k: 'binop',
        op: b.getFieldValue('OP') === 'OR' ? 'or' : 'and',
        a: expr(b, 'A', warnings, { k: 'bool', v: false }),
        b: expr(b, 'B', warnings, { k: 'bool', v: false }),
      };
    case 'math_arithmetic': {
      const ops: Record<string, '+' | '-' | '*' | '/'> = { ADD: '+', MINUS: '-', MULTIPLY: '*', DIVIDE: '/' };
      const op = ops[b.getFieldValue('OP') ?? 'ADD'];
      if (!op) {
        warnings.push('POWER is not supported; using + instead.');
        return { k: 'binop', op: '+', a: expr(b, 'A', warnings, { k: 'num', v: 0 }), b: expr(b, 'B', warnings, { k: 'num', v: 0 }) };
      }
      return { k: 'binop', op, a: expr(b, 'A', warnings, { k: 'num', v: 0 }), b: expr(b, 'B', warnings, { k: 'num', v: 0 }) };
    }
    case 'math_map':
      return {
        k: 'map',
        x: expr(b, 'X', warnings, { k: 'num', v: 0 }),
        a: expr(b, 'A', warnings, { k: 'num', v: 0 }),
        b: expr(b, 'B', warnings, { k: 'num', v: 1023 }),
        c: expr(b, 'C', warnings, { k: 'num', v: 0 }),
        d: expr(b, 'D', warnings, { k: 'num', v: 255 }),
      };
    default:
      warnings.push(`Skipped unsupported value block "${b.type}".`);
      return fallback;
  }
}
