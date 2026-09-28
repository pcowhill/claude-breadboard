# Asset inventory

Policy: open-license assets are used where they materially improve the app;
everything geometric is procedural Three.js geometry (electronics parts are
simple shapes, and procedural models keep the app light and robust). Every
asset and every procedural fallback is listed here.

## External assets (downloaded, committed to the repo)

| Asset | Source | License | Local path | Used for | Status |
| --- | --- | --- | --- | --- | --- |
| Wood Table 001 — diffuse, 2K JPG | https://polyhaven.com/a/wood_table_001 (direct: https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/wood_table_001/wood_table_001_diff_2k.jpg) | CC0 (Poly Haven) | `public/textures/wood_table_001_diff_2k.jpg` | Desk surface colour map | Primary (flat-colour fallback if it fails to load) |
| Wood Table 001 — roughness, 2K JPG | https://polyhaven.com/a/wood_table_001 (direct: https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/wood_table_001/wood_table_001_rough_2k.jpg) | CC0 (Poly Haven) | `public/textures/wood_table_001_rough_2k.jpg` | Desk surface roughness map | Primary (constant roughness fallback) |
| Blockly media (sprites, icons, cursors) | https://github.com/google/blockly (`node_modules/blockly/media`, copied at setup) | Apache-2.0 | `public/blockly-media/` | Icons/sprites required by the Blockly editor UI | Primary (sounds disabled) |

Both texture loads have `onError` fallbacks in `src/three/scene.ts`
(flat wood-brown colour + constant roughness), so a missing/failed download
degrades gracefully instead of breaking the scene.

### Why no downloaded 3D models?

Sketchfab and similar model sources were considered, but their download APIs
require authenticated accounts and most breadboard/Arduino models carry
CC-BY/editorial terms and heavy meshes. Since all required parts are simple
prisms/cylinders, procedural geometry was chosen deliberately (allowed by the
project's asset policy) — it keeps the bundle small, guarantees the pin
positions match the electrical model exactly, and avoids license ambiguity.

## Generated / procedural assets (fallback per policy, authored in code)

| Asset | Where | Notes |
| --- | --- | --- |
| Breadboard body + top face | `src/three/boardsMesh.ts` | Rounded box; holes, row/column labels and rail stripes drawn onto a canvas texture from the same layout constants as the electrical model |
| Uno-style MCU board | `src/three/boardsMesh.ts` | Teal PCB with canvas-texture silkscreen ("VBL UNO" — deliberately not Arduino trademarked), black header strips with socket holes, USB shell, power jack, MCU, crystal, reset button, power/L status LEDs |
| Anti-static mat + desk slab | `src/three/scene.ts` | Rounded box + textured box |
| Mat corner label | `src/three/scene.ts` | Canvas texture ("VIRTUAL BREADBOARD LAB") |
| LED (dome + legs + additive glow sprite) | `src/three/componentMeshes.ts` | Emissive scales with simulated current; radial-gradient glow texture generated on a canvas |
| Resistor (capsule + colour bands) | `src/three/componentMeshes.ts` | Band colours computed from the actual resistance value |
| Electrolytic capacitor | `src/three/componentMeshes.ts` | Cylinder with minus-stripe on the minus-pin side |
| Push button / slide switch / potentiometer | `src/three/componentMeshes.ts` | Animated cap travel, lever position, knob rotation |
| DIP ICs (555, 74HC00/04/595) | `src/three/componentMeshes.ts` | Black body, notch, pin-1 dot, part-number canvas label, metal legs |
| 7-segment display | `src/three/componentMeshes.ts` | Segment bars with per-segment emissive driven by the simulation |
| Jumper wires | `src/three/wiresMesh.ts` | Catmull-Rom tube with deterministic per-wire bow so parallel wires don't overlap |
| Probe/multimeter flags, hover/selection rings, ghosts | `src/three/view.ts` | Simple torus/cone markers |
| UI icons | `src/ui/layout.ts` | Unicode/emoji only — no icon font or image assets |

## Sounds

None used (Blockly sounds are disabled; no other audio).
