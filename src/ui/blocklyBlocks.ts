import * as Blockly from 'blockly';

// Custom Arduino-style blocks + toolbox + theme. The workspace compiles into
// the internal AST (see core/program/compiler.ts) — we never generate or eval
// JavaScript.

const DIGITAL_PINS: Array<[string, string]> = Array.from({ length: 14 }, (_, i) => [`D${i}`, String(i)]).reverse() as Array<
  [string, string]
>;
const PWM_PINS: Array<[string, string]> = [3, 5, 6, 9, 10, 11].map((n) => [`D${n}`, String(n)]);
const ANALOG_PINS: Array<[string, string]> = Array.from({ length: 6 }, (_, i) => [`A${i}`, String(i)]);

export function defineBlocks() {
  Blockly.defineBlocksWithJsonArray([
    {
      type: 'event_start',
      message0: 'when simulation starts',
      nextStatement: null,
      style: 'hat_blocks',
      hat: 'cap',
      tooltip: 'Runs once when you press Run. Put your program under this block. You can have several of these — they run at the same time.',
    },
    {
      type: 'control_forever',
      message0: 'forever %1 %2',
      args0: [{ type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }],
      previousStatement: null,
      style: 'loop_blocks',
      tooltip: 'Repeats forever, like Arduino loop(). Runs one pass per simulated millisecond unless you add waits.',
    },
    {
      type: 'control_repeat',
      message0: 'repeat %1 times %2 %3',
      args0: [
        { type: 'input_value', name: 'TIMES', check: 'Number' },
        { type: 'input_dummy' },
        { type: 'input_statement', name: 'DO' },
      ],
      previousStatement: null,
      nextStatement: null,
      style: 'loop_blocks',
      tooltip: 'Repeats the enclosed blocks N times.',
    },
    {
      type: 'control_wait',
      message0: 'wait %1 ms',
      args0: [{ type: 'input_value', name: 'MS', check: 'Number' }],
      previousStatement: null,
      nextStatement: null,
      style: 'loop_blocks',
      tooltip: 'Pauses this script for the given simulated milliseconds.',
    },
    {
      type: 'io_set_digital',
      message0: 'set digital pin %1 %2',
      args0: [
        { type: 'field_dropdown', name: 'PIN', options: DIGITAL_PINS },
        { type: 'field_dropdown', name: 'VALUE', options: [['HIGH', 'HIGH'], ['LOW', 'LOW']] },
      ],
      previousStatement: null,
      nextStatement: null,
      style: 'io_blocks',
      tooltip: 'Drives the pin to 5 V (HIGH) or 0 V (LOW), like digitalWrite().',
    },
    {
      type: 'io_toggle_digital',
      message0: 'toggle digital pin %1',
      args0: [{ type: 'field_dropdown', name: 'PIN', options: DIGITAL_PINS }],
      previousStatement: null,
      nextStatement: null,
      style: 'io_blocks',
      tooltip: 'Flips the pin: HIGH becomes LOW, LOW becomes HIGH.',
    },
    {
      type: 'io_read_digital',
      message0: 'read digital pin %1',
      args0: [{ type: 'field_dropdown', name: 'PIN', options: DIGITAL_PINS }],
      output: 'Boolean',
      style: 'io_blocks',
      tooltip: 'True when the pin sees more than 2.5 V, like digitalRead().',
    },
    {
      type: 'io_if_pin',
      message0: 'if digital pin %1 is HIGH then %2 %3',
      args0: [
        { type: 'field_dropdown', name: 'PIN', options: DIGITAL_PINS },
        { type: 'input_dummy' },
        { type: 'input_statement', name: 'DO' },
      ],
      previousStatement: null,
      nextStatement: null,
      style: 'io_blocks',
      tooltip: 'Shortcut for if + read digital pin.',
    },
    {
      type: 'io_read_analog',
      message0: 'read analog pin %1',
      args0: [{ type: 'field_dropdown', name: 'PIN', options: ANALOG_PINS }],
      output: 'Number',
      style: 'analog_blocks',
      tooltip: 'Reads 0–1023 for 0–5 V, like analogRead().',
    },
    {
      type: 'io_set_pwm',
      message0: 'set PWM pin %1 to %2',
      args0: [
        { type: 'field_dropdown', name: 'PIN', options: PWM_PINS },
        { type: 'input_value', name: 'DUTY', check: 'Number' },
      ],
      previousStatement: null,
      nextStatement: null,
      style: 'analog_blocks',
      tooltip: 'analogWrite(): 0 = off, 255 = fully on. The simulator models PWM as an average voltage (LED brightness).',
    },
    {
      type: 'math_map',
      message0: 'map %1 from %2 – %3 to %4 – %5',
      args0: [
        { type: 'input_value', name: 'X', check: 'Number' },
        { type: 'input_value', name: 'A', check: 'Number' },
        { type: 'input_value', name: 'B', check: 'Number' },
        { type: 'input_value', name: 'C', check: 'Number' },
        { type: 'input_value', name: 'D', check: 'Number' },
      ],
      inputsInline: true,
      output: 'Number',
      style: 'math_blocks',
      tooltip: 'Rescales a value, like Arduino map(). E.g. map 0–1023 to 0–255.',
    },
    {
      type: 'ic_shift_out',
      message0: 'shift out byte %1 data %2 clock %3 latch %4',
      args0: [
        { type: 'input_value', name: 'VALUE', check: 'Number' },
        { type: 'field_dropdown', name: 'DATA', options: DIGITAL_PINS },
        { type: 'field_dropdown', name: 'CLOCK', options: DIGITAL_PINS },
        { type: 'field_dropdown', name: 'LATCH', options: DIGITAL_PINS },
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      style: 'ic_blocks',
      tooltip: 'Sends 8 bits MSB-first into a 74HC595 and latches the outputs (bit 0 → QA … bit 7 → QH). Takes ~20 simulated ms.',
    },
    {
      type: 'ic_display_digit',
      message0: 'display digit %1 on 7-segment via data %2 clock %3 latch %4',
      args0: [
        { type: 'input_value', name: 'DIGIT', check: 'Number' },
        { type: 'field_dropdown', name: 'DATA', options: DIGITAL_PINS },
        { type: 'field_dropdown', name: 'CLOCK', options: DIGITAL_PINS },
        { type: 'field_dropdown', name: 'LATCH', options: DIGITAL_PINS },
      ],
      inputsInline: true,
      previousStatement: null,
      nextStatement: null,
      style: 'ic_blocks',
      tooltip: 'Looks up the segment pattern for 0–9 and shifts it into a 74HC595 wired to a common-cathode display (QA→a … QG→g, QH→dp).',
    },
    {
      type: 'ic_pulse',
      message0: 'pulse pin %1',
      args0: [{ type: 'field_dropdown', name: 'PIN', options: DIGITAL_PINS }],
      previousStatement: null,
      nextStatement: null,
      style: 'ic_blocks',
      tooltip: 'HIGH for 2 simulated ms, then LOW. Handy for clock/latch pins.',
    },
    {
      type: 'debug_print',
      message0: 'print %1 to serial monitor',
      args0: [{ type: 'input_value', name: 'VALUE' }],
      previousStatement: null,
      nextStatement: null,
      style: 'debug_blocks',
      tooltip: 'Shows the value in the Serial panel, like Serial.println().',
    },
    {
      type: 'debug_highlight',
      message0: 'highlight pin %1',
      args0: [{ type: 'field_dropdown', name: 'PIN', options: DIGITAL_PINS }],
      previousStatement: null,
      nextStatement: null,
      style: 'debug_blocks',
      tooltip: 'Flashes a marker on that Arduino pin in the 3D view.',
    },
    {
      type: 'debug_probe_label',
      message0: 'set probe label %1',
      args0: [{ type: 'field_text', name: 'TEXT', text: 'checkpoint' }],
      previousStatement: null,
      nextStatement: null,
      style: 'debug_blocks',
      tooltip: 'Sets the label shown next to the logic probe readout.',
    },
  ]);
}

function num(n: number) {
  return { shadow: { type: 'math_number', fields: { NUM: n } } };
}

export const TOOLBOX = {
  kind: 'categoryToolbox',
  contents: [
    {
      kind: 'category',
      name: 'Flow',
      categorystyle: 'loop_category',
      contents: [
        { kind: 'block', type: 'event_start' },
        { kind: 'block', type: 'control_forever' },
        { kind: 'block', type: 'control_repeat', inputs: { TIMES: num(10) } },
        { kind: 'block', type: 'control_wait', inputs: { MS: num(500) } },
      ],
    },
    {
      kind: 'category',
      name: 'Digital',
      categorystyle: 'io_category',
      contents: [
        { kind: 'block', type: 'io_set_digital' },
        { kind: 'block', type: 'io_toggle_digital' },
        { kind: 'block', type: 'io_read_digital' },
        { kind: 'block', type: 'io_if_pin' },
      ],
    },
    {
      kind: 'category',
      name: 'Analog/PWM',
      categorystyle: 'analog_category',
      contents: [
        { kind: 'block', type: 'io_read_analog' },
        { kind: 'block', type: 'io_set_pwm', inputs: { DUTY: num(128) } },
        {
          kind: 'block',
          type: 'math_map',
          inputs: { X: num(0), A: num(0), B: num(1023), C: num(0), D: num(255) },
        },
      ],
    },
    { kind: 'category', name: 'Variables', custom: 'VARIABLE', categorystyle: 'variable_category' },
    {
      kind: 'category',
      name: 'Logic & Math',
      categorystyle: 'logic_category',
      contents: [
        { kind: 'block', type: 'controls_if' },
        { kind: 'block', type: 'controls_if', extraState: { hasElse: true } },
        { kind: 'block', type: 'logic_compare', inputs: { A: num(0), B: num(0) } },
        { kind: 'block', type: 'logic_operation' },
        { kind: 'block', type: 'logic_negate' },
        { kind: 'block', type: 'logic_boolean' },
        { kind: 'block', type: 'math_number' },
        { kind: 'block', type: 'math_arithmetic', inputs: { A: num(1), B: num(1) } },
      ],
    },
    {
      kind: 'category',
      name: 'IC Helpers',
      categorystyle: 'ic_category',
      contents: [
        { kind: 'block', type: 'ic_shift_out', inputs: { VALUE: num(255) } },
        { kind: 'block', type: 'ic_display_digit', inputs: { DIGIT: num(8) } },
        { kind: 'block', type: 'ic_pulse' },
      ],
    },
    {
      kind: 'category',
      name: 'Debug',
      categorystyle: 'debug_category',
      contents: [
        { kind: 'block', type: 'debug_print', inputs: { VALUE: num(0) } },
        {
          kind: 'block',
          type: 'debug_print',
          inputs: { VALUE: { shadow: { type: 'text', fields: { TEXT: 'hello' } } } },
        },
        { kind: 'block', type: 'text' },
        { kind: 'block', type: 'debug_highlight' },
        { kind: 'block', type: 'debug_probe_label' },
      ],
    },
  ],
};

export const THEME = Blockly.Theme.defineTheme('vbl', {
  name: 'vbl',
  base: Blockly.Themes.Zelos,
  blockStyles: {
    hat_blocks: { colourPrimary: '#f2b705', colourSecondary: '#c79504', colourTertiary: '#9c7503' },
    loop_blocks: { colourPrimary: '#ffab19', colourSecondary: '#ec9c13', colourTertiary: '#cf8b17' },
    io_blocks: { colourPrimary: '#4c97ff', colourSecondary: '#4280d7', colourTertiary: '#3373cc' },
    analog_blocks: { colourPrimary: '#9966ff', colourSecondary: '#855cd6', colourTertiary: '#774dcb' },
    math_blocks: { colourPrimary: '#59c059', colourSecondary: '#46b946', colourTertiary: '#389438' },
    logic_blocks: { colourPrimary: '#59c059', colourSecondary: '#46b946', colourTertiary: '#389438' },
    ic_blocks: { colourPrimary: '#ff6680', colourSecondary: '#ff4d6a', colourTertiary: '#e64d69' },
    debug_blocks: { colourPrimary: '#0fbd8c', colourSecondary: '#0da57a', colourTertiary: '#0b8e69' },
    variable_blocks: { colourPrimary: '#ff8c1a', colourSecondary: '#ff8000', colourTertiary: '#db6e00' },
    text_blocks: { colourPrimary: '#0fbd8c', colourSecondary: '#0da57a', colourTertiary: '#0b8e69' },
  },
  categoryStyles: {
    loop_category: { colour: '#ffab19' },
    io_category: { colour: '#4c97ff' },
    analog_category: { colour: '#9966ff' },
    logic_category: { colour: '#59c059' },
    ic_category: { colour: '#ff6680' },
    debug_category: { colour: '#0fbd8c' },
    variable_category: { colour: '#ff8c1a' },
  },
  componentStyles: {
    workspaceBackgroundColour: '#1e2430',
    toolboxBackgroundColour: '#171c26',
    toolboxForegroundColour: '#c9d4e3',
    flyoutBackgroundColour: '#222a38',
    flyoutForegroundColour: '#c9d4e3',
    flyoutOpacity: 0.97,
    scrollbarColour: '#4a5568',
    insertionMarkerColour: '#ffffff',
    insertionMarkerOpacity: 0.3,
  },
  fontStyle: { family: 'system-ui, sans-serif', size: 10 },
});

export function injectBlockly(container: HTMLElement): Blockly.WorkspaceSvg {
  defineBlocks();
  return Blockly.inject(container, {
    toolbox: TOOLBOX as Blockly.utils.toolbox.ToolboxDefinition,
    theme: THEME,
    renderer: 'zelos',
    media: 'blockly-media/',
    sounds: false,
    zoom: { controls: true, wheel: true, startScale: 0.8, minScale: 0.4, maxScale: 1.5 },
    grid: { spacing: 24, length: 2, colour: '#31394a', snap: false },
    trashcan: true,
    move: { scrollbars: true, drag: true, wheel: false },
  });
}
