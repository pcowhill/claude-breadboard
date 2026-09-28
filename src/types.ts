// Shared types for the Virtual Breadboard Lab.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type BoardId = 'bb' | 'ard';
export type SnapKind = 'bb-hole' | 'bb-rail' | 'ard-pin';

/** A snap point is any place a component leg or wire end can attach. */
export interface SnapPoint {
  id: string;
  boardId: BoardId;
  /** Static connectivity group. All snaps sharing a netKey are permanently joined. */
  netKey: string;
  pos: Vec3; // world position, millimetres
  label: string;
  kind: SnapKind;
  desc: string;
}

export type ComponentTypeId =
  | 'led'
  | 'resistor'
  | 'capacitor'
  | 'button'
  | 'switch'
  | 'pot'
  | 'ic555'
  | 'ic74hc00'
  | 'ic74hc04'
  | 'ic74hc595'
  | 'sevenseg';

export interface ComponentInstance {
  id: string;
  type: ComponentTypeId;
  /** pin name -> snap id */
  pins: Record<string, string>;
  props: Record<string, number | string | boolean>;
}

export interface Wire {
  id: string;
  a: string; // snap id
  b: string; // snap id
  color: string;
}

export interface ProjectData {
  version: 1;
  labId: string;
  components: ComponentInstance[];
  wires: Wire[];
  /** Blockly workspace serialization JSON (or null). */
  program: object | null;
  settings: { speed: number };
}

export type NetDrive = 'strong' | 'weak' | 'float' | 'conflict';

export interface NetReading {
  volts: number; // NaN when floating
  drive: NetDrive;
}

export type Severity = 'error' | 'warning' | 'info';

export interface ValidationIssue {
  code: string;
  severity: Severity;
  title: string;
  detail: string;
  /** component / wire ids involved, for click-to-select. */
  subjects: string[];
}

export interface PinDoc {
  name: string;
  desc: string;
}

export interface FootprintPin {
  name: string;
  dCol: number;
  /** 'e' / 'f' are the rows next to the centre ravine; 'anchor' = row of the clicked hole. */
  row: 'anchor' | 'e' | 'f';
}

export interface ComponentDef {
  type: ComponentTypeId;
  name: string;
  short: string;
  placement: 'two-pin' | 'footprint';
  pinsDoc: PinDoc[];
  /** For footprint parts: pin holes relative to the anchor column. */
  footprint?: FootprintPin[];
  /** For two-pin parts. */
  twoPin?: { firstPin: string; secondPin: string; firstLabel: string; secondLabel: string; maxSpan: number };
  defaultProps: Record<string, number | string | boolean>;
  paletteHint: string;
}
