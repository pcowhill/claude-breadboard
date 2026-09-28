import './style.css';
import * as Blockly from 'blockly';
import type { ComponentTypeId, ProjectData, SnapPoint, ValidationIssue } from './types';
import { snaps } from './core/boards';
import { defOf } from './data/componentDefs';
import { Circuit } from './core/circuit';
import { Simulation } from './core/simulation';
import { validate } from './core/validation';
import { collectUsedPins, type Program } from './core/program/ast';
import { compileWorkspace } from './core/program/compiler';
import { Interpreter, type ProgramIO } from './core/program/interpreter';
import { labById, LABS } from './data/labs';
import { sampleById } from './data/samplePrograms';
import { View, type Selection } from './three/view';
import { injectBlockly } from './ui/blocklyBlocks';
import { buildLayout, WIRE_COLORS, type UIRefs } from './ui/layout';
import { Interaction, type Mode } from './ui/interaction';
import { classify, renderExplainPanel, renderIssuesPanel, renderLabPanel, renderModelPanel, renderSerialPanel, renderToolsPanel } from './ui/panels';
import { clearLocal, downloadJson, loadLocal, parseProject, saveLocal } from './persistence';

type Tab = 'lab' | 'explain' | 'model' | 'issues' | 'tools' | 'serial';

class App {
  ui: UIRefs;
  circuit = new Circuit();
  sim: Simulation;
  view: View;
  interaction: Interaction;
  workspace: Blockly.WorkspaceSvg;
  interpreter: Interpreter;

  labId = 'free';
  speed = 1;
  activeTab: Tab = 'lab';
  serial: Array<{ t: number; text: string }> = [];
  serialUnread = 0;
  issues: ValidationIssue[] = [];
  probeSnapId: string | null = null;
  meterA: string | null = null;
  meterB: string | null = null;
  programPins = { digital: new Set<number>(), analog: new Set<number>() };
  compiled: Program = { scripts: [] };

  private flashTimer = 0;
  private saveTimer = 0;
  private lastPanelRefresh = 0;
  private lastValidate = 0;
  private tickAcc = 0;
  private lastFrame = performance.now();

  constructor() {
    this.ui = buildLayout(document.getElementById('app')!);
    this.sim = new Simulation(this.circuit);
    this.view = new View(this.ui.canvas, this.circuit);

    const io: ProgramIO = {
      pinWrite: (p, v) => this.sim.pinWrite(p, v),
      pinPwm: (p, d) => this.sim.pinPwm(p, d),
      pinToggle: (p) => this.sim.pinToggle(p),
      pinRead: (p) => this.sim.pinRead(p),
      analogRead: (i) => this.sim.analogRead(i),
      print: (line) => this.pushSerial(line),
      highlightPin: (p) => this.sim.highlightedPins.add(`ard.D${p}`),
      setProbeLabel: (t) => {
        this.sim.probeLabel = t;
      },
      now: () => this.sim.time,
    };
    this.interpreter = new Interpreter(io);

    this.workspace = injectBlockly(this.ui.blocklyHost);
    this.workspace.addChangeListener((e: Blockly.Events.Abstract) => {
      if (e.isUiEvent) return;
      this.scheduleSave();
    });

    this.interaction = new Interaction(this.ui.canvas, this.view, this.circuit, {
      hover: (snap) => this.onHover(snap),
      modeChanged: (mode) => this.onModeChanged(mode),
      selectionChanged: () => {
        this.renderPanel();
      },
      probeSet: (snapId) => {
        this.probeSnapId = snapId;
        this.setTab('tools');
      },
      meterSet: (a, b) => {
        this.meterA = a;
        this.meterB = b;
        // resetMeter() fires this with nulls (e.g. on New/Import) — don't
        // hijack whatever panel the user is reading in that case
        if (a || b) this.setTab('tools');
        else if (this.activeTab === 'tools') this.renderPanel();
      },
      flash: (msg) => this.flash(msg),
    });

    this.circuit.on('topology', () => {
      // keep state sane if the selected thing vanished
      const sel = this.interaction.selection;
      if (sel) {
        const exists = sel.kind === 'component' ? this.circuit.components.has(sel.id) : this.circuit.wires.has(sel.id);
        if (!exists) this.interaction.setSelection(null);
      }
      this.runValidation();
      this.scheduleSave();
      if (this.activeTab === 'explain' || this.activeTab === 'tools') this.renderPanel();
    });
    this.circuit.on('props', () => this.scheduleSave());

    this.bindToolbar();
    this.bindPalette();
    this.bindTabs();
    this.bindKeyboard();

    // initial project: saved session or Lab 1 starter
    const saved = loadLocal();
    if (saved) {
      this.applyProject(saved, false);
    } else {
      const lab1 = labById('lab1');
      if (lab1.starter) this.applyProject(lab1.starter, false);
    }
    this.onModeChanged(this.interaction.mode);
    this.renderPanel();
    this.runValidation();

    window.addEventListener('resize', () => this.onResize());
    this.onResize();
    requestAnimationFrame((t) => this.frame(t));
  }

  // -------------------------------------------------------------- main loop

  private frame(now: number) {
    const dtReal = Math.min(250, now - this.lastFrame);
    this.lastFrame = now;

    const dynamic =
      this.sim.programRunning ||
      [...this.circuit.components.values()].some((c) => c.type === 'capacitor' || c.type === 'ic555');
    if (dynamic) {
      this.tickAcc += dtReal * this.speed;
      let ticks = 0;
      // generous budget so slow frames (e.g. software WebGL) keep sim time real
      while (this.tickAcc >= 1 && ticks < 400) {
        this.interpreter.tick();
        this.sim.tick(1);
        this.tickAcc -= 1;
        ticks++;
      }
      if (this.tickAcc > 250) this.tickAcc = 0; // drop backlog after long stalls
    } else {
      this.sim.tick(dtReal * this.speed);
    }

    // a finite program that ran to completion should say so
    if (this.sim.programRunning && this.interpreter.finished) {
      this.sim.programRunning = false;
      this.ui.drawerStatus.textContent = '✔ Program finished (all scripts ran to the end).';
      this.ui.btnRun.textContent = '▶ Run';
      this.ui.btnStop.disabled = true;
    }

    this.view.update(this.sim, dtReal / 1000);

    if (now - this.lastValidate > 600) {
      this.lastValidate = now;
      this.runValidation();
    }
    if (now - this.lastPanelRefresh > 200) {
      this.lastPanelRefresh = now;
      this.refreshLiveReadouts();
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  private onResize() {
    this.view.resize();
    Blockly.svgResize(this.workspace);
  }

  // ------------------------------------------------------------ run control

  run() {
    const { program, warnings } = compileWorkspace(this.workspace);
    this.compiled = program;
    this.programPins = collectUsedPins(program);
    this.sim.resetProgramState();
    this.interpreter.start(program);
    this.sim.programRunning = true;
    this.ui.drawerStatus.textContent = warnings.length ? `⚠ ${warnings.join(' ')}` : `✔ Compiled ${program.scripts.length} script(s). Running…`;
    this.ui.btnRun.textContent = '▶ Restart';
    this.ui.btnStop.disabled = false;
    this.runValidation();
    this.scheduleSave();
  }

  stop() {
    this.interpreter.stop();
    this.sim.programRunning = false;
    this.sim.resetProgramState();
    this.ui.drawerStatus.textContent = 'Program stopped. Circuit stays live (hardware like the 555 keeps running).';
    this.ui.btnRun.textContent = '▶ Run';
    this.ui.btnStop.disabled = true;
  }

  reset() {
    this.stop();
    this.sim.fullReset();
    this.serial = [];
    this.serialUnread = 0;
    if (this.activeTab === 'serial') this.renderPanel();
    this.updateBadges();
    this.flash('Simulation state reset (time, capacitors, registers, serial).');
  }

  // -------------------------------------------------------------- project IO

  currentProject(): ProjectData {
    return {
      version: 1,
      labId: this.labId,
      ...this.circuit.serialize(),
      program: Blockly.serialization.workspaces.save(this.workspace),
      settings: { speed: this.speed },
    };
  }

  applyProject(p: ProjectData, announce = true) {
    this.stop();
    const problems = this.circuit.load(p);
    this.labId = p.labId ?? 'free';
    this.ui.labSel.value = LABS.some((l) => l.id === this.labId) ? this.labId : 'free';
    this.speed = p.settings?.speed ?? 1;
    this.ui.speedSel.value = String(this.speed);
    try {
      Blockly.serialization.workspaces.load((p.program as object) ?? { blocks: { languageVersion: 0, blocks: [] } }, this.workspace);
    } catch (err) {
      this.workspace.clear();
      this.flash('Program in project file could not be loaded; starting with an empty program.');
      console.warn(err);
    }
    this.probeSnapId = null;
    this.meterA = this.meterB = null;
    this.interaction.resetMeter();
    this.view.setProbe(null);
    this.sim.fullReset();
    // stale program pins from a previous run shouldn't warn against the new circuit
    this.compiled = { scripts: [] };
    this.programPins = { digital: new Set(), analog: new Set() };
    this.renderPanel();
    this.runValidation();
    if (problems.length) this.flash(problems[0]);
    else if (announce) this.flash('Project loaded.');
    this.scheduleSave();
  }

  private scheduleSave() {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      saveLocal(this.currentProject());
    }, 600);
  }

  // -------------------------------------------------------------- validation

  private issuesSignature = '';

  runValidation() {
    const staticIssues = validate(this.circuit, this.sim, this.programPins);
    const merged = [...this.sim.runtimeIssues, ...staticIssues];
    const key = (i: ValidationIssue) => `${i.code}|${i.title}|${i.subjects.join(',')}`;
    const seen = new Set<string>();
    this.issues = merged.filter((i) => {
      const k = key(i);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const sig = this.issues.map(key).join('~');
    if (sig === this.issuesSignature) return; // nothing changed — no re-render churn
    this.issuesSignature = sig;
    this.updateBadges();
    if (this.activeTab === 'issues') this.renderPanel();
  }

  private updateBadges() {
    const badge = document.getElementById('badge-issues')!;
    const errors = this.issues.filter((i) => i.severity === 'error').length;
    const warns = this.issues.filter((i) => i.severity === 'warning').length;
    const n = errors + warns;
    badge.textContent = String(n);
    badge.classList.toggle('hidden', n === 0);
    badge.classList.toggle('warn', errors === 0);
    const sBadge = document.getElementById('badge-serial')!;
    sBadge.textContent = String(Math.min(99, this.serialUnread));
    sBadge.classList.toggle('hidden', this.serialUnread === 0);
  }

  private pushSerial(text: string) {
    this.serial.push({ t: this.sim.time, text });
    if (this.serial.length > 500) {
      this.serial.splice(0, this.serial.length - 500);
      this.serialTrimmed = true;
    }
    if (this.activeTab !== 'serial') this.serialUnread++;
    else this.serialDirty = true;
    this.updateBadges();
  }

  private serialDirty = false;
  private serialTrimmed = false;
  private serialRendered = 0;

  // ---------------------------------------------------------------- panels

  setTab(tab: Tab) {
    this.activeTab = tab;
    for (const btn of this.ui.tabs.querySelectorAll('button')) {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    }
    if (tab === 'serial') {
      this.serialUnread = 0;
      this.updateBadges();
    }
    this.renderPanel();
  }

  renderPanel() {
    const body = this.ui.panelBody;
    body.innerHTML = '';
    const lab = labById(this.labId);
    switch (this.activeTab) {
      case 'lab':
        body.appendChild(renderLabPanel(lab, lab.starter ? () => this.loadLabStarter(lab.id) : null));
        break;
      case 'explain':
        body.appendChild(
          renderExplainPanel(lab, {
            comps: this.circuit.components.size,
            wires: this.circuit.wires.size,
            nets: this.sim.netCount,
          }),
        );
        break;
      case 'model':
        body.appendChild(renderModelPanel());
        break;
      case 'issues':
        body.appendChild(
          renderIssuesPanel(this.issues, (subjectId) => {
            if (this.circuit.components.has(subjectId)) this.interaction.setSelection({ kind: 'component', id: subjectId });
            else if (this.circuit.wires.has(subjectId)) this.interaction.setSelection({ kind: 'wire', id: subjectId });
            this.setTab('tools');
          }),
        );
        break;
      case 'tools': {
        const sel = this.interaction.selection;
        const selectedComp = sel?.kind === 'component' ? (this.circuit.components.get(sel.id) ?? null) : null;
        body.appendChild(
          renderToolsPanel(
            {
              probeSnapId: this.probeSnapId,
              probeReading: this.probeSnapId ? this.sim.readingOfSnap(this.probeSnapId) : null,
              probeLabel: this.sim.probeLabel,
              meterA: this.meterA,
              meterB: this.meterB,
              meterVolts: this.meterVolts(),
              selected: selectedComp,
              memberCount: this.probeSnapId ? this.sim.netMembers(this.probeSnapId).length : 0,
            },
            {
              onProp: (k, v) => {
                if (selectedComp) this.circuit.setProp(selectedComp.id, k, v);
              },
              onDelete: () => this.interaction.deleteSelection(),
              onFlipLed: () => {
                if (selectedComp && selectedComp.type === 'led') {
                  const { anode, cathode } = selectedComp.pins;
                  this.circuit.moveComponent(selectedComp.id, { anode: cathode, cathode: anode });
                }
              },
            },
          ),
        );
        break;
      }
      case 'serial':
        body.appendChild(renderSerialPanel(this.serial, () => {
          this.serial = [];
          this.serialRendered = 0;
          this.renderPanel();
        }));
        this.serialRendered = this.serial.length;
        this.serialTrimmed = false;
        break;
    }
  }

  private meterVolts(): number | null {
    if (!this.meterA || !this.meterB) return null;
    const a = this.sim.readingOfSnap(this.meterA);
    const b = this.sim.readingOfSnap(this.meterB);
    if (!Number.isFinite(a.volts) || !Number.isFinite(b.volts)) return NaN;
    return a.volts - b.volts;
  }

  /** cheap 5 Hz updates of live numbers without rebuilding the panel */
  private refreshLiveReadouts() {
    this.ui.simTime.textContent = `${(this.sim.time / 1000).toFixed(2)} s`;
    if (this.activeTab === 'tools') {
      const probeEl = document.getElementById('probe-live');
      if (probeEl && this.probeSnapId) {
        const r = this.sim.readingOfSnap(this.probeSnapId);
        const cls = classify(r);
        probeEl.textContent = `${cls} · ${Number.isFinite(r.volts) ? r.volts.toFixed(2) + ' V' : '—'}`;
        probeEl.className = `big state-${cls}`;
      }
      const meterEl = document.getElementById('meter-live');
      if (meterEl) {
        const v = this.meterVolts();
        meterEl.textContent = v === null || !Number.isFinite(v) ? 'open / floating' : `${v.toFixed(2)} V`;
      }
    }
    if (this.activeTab === 'serial' && this.serialDirty) {
      this.serialDirty = false;
      const log = document.getElementById('serial-log');
      if (!log || this.serialTrimmed || this.serialRendered === 0 || this.serial.length < this.serialRendered) {
        this.renderPanel(); // full render (first lines / after trim / cleared)
      } else {
        // append only the new lines and keep the user's scroll position
        // unless they were already following the tail
        const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 40;
        for (let i = this.serialRendered; i < this.serial.length; i++) {
          const l = this.serial[i];
          const div = document.createElement('div');
          const ts = document.createElement('span');
          ts.className = 't';
          ts.textContent = `[${(l.t / 1000).toFixed(2)}s]`;
          div.appendChild(ts);
          div.appendChild(document.createTextNode(' ' + l.text));
          log.appendChild(div);
        }
        this.serialRendered = this.serial.length;
        if (atBottom) log.scrollTop = log.scrollHeight;
      }
    }
  }

  // ----------------------------------------------------------------- labs

  loadLabStarter(id: string) {
    const lab = labById(id);
    if (!lab.starter) return;
    // deep copy so repeated loads start clean
    this.applyProject(JSON.parse(JSON.stringify(lab.starter)) as ProjectData, false);
    this.labId = lab.id;
    this.ui.labSel.value = lab.id;
    this.flash(`${lab.title} loaded — press Run to start the program.`);
    this.setTab('lab');
  }

  // ------------------------------------------------------------------- UI

  private bindToolbar() {
    this.ui.btnRun.addEventListener('click', () => this.run());
    this.ui.btnStop.addEventListener('click', () => this.stop());
    this.ui.btnStop.disabled = true;
    this.ui.btnReset.addEventListener('click', () => this.reset());
    this.ui.speedSel.addEventListener('change', () => {
      this.speed = Number(this.ui.speedSel.value);
      this.scheduleSave();
    });
    this.ui.labSel.addEventListener('change', () => {
      this.labId = this.ui.labSel.value;
      this.renderPanel();
      this.setTab('lab');
      this.scheduleSave();
    });
    this.ui.btnLoadLab.addEventListener('click', () => this.loadLabStarter(this.ui.labSel.value));
    this.ui.btnSave.addEventListener('click', () => {
      const ok = saveLocal(this.currentProject());
      this.flash(ok ? 'Project saved to browser storage.' : 'Could not save (storage unavailable).');
    });
    this.ui.btnExport.addEventListener('click', () => downloadJson(this.currentProject()));
    this.ui.btnImport.addEventListener('click', () => this.ui.importFile.click());
    this.ui.importFile.addEventListener('change', async () => {
      const file = this.ui.importFile.files?.[0];
      this.ui.importFile.value = '';
      if (!file) return;
      try {
        const project = parseProject(await file.text());
        this.applyProject(project);
      } catch (err) {
        this.flash(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
    this.ui.btnNew.addEventListener('click', () => {
      this.stop();
      this.circuit.clear();
      this.workspace.clear();
      this.labId = 'free';
      this.ui.labSel.value = 'free';
      this.probeSnapId = null;
      this.interaction.resetMeter();
      this.view.setProbe(null);
      this.sim.fullReset();
      clearLocal();
      this.renderPanel();
      this.flash('Workbench cleared.');
    });
    this.ui.btnCamera.addEventListener('click', () => this.view.ctx.resetCamera());
    this.ui.btnCode.addEventListener('click', () => this.toggleDrawer());
    this.ui.btnHelp.addEventListener('click', () => this.ui.helpOverlay.classList.remove('hidden'));
    this.ui.helpOverlay.addEventListener('click', (e) => {
      if (e.target === this.ui.helpOverlay || (e.target as HTMLElement).id === 'btn-help-close') {
        this.ui.helpOverlay.classList.add('hidden');
      }
    });
    this.ui.btnPanelToggle.addEventListener('click', () => this.ui.sidepanel.classList.toggle('open'));
    this.ui.btnLoadSample.addEventListener('click', () => {
      const s = sampleById(this.ui.sampleSel.value);
      if (!s) return;
      try {
        Blockly.serialization.workspaces.load(JSON.parse(JSON.stringify(s.json)), this.workspace);
        this.ui.drawerStatus.textContent = `Loaded sample: ${s.name}. ${s.description}`;
        this.scheduleSave();
      } catch (err) {
        this.ui.drawerStatus.textContent = `Could not load sample: ${err instanceof Error ? err.message : err}`;
      }
    });
  }

  toggleDrawer(open?: boolean) {
    const el = this.ui.drawer;
    const willOpen = open ?? !el.classList.contains('open');
    el.classList.toggle('open', willOpen);
    window.setTimeout(() => this.onResize(), 200);
  }

  private bindPalette() {
    this.ui.paletteTools.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-tool]');
      if (!btn) return;
      switch (btn.dataset.tool) {
        case 'select':
          this.interaction.setMode({ kind: 'select' });
          break;
        case 'wire':
          this.interaction.setMode({ kind: 'wire', from: null, color: this.interaction.wireColor });
          break;
        case 'probe':
          this.interaction.setMode({ kind: 'probe' });
          break;
        case 'meter':
          this.interaction.resetMeter();
          this.interaction.setMode({ kind: 'meter' });
          break;
      }
    });
    this.ui.wireColors.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-color]');
      if (!btn) return;
      this.interaction.wireColor = btn.dataset.color!;
      for (const s of this.ui.wireColors.querySelectorAll('.swatch')) s.classList.toggle('active', s === btn);
      if (this.interaction.mode.kind === 'wire') {
        this.interaction.setMode({ kind: 'wire', from: this.interaction.mode.from, color: btn.dataset.color! });
      } else {
        this.interaction.setMode({ kind: 'wire', from: null, color: btn.dataset.color! });
      }
    });
    const firstSwatch = this.ui.wireColors.querySelector('.swatch');
    firstSwatch?.classList.add('active');
    this.interaction.wireColor = WIRE_COLORS[0];

    this.ui.paletteComponents.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-component]');
      if (!btn) return;
      this.startPlacing(btn.dataset.component as ComponentTypeId);
    });
  }

  startPlacing(type: ComponentTypeId) {
    const def = defOf(type);
    this.interaction.setMode(def.placement === 'two-pin' ? { kind: 'place-two', type, first: null } : { kind: 'place-footprint', type });
  }

  private bindTabs() {
    this.ui.tabs.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-tab]');
      if (btn) this.setTab(btn.dataset.tab as Tab);
    });
  }

  private bindKeyboard() {
    document.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement;
      if (t && (t.closest('input,textarea,select,[contenteditable]') || t.closest('.injectionDiv'))) return;
      switch (e.key) {
        case 'Escape':
          if (!this.ui.helpOverlay.classList.contains('hidden')) {
            this.ui.helpOverlay.classList.add('hidden');
          } else {
            this.interaction.cancel();
          }
          break;
        case 'Delete':
        case 'Backspace':
          this.interaction.deleteSelection();
          e.preventDefault();
          break;
        case 'r':
        case 'R':
          if (this.sim.programRunning) this.stop();
          else this.run();
          break;
        case '0':
          this.view.ctx.resetCamera();
          break;
      }
    });
  }

  private onHover(snap: SnapPoint | null) {
    if (!snap) {
      this.ui.statusHover.textContent = 'Hover a hole or pin to inspect it';
      return;
    }
    const r = this.sim.readingOfSnap(snap.id);
    const cls = classify(r);
    const volts = Number.isFinite(r.volts) ? ` · ${r.volts.toFixed(2)} V (${cls})` : ' · floating';
    this.ui.statusHover.innerHTML = `<b>${snap.label}</b> — ${snap.desc}${volts}`;
  }

  private onModeChanged(mode: Mode) {
    const msgs: Record<string, string> = {
      select: '🖱 Select: click parts, hold buttons, drag to move. Drag empty space to orbit.',
      probe: '🔍 Probe: click any hole or pin to read it.',
      meter: '🔋 Multimeter: click the red-lead point, then the black-lead point.',
    };
    let msg = msgs[mode.kind] ?? '';
    if (mode.kind === 'wire') msg = mode.from ? `〰 Wire from ${mode.from.label}: click the far end (Esc to cancel).` : '〰 Wire: click the first hole or pin.';
    if (mode.kind === 'place-two') msg = mode.first ? `Click a hole for the second leg (Esc to cancel).` : `Click a hole for the first leg.`;
    if (mode.kind === 'place-footprint') msg = 'Click the anchor hole (pin 1 / leftmost pin lands there). Esc to cancel.';
    this.ui.statusMode.textContent = msg;
    // palette active states
    for (const b of this.ui.paletteTools.querySelectorAll<HTMLButtonElement>('button[data-tool]')) {
      const tool = b.dataset.tool;
      b.classList.toggle(
        'active',
        (tool === 'select' && mode.kind === 'select') ||
          (tool === 'wire' && mode.kind === 'wire') ||
          (tool === 'probe' && mode.kind === 'probe') ||
          (tool === 'meter' && mode.kind === 'meter'),
      );
    }
    for (const b of this.ui.paletteComponents.querySelectorAll<HTMLButtonElement>('button[data-component]')) {
      b.classList.toggle('active', (mode.kind === 'place-two' || mode.kind === 'place-footprint') && b.dataset.component === (mode as { type?: string }).type);
    }
  }

  flash(msg: string) {
    this.ui.statusMode.textContent = `⚠ ${msg}`;
    this.ui.statusMode.style.color = 'var(--warn)';
    window.clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => {
      this.ui.statusMode.style.color = '';
      this.onModeChanged(this.interaction.mode);
    }, 3000);
  }
}

const app = new App();

// ---------------------------------------------------------------- test hook
declare global {
  interface Window {
    __lab: unknown;
  }
}
window.__lab = {
  app,
  loadLab: (id: string) => app.loadLabStarter(id),
  loadSample: (id: string) => {
    const s = sampleById(id);
    if (!s) throw new Error(`no sample ${id}`);
    Blockly.serialization.workspaces.load(JSON.parse(JSON.stringify(s.json)), app.workspace);
  },
  loadProject: (p: object) => app.applyProject(parseProject(JSON.stringify(p))),
  run: () => app.run(),
  stop: () => app.stop(),
  reset: () => app.reset(),
  simTime: () => app.sim.time,
  reading: (snapId: string) => app.sim.readingOfSnap(snapId),
  readingOfKey: (key: string) => app.sim.readingOfKey(key),
  ledLevels: () => Object.fromEntries(app.sim.ledLevels),
  segLevels: () => Object.fromEntries(app.sim.segLevels),
  issues: () => app.issues,
  serial: () => app.serial.map((l) => l.text),
  components: () => [...app.circuit.components.values()],
  setProp: (id: string, k: string, v: number | string | boolean) => app.circuit.setProp(id, k, v),
  pressButton: (id: string, pressed: boolean) => app.circuit.setProp(id, 'pressed', pressed),
  toggleDrawer: (open: boolean) => app.toggleDrawer(open),
  setTab: (t: string) => app.setTab(t as never),
  setMode: (m: string) => {
    if (m === 'wire') app.interaction.setMode({ kind: 'wire', from: null, color: app.interaction.wireColor });
  },
  probe: (snapId: string) => {
    app.probeSnapId = snapId;
    app.setTab('tools');
  },
  snapIds: () => snaps.all.map((s) => s.id),
  screenPosOfSnap: (snapId: string) => app.view.screenPosOfSnap(snapId, app.ui.canvas),
  wires: () => [...app.circuit.wires.values()],
};
