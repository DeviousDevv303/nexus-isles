// Nexus Isles — the map: regions, edges, chokepoints, and line of sight.
//
// A map is a graph. Regions are where residents and resource nodes are;
// edges are how residents move. An edge may carry a crossing capacity (a
// bridge, a river crossing): at most that many residents cross it per tick,
// and when more try, contention-v1 decides who gets through. Edges without a
// capacity are open roads.
//
// Observation radius is graph distance. A resident with intel r perceives
// every region within r hops of where they stand, and nothing else.

export type RegionKind = "district" | "industrial" | "river" | "desert" | "far-shore";
export type EdgeKind = "road" | "bridge" | "river-crossing" | "trail";

export interface Region {
  id: string;
  name: string;
  kind: RegionKind;
  /** Which side of the border the region is on. */
  side: "juarez" | "el-paso";
}

export interface Edge {
  a: string;
  b: string;
  kind: EdgeKind;
  name?: string;
  /** Max crossings per tick, both directions combined. Omitted = unlimited. */
  crossingCapacity?: number;
}

export interface MapSpec {
  id: string;
  regions: Region[];
  edges: Edge[];
}

/** Direction-independent key for an edge. */
export const edgeKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

export function findEdge(map: MapSpec, a: string, b: string): Edge | undefined {
  const k = edgeKey(a, b);
  return map.edges.find((e) => edgeKey(e.a, e.b) === k);
}

export function neighbours(map: MapSpec, region: string): string[] {
  const out = new Set<string>();
  for (const e of map.edges) {
    if (e.a === region) out.add(e.b);
    if (e.b === region) out.add(e.a);
  }
  return [...out].sort();
}

/** Regions within `radius` hops of `from`, including `from`, sorted. */
export function regionsWithin(map: MapSpec, from: string, radius: number): string[] {
  const seen = new Set([from]);
  let frontier = [from];
  for (let d = 0; d < radius; d++) {
    const next: string[] = [];
    for (const r of frontier) {
      for (const n of neighbours(map, r)) {
        if (!seen.has(n)) {
          seen.add(n);
          next.push(n);
        }
      }
    }
    frontier = next;
  }
  return [...seen].sort();
}

export function validateMap(map: MapSpec): void {
  const ids = new Set<string>();
  for (const r of map.regions) {
    if (!r.id || ids.has(r.id)) throw new Error(`map ${map.id}: duplicate or empty region id ${r.id}`);
    ids.add(r.id);
  }
  const keys = new Set<string>();
  for (const e of map.edges) {
    if (!ids.has(e.a) || !ids.has(e.b) || e.a === e.b) {
      throw new Error(`map ${map.id}: edge ${e.a}-${e.b} must join two distinct known regions`);
    }
    const k = edgeKey(e.a, e.b);
    if (keys.has(k)) throw new Error(`map ${map.id}: duplicate edge ${k}`);
    keys.add(k);
    if (e.crossingCapacity !== undefined && !(Number.isSafeInteger(e.crossingCapacity) && e.crossingCapacity >= 1)) {
      throw new Error(`map ${map.id}: edge ${k} crossingCapacity must be an integer >= 1`);
    }
  }
  // Every region must be reachable: a map with islands nobody can reach
  // would make observation radius and travel meaningless there.
  if (map.regions.length > 0 && regionsWithin(map, map.regions[0].id, map.regions.length).length !== map.regions.length) {
    throw new Error(`map ${map.id}: every region must be reachable`);
  }
}
