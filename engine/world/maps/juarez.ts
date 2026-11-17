// Nexus Isles — Phase 1's first environment: Ciudad Juárez, the border town
// (owner direction, #235 comment 6929769362). Tone reference: Sicario — tense,
// procedural borderland. Tone has no mechanical effect.
//
// The places are real; the model is abstract. Regions are districts and
// approaches, not to scale. The three international bridges are the
// chokepoints (crossing capacity per tick); the Rio Grande can also be
// crossed off-bridge at one point, at a lower capacity. El Paso is the far
// shore. Resource nodes stand in for the placeholder economy (food) until
// the real economy lands; their placement says where scarcity is, nothing
// more. Every number here is a Phase 1 proposal, not law.
// PROVISIONAL — owner-ratification item (registry: map-v1).

import type { MapSpec } from "../map.js";
import type { NodeConfig, ResidentConfig, Rules, WorldConfig } from "../state.js";

export const JUAREZ_MAP_ID = "juarez-v1";

export function juarezMap(): MapSpec {
  return {
    id: JUAREZ_MAP_ID,
    regions: [
      { id: "centro", name: "Centro Histórico", kind: "district", side: "juarez" },
      { id: "pronaf", name: "PRONAF", kind: "district", side: "juarez" },
      { id: "anapra", name: "Anapra", kind: "river", side: "juarez" },
      { id: "industrial-east", name: "Eastern maquiladora parks", kind: "industrial", side: "juarez" },
      { id: "zaragoza", name: "Zaragoza", kind: "district", side: "juarez" },
      { id: "industrial-south", name: "Southern industrial corridor", kind: "industrial", side: "juarez" },
      { id: "sierra-de-juarez", name: "Sierra de Juárez approach", kind: "desert", side: "juarez" },
      { id: "samalayuca", name: "Samalayuca approach", kind: "desert", side: "juarez" },
      { id: "el-paso-downtown", name: "Downtown El Paso", kind: "far-shore", side: "el-paso" },
      { id: "chamizal", name: "Chamizal", kind: "far-shore", side: "el-paso" },
      { id: "ysleta", name: "Ysleta", kind: "far-shore", side: "el-paso" },
    ],
    edges: [
      // Juárez side roads
      { a: "centro", b: "pronaf", kind: "road" },
      { a: "centro", b: "anapra", kind: "road" },
      { a: "pronaf", b: "industrial-east", kind: "road" },
      { a: "industrial-east", b: "zaragoza", kind: "road" },
      { a: "centro", b: "industrial-south", kind: "road" },
      { a: "industrial-east", b: "industrial-south", kind: "road" },
      // desert approaches
      { a: "anapra", b: "sierra-de-juarez", kind: "trail" },
      { a: "industrial-south", b: "samalayuca", kind: "trail" },
      // El Paso side roads
      { a: "el-paso-downtown", b: "chamizal", kind: "road" },
      { a: "chamizal", b: "ysleta", kind: "road" },
      // the border: the three international bridges are the chokepoints
      { a: "centro", b: "el-paso-downtown", kind: "bridge", name: "Paso del Norte", crossingCapacity: 2 },
      { a: "pronaf", b: "chamizal", kind: "bridge", name: "Bridge of the Americas", crossingCapacity: 3 },
      { a: "zaragoza", b: "ysleta", kind: "bridge", name: "Ysleta–Zaragoza", crossingCapacity: 2 },
      // the river itself, off-bridge
      { a: "anapra", b: "el-paso-downtown", kind: "river-crossing", name: "Rio Grande", crossingCapacity: 1 },
    ],
  };
}

export function juarezNodes(): NodeConfig[] {
  return [
    { id: "mercado-centro", capacity: 20, amount: 20, regen: 3, region: "centro" },
    { id: "maquila-commissary", capacity: 25, amount: 25, regen: 4, region: "industrial-east" },
    { id: "zaragoza-market", capacity: 12, amount: 12, regen: 2, region: "zaragoza" },
    { id: "el-paso-depot", capacity: 30, amount: 30, regen: 5, region: "el-paso-downtown" },
    { id: "ysleta-stores", capacity: 15, amount: 15, regen: 2, region: "ysleta" },
    { id: "desert-cache", capacity: 8, amount: 8, regen: 0, region: "samalayuca" },
  ];
}

export const JUAREZ_RULES: Rules = {
  satietyDecay: 1,
  maxGatherPerAction: 4,
  blightPercent: 10,
  blightMax: 2,
};

/** Phase 1 shape: one environment, residents placed where the owner says. */
export function juarezConfig(residents: ResidentConfig[]): WorldConfig {
  return { map: juarezMap(), nodes: juarezNodes(), residents, rules: { ...JUAREZ_RULES } };
}
