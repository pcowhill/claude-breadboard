import { componentDefs } from '../data/componentDefs';
import { LABS } from '../data/labs';
import { SAMPLE_PROGRAMS } from '../data/samplePrograms';

export const WIRE_COLORS = ['#e03131', '#212529', '#f5c518', '#2f9e44', '#3b6fe0', '#e8590c', '#f1f3f5', '#9c36b5'];

export interface UIRefs {
  canvas: HTMLCanvasElement;
  statusHover: HTMLElement;
  statusMode: HTMLElement;
  drawer: HTMLElement;
  blocklyHost: HTMLElement;
  drawerStatus: HTMLElement;
  panelBody: HTMLElement;
  tabs: HTMLElement;
  sidepanel: HTMLElement;
  btnRun: HTMLButtonElement;
  btnStop: HTMLButtonElement;
  btnReset: HTMLButtonElement;
  simTime: HTMLElement;
  speedSel: HTMLSelectElement;
  labSel: HTMLSelectElement;
  btnLoadLab: HTMLButtonElement;
  btnSave: HTMLButtonElement;
  btnExport: HTMLButtonElement;
  btnImport: HTMLButtonElement;
  btnNew: HTMLButtonElement;
  btnCamera: HTMLButtonElement;
  btnCode: HTMLButtonElement;
  btnHelp: HTMLButtonElement;
  btnPanelToggle: HTMLButtonElement;
  importFile: HTMLInputElement;
  sampleSel: HTMLSelectElement;
  btnLoadSample: HTMLButtonElement;
  helpOverlay: HTMLElement;
  paletteTools: HTMLElement;
  paletteComponents: HTMLElement;
  wireColors: HTMLElement;
}

export function buildLayout(root: HTMLElement): UIRefs {
  root.innerHTML = `
    <header id="toolbar">
      <div class="brand">⚡ Virtual <span>Breadboard</span> Lab</div>
      <div class="tb-group">
        <button id="btn-run" class="primary" title="Run program (R)">▶ Run</button>
        <button id="btn-stop" title="Stop program (R)">■ Stop</button>
        <button id="btn-reset" title="Reset simulation state">⟲ Reset</button>
        <span id="sim-time">0.00 s</span>
        <select id="speed" title="Simulation speed">
          <option value="0.25">0.25×</option>
          <option value="1" selected>1×</option>
          <option value="4">4×</option>
        </select>
      </div>
      <div class="tb-group">
        <label style="color:var(--muted)">Lab</label>
        <select id="lab-select"></select>
        <button id="btn-load-lab" title="Load the starter circuit for this lab">Load starter</button>
      </div>
      <div class="tb-group">
        <button id="btn-save" title="Save to browser storage">Save</button>
        <button id="btn-export" title="Download project JSON">Export</button>
        <button id="btn-import" title="Import project JSON">Import</button>
        <button id="btn-new" title="Clear the workbench">New</button>
      </div>
      <div class="tb-group">
        <button id="btn-code" title="Toggle the block editor">🧩 Code</button>
        <button id="btn-camera" title="Reset camera (0)">🎥 Camera</button>
        <button id="btn-help" title="Help & shortcuts">?</button>
        <button id="btn-panel-toggle" title="Toggle panels">☰</button>
      </div>
    </header>
    <div id="workspace">
      <aside id="palette">
        <h4>Tools</h4>
        <div id="palette-tools"></div>
        <div id="wire-colors"></div>
        <h4>Components</h4>
        <div id="palette-components" style="display:flex;flex-direction:column;gap:5px"></div>
      </aside>
      <div id="canvas-wrap">
        <div id="canvas-area">
          <canvas id="three-canvas" tabindex="0"></canvas>
          <div id="statusbar">
            <div id="status-mode"></div>
            <div id="status-hover">Hover a hole or pin to inspect it</div>
          </div>
        </div>
        <div id="drawer">
          <div id="drawer-header">
            <strong style="font-size:12.5px">BLOCK PROGRAM</strong>
            <select id="sample-select">
              ${SAMPLE_PROGRAMS.map((s) => `<option value="${s.id}">${s.name}</option>`).join('')}
            </select>
            <button id="btn-load-sample">Load sample</button>
            <span class="status" id="drawer-status">Blocks compile automatically when you press Run.</span>
          </div>
          <div id="blockly-host"></div>
        </div>
      </div>
      <aside id="sidepanel">
        <nav id="tabs">
          <button data-tab="lab" class="active">Lab</button>
          <button data-tab="explain">Circuit</button>
          <button data-tab="model">Model</button>
          <button data-tab="issues">Issues<span class="badge hidden" id="badge-issues"></span></button>
          <button data-tab="tools">Tools</button>
          <button data-tab="serial">Serial<span class="badge warn hidden" id="badge-serial"></span></button>
        </nav>
        <div id="panel-body"></div>
      </aside>
    </div>
    <input type="file" id="import-file" accept=".json,application/json" style="display:none" />
    <div id="help-overlay" class="hidden">
      <div id="help-card">
        <h2>Virtual Breadboard Lab</h2>
        <p>A 3D educational breadboard simulator. Build circuits, write block programs, and learn how real breadboards behave — including the classic mistakes.</p>
        <h4>Getting around</h4>
        <table>
          <tr><td><b>Orbit</b></td><td>left-drag on empty space</td></tr>
          <tr><td><b>Pan</b></td><td>right-drag (or two-finger drag)</td></tr>
          <tr><td><b>Zoom</b></td><td>scroll wheel</td></tr>
          <tr><td><b>Place parts</b></td><td>pick one in the palette, then click breadboard holes</td></tr>
          <tr><td><b>Wire</b></td><td>wire tool → click a hole/pin, then a second one</td></tr>
          <tr><td><b>Press a button</b></td><td>click and hold the button's red cap</td></tr>
          <tr><td><b>Move a part</b></td><td>drag it to another spot</td></tr>
        </table>
        <h4>Shortcuts</h4>
        <table>
          <tr><td><kbd>Esc</kbd></td><td>cancel tool / clear selection</td></tr>
          <tr><td><kbd>Delete</kbd></td><td>delete selected part or wire</td></tr>
          <tr><td><kbd>R</kbd></td><td>run / stop the program</td></tr>
          <tr><td><kbd>0</kbd></td><td>reset the camera</td></tr>
        </table>
        <p style="text-align:right"><button id="btn-help-close" class="primary">Close</button></p>
      </div>
    </div>
  `;

  const labSel = root.querySelector<HTMLSelectElement>('#lab-select')!;
  for (const lab of LABS) {
    const o = document.createElement('option');
    o.value = lab.id;
    o.textContent = lab.title;
    labSel.appendChild(o);
  }

  const paletteTools = root.querySelector<HTMLElement>('#palette-tools')!;
  paletteTools.style.display = 'flex';
  paletteTools.style.flexDirection = 'column';
  paletteTools.style.gap = '5px';
  const tools: Array<[string, string, string, string]> = [
    ['select', '🖱', 'Select / interact', 'Click parts to select them; click-and-hold buttons to press them; drag parts to move them.'],
    ['wire', '〰', 'Jumper wire', 'Click a hole or pin, then a second one, to run a wire. Pick a colour below.'],
    ['probe', '🔍', 'Logic probe', 'Click any hole or pin to read HIGH / LOW / floating and its voltage.'],
    ['meter', '🔋', 'Multimeter', 'Click two points to measure the voltage between them.'],
  ];
  for (const [id, ico, label, tip] of tools) {
    const b = document.createElement('button');
    b.className = 'pal-btn';
    b.dataset.tool = id;
    b.title = tip;
    b.innerHTML = `<span class="ico">${ico}</span>${label}`;
    paletteTools.appendChild(b);
  }

  const wireColors = root.querySelector<HTMLElement>('#wire-colors')!;
  for (const color of WIRE_COLORS) {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.dataset.color = color;
    b.style.background = color;
    b.title = `Wire colour ${color}`;
    wireColors.appendChild(b);
  }

  const paletteComponents = root.querySelector<HTMLElement>('#palette-components')!;
  const icons: Record<string, string> = {
    led: '💡',
    resistor: '⌁',
    capacitor: '⊨',
    button: '⏺',
    switch: '⇄',
    pot: '🎛',
    ic555: '▭',
    ic74hc00: '▭',
    ic74hc04: '▭',
    ic74hc595: '▭',
    sevenseg: '8',
  };
  for (const def of componentDefs.values()) {
    const b = document.createElement('button');
    b.className = 'pal-btn';
    b.dataset.component = def.type;
    b.title = def.paletteHint;
    b.innerHTML = `<span class="ico">${icons[def.type] ?? '▫'}</span>${def.name}`;
    paletteComponents.appendChild(b);
  }

  return {
    canvas: root.querySelector('#three-canvas')!,
    statusHover: root.querySelector('#status-hover')!,
    statusMode: root.querySelector('#status-mode')!,
    drawer: root.querySelector('#drawer')!,
    blocklyHost: root.querySelector('#blockly-host')!,
    drawerStatus: root.querySelector('#drawer-status')!,
    panelBody: root.querySelector('#panel-body')!,
    tabs: root.querySelector('#tabs')!,
    sidepanel: root.querySelector('#sidepanel')!,
    btnRun: root.querySelector('#btn-run')!,
    btnStop: root.querySelector('#btn-stop')!,
    btnReset: root.querySelector('#btn-reset')!,
    simTime: root.querySelector('#sim-time')!,
    speedSel: root.querySelector('#speed')!,
    labSel,
    btnLoadLab: root.querySelector('#btn-load-lab')!,
    btnSave: root.querySelector('#btn-save')!,
    btnExport: root.querySelector('#btn-export')!,
    btnImport: root.querySelector('#btn-import')!,
    btnNew: root.querySelector('#btn-new')!,
    btnCamera: root.querySelector('#btn-camera')!,
    btnCode: root.querySelector('#btn-code')!,
    btnHelp: root.querySelector('#btn-help')!,
    btnPanelToggle: root.querySelector('#btn-panel-toggle')!,
    importFile: root.querySelector('#import-file')!,
    sampleSel: root.querySelector('#sample-select')!,
    btnLoadSample: root.querySelector('#btn-load-sample')!,
    helpOverlay: root.querySelector('#help-overlay')!,
    paletteTools,
    paletteComponents,
    wireColors,
  };
}
