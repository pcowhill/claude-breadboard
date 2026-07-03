import type { ComponentInstance, NetReading, ValidationIssue } from '../types';
import { snaps } from '../core/boards';
import { defOf } from '../data/componentDefs';
import type { Lab } from '../data/labs';

// Renderers for the right-hand tabbed panel. Pure DOM string/element
// builders; the App wires them to live state.

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderLabPanel(lab: Lab, onLoad: (() => void) | null): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = `
    <h3>${esc(lab.title)}</h3>
    <p>${esc(lab.goal)}</p>
    ${lab.starter ? '<p><button class="primary" id="lab-load-btn">📥 Load this lab\'s starter circuit</button></p>' : ''}
    <h4>Components</h4>
    <ul>${lab.components.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
    <h4>Wiring</h4>
    <ul>${lab.wiring.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
    <h4>What should happen</h4>
    <p>${esc(lab.expectation)}</p>
    <h4>Common mistakes</h4>
    <ul>${lab.mistakes.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
    <h4>Simulation limitations</h4>
    <ul>${lab.limitations.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
  `;
  const btn = el.querySelector<HTMLButtonElement>('#lab-load-btn');
  if (btn && onLoad) btn.addEventListener('click', onLoad);
  return el;
}

export function renderExplainPanel(lab: Lab, stats: { comps: number; wires: number; nets: number }): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = `
    <h3>Circuit explanation</h3>
    <p>${esc(lab.explanation)}</p>
    <h4>How the breadboard connects</h4>
    <ul>
      <li>Within one column, rows <b>a–e</b> are joined; rows <b>f–j</b> are joined. The centre ravine separates the two halves.</li>
      <li>The <span style="color:var(--bad)">+</span> and <span style="color:var(--accent)">−</span> rails run the whole board length (this virtual board has no mid-rail break).</li>
      <li>DIP chips straddle the ravine so each pin gets its own 5-hole strip.</li>
      <li>Each hole holds exactly one leg or wire end — just like the real thing.</li>
    </ul>
    <h4>This circuit right now</h4>
    <p><span class="pill">${stats.comps} components</span><span class="pill">${stats.wires} wires</span><span class="pill">${stats.nets} electrical nets</span></p>
    <p style="color:var(--muted)">Tip: use the 🔍 probe on any hole to see which strip it belongs to and what voltage it sits at.</p>
  `;
  return el;
}

export function renderModelPanel(): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = `
    <h3>What the simulator models</h3>
    <p>This is a <b>digital-first educational model</b>, not a SPICE analog simulator. It is designed to make beginner circuits behave believably and to surface classic mistakes.</p>
    <h4>Modelled</h4>
    <ul>
      <li>Breadboard strip / rail connectivity, wires, one-leg-per-hole rule.</li>
      <li>5 V / 3.3 V / GND supplies (always on, as if USB-powered).</li>
      <li>Resistors (ideal), potentiometer as a two-resistor divider.</li>
      <li>LEDs as a 2 V drop + 30 Ω when forward-biased; brightness ∝ current, clamped at ~12 mA.</li>
      <li>Push buttons, slide switches (ideal contacts, no bounce).</li>
      <li>Arduino-style digital pins (ideal 0/5 V drivers), analog pins (0–1023), PWM as average voltage.</li>
      <li>Capacitor charge/discharge (numerical integration) — enough for 555 timing.</li>
      <li>555 (comparators + latch + discharge switch), 74HC00/04 gates, 74HC595 shift register with edge-triggered clocks, 7-segment display.</li>
      <li>Floating (unconnected) nodes, driver conflicts, shorts, rough overcurrent estimates.</li>
    </ul>
    <h4>NOT modelled</h4>
    <ul>
      <li>Real analog behaviour: transistor curves, AC, inductance, noise, temperature.</li>
      <li>Output impedance and drive limits of pins/gates (except a rough overcurrent warning).</li>
      <li>Switch bounce, propagation delays in ns (logic settles within a simulated millisecond step).</li>
      <li>555 CTRL-pin modulation; exact CMOS input thresholds (fixed at 2.5 V).</li>
      <li>Component damage — the simulator warns instead of releasing magic smoke.</li>
    </ul>
    <h4>How it solves</h4>
    <p>Connected points are merged into <b>nets</b>. Supplies and output pins pin their net to a voltage; every other net takes the conductance-weighted average of its neighbours through resistors/LEDs/capacitors (relaxation). Time advances in 1 ms steps; block programs run as cooperative threads inside those steps.</p>
    <p style="color:var(--muted)">Rule of thumb: trust it for topology, logic, LED behaviour and RC timing to a few per cent — not for precise analog voltages.</p>
  `;
  return el;
}

export function renderIssuesPanel(issues: ValidationIssue[], onPick: (subjectId: string) => void): HTMLElement {
  const el = document.createElement('div');
  const order = { error: 0, warning: 1, info: 2 } as const;
  const sorted = [...issues].sort((a, b) => order[a.severity] - order[b.severity]);
  el.innerHTML = `<h3>Issues</h3>` + (sorted.length === 0 ? '<p style="color:var(--good)">✔ No problems detected. Nice wiring!</p>' : '');
  for (const issue of sorted) {
    const d = document.createElement('div');
    d.className = `issue ${issue.severity}${issue.subjects.length ? ' clickable' : ''}`;
    const icon = issue.severity === 'error' ? '⛔' : issue.severity === 'warning' ? '⚠️' : 'ℹ️';
    d.innerHTML = `<b>${icon} ${esc(issue.title)}</b><small>${esc(issue.detail)}</small>`;
    if (issue.subjects.length) {
      d.title = 'Click to select the part involved';
      d.addEventListener('click', () => onPick(issue.subjects[0]));
    }
    el.appendChild(d);
  }
  const note = document.createElement('p');
  note.style.color = 'var(--muted)';
  note.style.fontSize = '12.5px';
  note.textContent = 'Checks run live: shorts, missing resistors, reversed LEDs, floating inputs, unpowered chips/rails, unwired program pins, and more.';
  el.appendChild(note);
  return el;
}

export interface ToolsState {
  probeSnapId: string | null;
  probeReading: NetReading | null;
  probeLabel: string;
  meterA: string | null;
  meterB: string | null;
  meterVolts: number | null;
  selected: ComponentInstance | null;
  memberCount: number;
}

export function classify(r: NetReading | null): string {
  if (!r) return '—';
  if (r.drive === 'float') return 'FLOATING';
  if (r.drive === 'conflict') return 'CONFLICT';
  if (!Number.isFinite(r.volts)) return 'FLOATING';
  if (r.volts > 2.5) return 'HIGH';
  if (r.volts < 0.8) return 'LOW';
  return 'MID';
}

export function renderToolsPanel(
  st: ToolsState,
  handlers: {
    onProp: (key: string, value: number | string | boolean) => void;
    onDelete: () => void;
    onFlipLed: () => void;
  },
): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = `<h3>Instruments</h3>`;

  // ---- probe
  const probe = document.createElement('div');
  probe.className = 'readout';
  if (st.probeSnapId) {
    const sp = snaps.get(st.probeSnapId);
    const cls = classify(st.probeReading);
    const v = st.probeReading && Number.isFinite(st.probeReading.volts) ? `${st.probeReading.volts.toFixed(2)} V` : '—';
    probe.innerHTML = `
      <div>🔍 Logic probe on <b>${esc(sp.label)}</b>${st.probeLabel ? ` <span class="pill">${esc(st.probeLabel)}</span>` : ''}</div>
      <div class="big state-${cls}" id="probe-live">${cls} · ${v}</div>
      <small style="color:var(--muted)">${esc(sp.desc)} Currently joined with ${st.memberCount - 1} other point${st.memberCount === 2 ? '' : 's'}.</small>`;
  } else {
    probe.innerHTML = `<div>🔍 Logic probe</div><small style="color:var(--muted)">Pick the probe tool and click any hole or pin.</small>`;
  }
  el.appendChild(probe);

  // ---- multimeter
  const meter = document.createElement('div');
  meter.className = 'readout';
  if (st.meterA && st.meterB) {
    const v = st.meterVolts;
    meter.innerHTML = `
      <div>🔋 Multimeter: <b style="color:#ff8787">${esc(snaps.get(st.meterA).label)}</b> → <b>${esc(snaps.get(st.meterB).label)}</b></div>
      <div class="big" id="meter-live">${v === null || !Number.isFinite(v) ? 'open / floating' : v.toFixed(2) + ' V'}</div>
      <small style="color:var(--muted)">Approximate DC voltage between the red and black leads.</small>`;
  } else if (st.meterA) {
    meter.innerHTML = `<div>🔋 Multimeter: red lead on <b>${esc(snaps.get(st.meterA).label)}</b></div><small style="color:var(--muted)">Click a second point for the black lead.</small>`;
  } else {
    meter.innerHTML = `<div>🔋 Multimeter</div><small style="color:var(--muted)">Pick the multimeter tool and click two points.</small>`;
  }
  el.appendChild(meter);

  // ---- inspector
  const insp = document.createElement('div');
  insp.innerHTML = `<h4>Inspector</h4>`;
  if (!st.selected) {
    insp.innerHTML += `<p style="color:var(--muted)">Select a component or wire to edit it. <kbd>Delete</kbd> removes the selection.</p>`;
  } else {
    const comp = st.selected;
    const def = defOf(comp.type);
    const box = document.createElement('div');
    box.className = 'readout';
    box.innerHTML = `<div><b>${esc(def.name)}</b> <span class="pill">${esc(comp.id)}</span></div>`;

    const pinList = document.createElement('small');
    pinList.style.color = 'var(--muted)';
    pinList.innerHTML = Object.entries(comp.pins)
      .map(([pin, snapId]) => `${esc(pin)} → ${esc(snaps.get(snapId).label)}`)
      .join(' · ');
    box.appendChild(pinList);

    const controls = document.createElement('div');

    if (comp.type === 'resistor') {
      controls.appendChild(
        fieldSelect('Resistance', ['100', '220', '330', '470', '1000', '2200', '4700', '10000', '47000', '100000'], String(comp.props.ohms), (v) =>
          handlers.onProp('ohms', Number(v)),
        (v) => (Number(v) >= 1000 ? `${Number(v) / 1000} kΩ` : `${v} Ω`)),
      );
    }
    if (comp.type === 'led') {
      controls.appendChild(fieldSelect('Colour', ['red', 'green', 'yellow', 'blue', 'white'], String(comp.props.color), (v) => handlers.onProp('color', v)));
      const flip = document.createElement('button');
      flip.textContent = '↔ Flip polarity';
      flip.addEventListener('click', handlers.onFlipLed);
      const row = document.createElement('div');
      row.className = 'field-row';
      row.appendChild(flip);
      controls.appendChild(row);
    }
    if (comp.type === 'capacitor') {
      controls.appendChild(
        fieldSelect('Capacitance', ['0.000001', '0.00001', '0.0001', '0.00047'], String(comp.props.farads), (v) => handlers.onProp('farads', Number(v)), (v) => `${Number(v) * 1e6} µF`),
      );
    }
    if (comp.type === 'pot') {
      const row = document.createElement('div');
      row.className = 'field-row';
      row.innerHTML = `<label>Knob</label>`;
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = '0';
      slider.max = '1';
      slider.step = '0.01';
      slider.value = String(comp.props.t);
      slider.style.flex = '1';
      slider.addEventListener('input', () => handlers.onProp('t', Number(slider.value)));
      row.appendChild(slider);
      controls.appendChild(row);
      controls.appendChild(
        fieldSelect('Track', ['1000', '10000', '100000'], String(comp.props.ohms), (v) => handlers.onProp('ohms', Number(v)), (v) => `${Number(v) / 1000} kΩ`),
      );
    }
    if (comp.type === 'switch') {
      const row = document.createElement('div');
      row.className = 'field-row';
      const btn = document.createElement('button');
      btn.textContent = comp.props.position === 1 ? 'Position: COM↔T2 (click to flip)' : 'Position: COM↔T1 (click to flip)';
      btn.addEventListener('click', () => handlers.onProp('position', comp.props.position === 1 ? 0 : 1));
      row.appendChild(btn);
      controls.appendChild(row);
    }
    if (comp.type === 'button') {
      const hint = document.createElement('p');
      hint.style.color = 'var(--muted)';
      hint.innerHTML = '<small>Click-and-hold the red cap in the 3D view to press it.</small>';
      controls.appendChild(hint);
    }

    const pinDocs = document.createElement('details');
    pinDocs.innerHTML =
      `<summary style="cursor:pointer;color:var(--muted)">Pin reference</summary>` +
      `<ul>${def.pinsDoc.map((p) => `<li><b>${esc(p.name)}</b> — ${esc(p.desc)}</li>`).join('')}</ul>`;
    controls.appendChild(pinDocs);

    const delRow = document.createElement('div');
    delRow.className = 'field-row';
    const del = document.createElement('button');
    del.textContent = '🗑 Delete';
    del.addEventListener('click', handlers.onDelete);
    delRow.appendChild(del);
    controls.appendChild(delRow);

    box.appendChild(controls);
    insp.appendChild(box);
  }
  el.appendChild(insp);
  return el;
}

function fieldSelect(label: string, values: string[], current: string, onChange: (v: string) => void, fmt?: (v: string) => string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'field-row';
  const l = document.createElement('label');
  l.textContent = label;
  const sel = document.createElement('select');
  for (const v of values) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = fmt ? fmt(v) : v;
    if (v === current) o.selected = true;
    sel.appendChild(o);
  }
  if (!values.includes(current)) {
    const o = document.createElement('option');
    o.value = current;
    o.textContent = fmt ? fmt(current) : current;
    o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener('change', () => onChange(sel.value));
  row.appendChild(l);
  row.appendChild(sel);
  return row;
}

export function renderSerialPanel(lines: Array<{ t: number; text: string }>, onClear: () => void): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = `<h3 style="display:flex;justify-content:space-between;align-items:center">Serial monitor <button id="serial-clear">Clear</button></h3>`;
  const log = document.createElement('div');
  log.id = 'serial-log';
  log.innerHTML = lines.length
    ? lines.map((l) => `<div><span class="t">[${(l.t / 1000).toFixed(2)}s]</span> ${esc(l.text)}</div>`).join('')
    : '<div style="color:#5c6b84">— no output yet. Use the “print … to serial monitor” block. —</div>';
  el.appendChild(log);
  el.querySelector('#serial-clear')!.addEventListener('click', onClear);
  queueMicrotask(() => (log.scrollTop = log.scrollHeight));
  return el;
}
