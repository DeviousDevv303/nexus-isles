// Nexus Isles — world viewer: the game view's data model (read-only).
//
// The auditor's surface renders the world as text: region boxes, edge
// lists, resident tables. That is the evidence surface, and it stays.
// This module derives the GAME view from the same replayed frames: a
// schematic map of the two river banks with the crossings between them,
// resource nodes with their stock, and resident markers — all positioned
// from the journaled map's own data (each region's side, the edges and
// their kinds), never from invented geography. Positions are a diagram:
// bridge endpoints face each other across the river band because the
// journaled edges say those regions are joined by a bridge, and desert
// approaches sit at the far edge of their bank because trails are the
// only edges that reach them. Nothing here reads anything the replay did
// not already produce, and nothing here can act on the world.

import type { MapSpec } from "../engine/world/map.js";
import type { NodeState, ResidentState } from "../engine/world/state.js";

/** One region's anchor point on the schematic map (SVG user units). */
export interface RegionPoint {
  x: number;
  y: number;
}

export interface GameLayout {
  /** SVG viewBox width/height the positions were laid out for. */
  width: number;
  height: number;
  /** The river band's vertical extent: el-paso anchors sit above it, juarez below. */
  riverTop: number;
  riverBottom: number;
  /** Anchor point per region id. Covers every region of the map. */
  positions: Record<string, RegionPoint>;
}

export interface GameNodeMark {
  id: string;
  region: string;
  amount: number;
  capacity: number;
  regen: number;
}

export interface GameResidentMark {
  id: string;
  region: string | null;
  alive: boolean;
  satiety: number;
  maxSatiety: number;
  inventory: number;
  lineage: string;
  bornTick: number;
  diedAtTick: number | null;
}

/** Everything the game view draws for one committed frame. */
export interface GameFrameModel {
  layout: GameLayout;
  nodes: GameNodeMark[];
  residents: GameResidentMark[];
}

const WIDTH = 960;
const HEIGHT = 640;

/**
 * Schematic anchors for the Juárez map (map id juarez-v1), derived from
 * the map data alone: side decides the bank; each bridge's two endpoints
 * share an x so the crossing draws straight over the river; the river
 * crossing leaves from anapra, the map's one "river" region; regions the
 * trails reach (sierra-de-juarez, samalayuca) sit at the bank's far edge.
 * Keyed by region id — a journaled map that renames or adds regions
 * falls back per-region to the generic placement in layoutForMap.
 */
const JUAREZ_ANCHORS: Record<string, RegionPoint> = {
  // El Paso bank (north of the river band)
  "el-paso-downtown": { x: 400, y: 150 },
  chamizal: { x: 600, y: 118 },
  ysleta: { x: 792, y: 158 },
  // Juárez bank (south of the river band)
  anapra: { x: 148, y: 468 },
  centro: { x: 400, y: 478 },
  pronaf: { x: 600, y: 448 },
  zaragoza: { x: 800, y: 468 },
  "industrial-east": { x: 682, y: 566 },
  "industrial-south": { x: 468, y: 576 },
  "sierra-de-juarez": { x: 140, y: 580 },
  samalayuca: { x: 300, y: 588 },
};

/**
 * Lay a map out on the schematic canvas. Every region gets an anchor:
 * the curated Juárez anchors where the region id is known, otherwise a
 * deterministic grid slot on the region's own bank (below the curated
 * rows on the juarez side, above them on the el-paso side), so a future
 * map still renders whole instead of dropping regions silently.
 */
export function layoutForMap(map: MapSpec): GameLayout {
  const riverTop = 292;
  const riverBottom = 336;
  const positions: Record<string, RegionPoint> = {};
  const missing: { id: string; side: string }[] = [];
  for (const region of map.regions) {
    const anchor = map.id === "juarez-v1" ? JUAREZ_ANCHORS[region.id] : undefined;
    if (anchor) positions[region.id] = { ...anchor };
    else missing.push({ id: region.id, side: region.side });
  }
  // Generic slots for regions without a curated anchor: a row of slots
  // per bank, filled in region-id order so the layout is deterministic.
  const slot = (side: string, i: number): RegionPoint => {
    const col = i % 5;
    const row = Math.floor(i / 5);
    return side === "el-paso"
      ? { x: 110 + col * 185, y: 52 + row * 84 }
      : { x: 110 + col * 185, y: 396 + row * 84 };
  };
  const perSide: Record<string, number> = {};
  for (const m of missing.sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const i = perSide[m.side] ?? 0;
    perSide[m.side] = i + 1;
    let p = slot(m.side, i);
    // Never stack two regions on one point: nudge down-bank until free.
    while (Object.values(positions).some((q) => Math.abs(q.x - p.x) < 120 && Math.abs(q.y - p.y) < 70)) {
      p = { x: p.x, y: p.y + (m.side === "el-paso" ? -84 : 84) };
    }
    positions[m.id] = p;
  }
  return { width: WIDTH, height: HEIGHT, riverTop, riverBottom, positions };
}

/** The game view's per-frame model: layout + node stock + resident marks. */
export function gameModelForFrame(
  map: MapSpec,
  nodes: Record<string, NodeState>,
  residents: Record<string, ResidentState>,
): GameFrameModel {
  return {
    layout: layoutForMap(map),
    nodes: Object.entries(nodes)
      .filter(([, n]) => n.region !== null)
      .map(([id, n]) => ({ id, region: n.region as string, amount: n.amount, capacity: n.capacity, regen: n.regen }))
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
    residents: Object.entries(residents)
      .map(([id, r]) => ({
        id,
        region: r.position,
        alive: r.alive,
        satiety: r.satiety,
        maxSatiety: r.maxSatiety,
        inventory: r.inventory,
        lineage: r.lineage,
        bornTick: r.bornTick,
        diedAtTick: r.diedAtTick,
      }))
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
  };
}
