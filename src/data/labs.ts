import type { ComponentInstance, ComponentTypeId, ProjectData, Wire } from '../types';
import { sampleById } from './samplePrograms';

export interface Lab {
  id: string;
  title: string;
  goal: string;
  components: string[];
  wiring: string[];
  expectation: string;
  explanation: string;
  mistakes: string[];
  limitations: string[];
  starter: ProjectData | null;
}

// ---- tiny builder DSL -------------------------------------------------------

class Builder {
  components: ComponentInstance[] = [];
  wires: Wire[] = [];
  private n = 1;

  comp(type: ComponentTypeId, pins: Record<string, string>, props: Record<string, number | string | boolean> = {}): this {
    this.components.push({ id: `c${this.n++}`, type, pins, props });
    return this;
  }

  wire(a: string, b: string, color: string): this {
    this.wires.push({ id: `w${this.n++}`, a, b, color });
    return this;
  }

  project(labId: string, programId: string | null): ProjectData {
    return {
      version: 1,
      labId,
      components: this.components,
      wires: this.wires,
      program: programId ? (sampleById(programId)?.json ?? null) : null,
      settings: { speed: 1 },
    };
  }
}

const RED = '#e03131';
const BLACK = '#212529';
const YELLOW = '#f5c518';
const GREEN = '#2f9e44';
const BLUE = '#3b6fe0';

// DIP footprints used by starters (must match componentDefs footprints):
// 555 @ col10:  GND f10, TRIG f11, OUT f12, RESET f13, CTRL e13, THRES e12, DISCH e11, VCC e10
// 595 @ col3:   QB f3 … GND f10 / VCC e3, QA e4, DS e5, OE e6, STCP e7, SHCP e8, MR e9, QH' e10
// 7seg @ col14: e f14, d f15, com f16, c f17, dp f18 / g e14, f e15, com e16, a e17, b e18

function lab1Starter(): ProjectData {
  return new Builder()
    .wire('ard.5v', 'bb.pt1', RED)
    .wire('ard.gnd1', 'bb.nt1', BLACK)
    .comp('resistor', { p1: 'bb.pt3', p2: 'bb.a10' }, { ohms: 330 })
    .comp('led', { anode: 'bb.b10', cathode: 'bb.b12' }, { color: 'red' })
    .wire('bb.a12', 'bb.nt3', BLACK)
    .project('lab1', null);
}

function lab2Starter(): ProjectData {
  return new Builder()
    .wire('ard.5v', 'bb.pt1', RED)
    .wire('ard.gnd1', 'bb.nt1', BLACK)
    .comp('button', { a1: 'bb.e5', a2: 'bb.e7', b1: 'bb.f5', b2: 'bb.f7' })
    .wire('ard.d2', 'bb.a5', YELLOW)
    .comp('resistor', { p1: 'bb.b5', p2: 'bb.nt3' }, { ohms: 10000 })
    .wire('bb.g5', 'bb.pt3', RED)
    .wire('ard.d13', 'bb.a15', BLUE)
    .comp('resistor', { p1: 'bb.b15', p2: 'bb.b17' }, { ohms: 330 })
    .comp('led', { anode: 'bb.c17', cathode: 'bb.c19' }, { color: 'green' })
    .wire('bb.a19', 'bb.nt5', BLACK)
    .project('lab2', 'button-led');
}

function lab3Starter(): ProjectData {
  return new Builder()
    .wire('ard.5v', 'bb.pt1', RED)
    .wire('ard.gnd1', 'bb.nt1', BLACK)
    .comp('ic555', {
      GND: 'bb.f10',
      TRIG: 'bb.f11',
      OUT: 'bb.f12',
      RESET: 'bb.f13',
      CTRL: 'bb.e13',
      THRES: 'bb.e12',
      DISCH: 'bb.e11',
      VCC: 'bb.e10',
    })
    .wire('bb.a10', 'bb.pt5', RED)
    .wire('bb.g10', 'bb.nt5', BLACK)
    .wire('bb.g13', 'bb.pt7', RED)
    .comp('resistor', { p1: 'bb.b11', p2: 'bb.pt9' }, { ohms: 1000 })
    .comp('resistor', { p1: 'bb.c11', p2: 'bb.b12' }, { ohms: 47000 })
    .comp('capacitor', { plus: 'bb.c12', minus: 'bb.nt7' }, { farads: 0.00001 })
    .wire('bb.g11', 'bb.d12', GREEN)
    .comp('resistor', { p1: 'bb.g12', p2: 'bb.g15' }, { ohms: 330 })
    .comp('led', { anode: 'bb.h15', cathode: 'bb.h17' }, { color: 'yellow' })
    .wire('bb.g17', 'bb.nt9', BLACK)
    .project('lab3', null);
}

function lab4Starter(): ProjectData {
  const b = new Builder()
    .wire('ard.5v', 'bb.pt1', RED)
    .wire('ard.gnd1', 'bb.nt1', BLACK)
    .comp('ic74hc595', {
      QB: 'bb.f3',
      QC: 'bb.f4',
      QD: 'bb.f5',
      QE: 'bb.f6',
      QF: 'bb.f7',
      QG: 'bb.f8',
      QH: 'bb.f9',
      GND: 'bb.f10',
      QH2: 'bb.e10',
      MR: 'bb.e9',
      SHCP: 'bb.e8',
      STCP: 'bb.e7',
      OE: 'bb.e6',
      DS: 'bb.e5',
      QA: 'bb.e4',
      VCC: 'bb.e3',
    })
    .comp('sevenseg', {
      e: 'bb.f14',
      d: 'bb.f15',
      com1: 'bb.f16',
      c: 'bb.f17',
      dp: 'bb.f18',
      g: 'bb.e14',
      f: 'bb.e15',
      com2: 'bb.e16',
      a: 'bb.e17',
      b: 'bb.e18',
    })
    .wire('bb.a3', 'bb.pt2', RED) // 595 VCC
    .wire('bb.g10', 'bb.nt2', BLACK) // 595 GND
    .wire('bb.a9', 'bb.pt4', RED) // MR high
    .wire('bb.a6', 'bb.nt4', BLACK) // OE low
    .wire('ard.d2', 'bb.a5', YELLOW) // DS
    .wire('ard.d3', 'bb.a8', GREEN) // SHCP
    .wire('ard.d4', 'bb.a7', BLUE) // STCP
    .wire('bb.g16', 'bb.nt6', BLACK); // common cathode
  const r = 220;
  b.comp('resistor', { p1: 'bb.b4', p2: 'bb.a17' }, { ohms: r }); // QA -> a
  b.comp('resistor', { p1: 'bb.g3', p2: 'bb.a18' }, { ohms: r }); // QB -> b
  b.comp('resistor', { p1: 'bb.g4', p2: 'bb.g17' }, { ohms: r }); // QC -> c
  b.comp('resistor', { p1: 'bb.g5', p2: 'bb.g15' }, { ohms: r }); // QD -> d
  b.comp('resistor', { p1: 'bb.g6', p2: 'bb.g14' }, { ohms: r }); // QE -> e
  b.comp('resistor', { p1: 'bb.g7', p2: 'bb.a15' }, { ohms: r }); // QF -> f
  b.comp('resistor', { p1: 'bb.g8', p2: 'bb.a14' }, { ohms: r }); // QG -> g
  b.comp('resistor', { p1: 'bb.g9', p2: 'bb.g18' }, { ohms: r }); // QH -> dp
  return b.project('lab4', 'sevenseg-counter');
}

export const LABS: Lab[] = [
  {
    id: 'free',
    title: 'Free build',
    goal: 'Open workbench — build anything you like.',
    components: ['Everything in the palette.'],
    wiring: [
      'Drag parts from the palette onto the breadboard.',
      'Use the wire tool: click one hole/pin, then another.',
      'Power the rails from the Arduino 5V / GND pins first.',
    ],
    expectation: 'Whatever you wire is simulated live; press Run to also start your block program.',
    explanation:
      'Remember how a breadboard connects: within one column, rows a–e are joined, and rows f–j are joined (the centre ravine separates them). The long + and − rails run the whole board. The Arduino header sockets connect straight to the microcontroller pins.',
    mistakes: [
      'Expecting rows a–e and f–j of the same column to be connected — they are not.',
      'Forgetting to power the rails: they are just strips of metal until you wire 5 V / GND to them.',
    ],
    limitations: ['See the Simulation Model panel for exactly what is and is not modelled.'],
    starter: null,
  },
  {
    id: 'lab1',
    title: 'Lab 1 · Light an LED',
    goal: 'Light an LED safely from the 5 V supply using a series resistor.',
    components: ['1 × LED (red)', '1 × 330 Ω resistor', '2 × jumper wires to power the rails', '1 × jumper to ground'],
    wiring: [
      'Wire Arduino 5V → breadboard + rail, and Arduino GND → − rail.',
      'Resistor from the + rail to column 10 (top half).',
      'LED: anode (+) in column 10, cathode (−) in column 12.',
      'Jumper from column 12 to the − rail.',
    ],
    expectation: 'The LED lights immediately — no program needed. Try the probe: the anode strip sits near 5 V minus the resistor drop.',
    explanation:
      'Current flows 5 V → resistor → LED → GND. The LED drops about 2 V; the resistor takes the remaining 3 V, so I = 3 V / 330 Ω ≈ 9 mA — comfortably inside the LED\'s rating. The resistor is not optional: without it the only thing limiting current is the wiring, and a real LED burns out.',
    mistakes: [
      'LED reversed: LEDs only conduct one way. Flip it if it stays dark.',
      'No resistor: the simulator flags overcurrent; a real LED dies.',
      'Both legs in the same column: the strip shorts the LED out (the simulator refuses this placement).',
    ],
    limitations: [
      'The LED is modelled as a fixed 2 V drop + 30 Ω, so brightness is an approximation of current, not a photometric model.',
    ],
    starter: lab1Starter(),
  },
  {
    id: 'lab2',
    title: 'Lab 2 · Button → Arduino → LED',
    goal: 'Read a push button on a digital input and control an LED from the block program.',
    components: ['1 × push button', '1 × 10 kΩ resistor (pull-down)', '1 × LED + 330 Ω resistor', '5 × jumper wires'],
    wiring: [
      'Power both rails from the Arduino (5V → +, GND → −).',
      'Button straddles the centre gap around columns 5–7.',
      'D2 → the button\'s top-side strip; 10 kΩ from that strip to the − rail (pull-down).',
      'The button\'s bottom-side strip → + rail.',
      'D13 → 330 Ω → LED → − rail.',
    ],
    expectation: 'Run the program. The LED follows the button: hold the button down (click-and-hold it) and the LED lights.',
    explanation:
      'With the button up, the pull-down resistor holds D2 at 0 V → reads LOW. Pressing the button connects D2\'s strip to 5 V → reads HIGH; the 10 kΩ then just carries a harmless 0.5 mA. The program polls D2 forever and copies the state to D13. Without the pull-down, D2 would float when the button is up and read random noise — try deleting the resistor and watch the Issues panel.',
    mistakes: [
      'No pull-down/pull-up: floating inputs read garbage.',
      'Wiring both button pins on the same side of the gap: same-side pins are joined internally, so the button does nothing.',
      'Forgetting the LED resistor.',
    ],
    limitations: ['No switch bounce is modelled — real buttons chatter for a few ms and sometimes need debouncing.'],
    starter: lab2Starter(),
  },
  {
    id: 'lab3',
    title: 'Lab 3 · 555 timer blinker',
    goal: 'Build the classic 555 astable oscillator and blink an LED with no code at all.',
    components: ['1 × 555 timer', '1 kΩ (R1), 47 kΩ (R2), 330 Ω resistors', '10 µF capacitor', '1 × LED', '6 × jumpers'],
    wiring: [
      'Power the rails. 555 straddles the gap at columns 10–13 (pin 1 = bottom-left).',
      'Pin 8 (VCC) → + rail, pin 1 (GND) → − rail, pin 4 (RESET) → + rail.',
      'R1 (1 kΩ): + rail → pin 7 (DISCH).',
      'R2 (47 kΩ): pin 7 → pin 6 (THRES).',
      'Capacitor (10 µF): pin 6 → − rail. Join pin 2 (TRIG) to pin 6.',
      'Pin 3 (OUT) → 330 Ω → LED → − rail.',
    ],
    expectation: 'The LED blinks at about 1.5 Hz as soon as the circuit is powered — the 555 is hardware, it needs no program. Probe pin 6 to watch the capacitor ramp between ⅓ and ⅔ of 5 V.',
    explanation:
      'The capacitor charges through R1+R2 toward 5 V. When it passes ⅔·VCC, the 555 flips: OUT goes LOW and pin 7 starts discharging the cap through R2. When it falls below ⅓·VCC it flips back. High time ≈ 0.693·(R1+R2)·C ≈ 0.33 s, low time ≈ 0.693·R2·C ≈ 0.33 s.',
    mistakes: [
      'RESET (pin 4) left floating or low — tie it to 5 V.',
      'Forgetting the TRIG↔THRES jumper: the astable trick is that the cap drives both comparators.',
      'Electrolytic capacitor reversed (the simulator ignores polarity but real ones vent).',
    ],
    limitations: [
      'The 555 model is behavioural: two comparator thresholds, a latch and a discharge switch. CTRL (pin 5) modulation and output drive limits are not modelled; the RC charge itself is integrated numerically and is accurate to a few per cent.',
    ],
    starter: lab3Starter(),
  },
  {
    id: 'lab4',
    title: 'Lab 4 · Shift register 7-segment counter',
    goal: 'Use a 74HC595 to drive a 7-segment display with just three Arduino pins.',
    components: ['1 × 74HC595', '1 × 7-segment display (common cathode)', '8 × 220 Ω resistors', '10 × jumpers'],
    wiring: [
      '595 at columns 3–10 (pin 1 bottom-left); display at columns 14–18.',
      '595: VCC (16) → +, GND (8) → −, MR (10) → +, OE (13) → −.',
      'D2 → DS (14), D3 → SHCP (11), D4 → STCP (12).',
      'Each output QA…QH → 220 Ω → segment a…g and dp.',
      'Display common cathode (pin 3 or 8) → − rail.',
    ],
    expectation: 'Run the program: the display counts 0…9, one step every 0.6 s, and the count is printed to the serial monitor.',
    explanation:
      'The 74HC595 is a serial-in, parallel-out shift register. Each rising edge on SHCP shifts the DS bit in; a rising edge on STCP copies the 8 internal bits to the output pins, so the display never shows half-shifted garbage. The "display digit" block sends the right segment pattern MSB-first (bit 0 → QA → segment a). Every segment is an LED, so every segment gets its own resistor.',
    mistakes: [
      'MR or OE left floating — the register resets or its outputs disconnect.',
      'One resistor for the whole display: segments then share current and brightness varies per digit.',
      'Swapping SHCP and STCP — data shifts but never latches (or latches constantly).',
    ],
    limitations: [
      'Shift timing is stretched enormously (each clock edge takes a simulated millisecond) so you can watch it happen; a real 595 clocks at MHz.',
    ],
    starter: lab4Starter(),
  },
];

export function labById(id: string): Lab {
  return LABS.find((l) => l.id === id) ?? LABS[0];
}
