// Nexus Isles — review gates RG-1..RG-5 as mechanical checks.
//
// Owner ruling 2026-11-17 (#235, 6937254884, item 5): the review gates
// "must become enforceable checks, not review etiquette". These are pure
// functions over a snapshot of the repo (path -> text), so each gate can be
// shown to fire on a planted violation (tests/governance/rg-gates.test.ts).
//
//   RG-1  a provisional interpretation implemented but undocumented
//         -> every exported constant in policy code is registered; every
//            PROVISIONAL entry is marked, by id, in its code
//   RG-2  documented but missing from tests -> every PROVISIONAL entry is
//         referenced, by id, from at least one existing test file
//   RG-3  agent consensus presented as owner authorization -> a code
//         comment invoking an owner ruling must cite a ruling id listed in
//         governance/owner-rulings.json
//   RG-4  a provisional constant silently promoted -> RATIFIED needs an
//         owner ruling id; CONSTITUTIONAL needs a reference found in the
//         cited constitution text
//   RG-5  a comment claiming constitutional authority without a citation;
//         and RESERVED items (territory control) must not be implemented
//   E6.7  the observer is read-only and permission-blind -> nothing in the
//         engine, seats, lineage, residents or console imports observer/
//
// Honest scope: these are text and import-graph checks. They catch the
// failure modes named above when they show up in the forms named above;
// they do not understand intent, and they cannot tell who wrote a #235
// comment (every lane posts through one account).

export type Repo = ReadonlyMap<string, string>;

export interface RegistryEntry {
  id: string;
  status: "PROVISIONAL" | "CONSTITUTIONAL" | "RATIFIED" | "STRUCTURAL" | "RESERVED";
  why?: string;
  symbols?: { file: string; name: string }[];
  markers?: string[];
  tests?: string[];
  source?: { doc: string; ref: string } | { ruling: string };
  tripwire?: string;
}
export interface Registry {
  entries: RegistryEntry[];
}
export interface OwnerRulings {
  rulings: { id: string }[];
}

export interface Violation {
  gate: "registry" | "RG-1" | "RG-2" | "RG-3" | "RG-4" | "RG-5" | "E6";
  file?: string;
  line?: number;
  message: string;
}

/** Directories holding policy code (validation path plus the observer). */
export const POLICY_DIRS = ["engine/", "lineage/", "seats/", "residents/", "console/", "observer/"];
/** Directories that must never import the observer (E6 clause 7). */
export const NO_OBSERVER_DIRS = ["engine/", "lineage/", "seats/", "residents/", "console/"];

const isPolicyTs = (p: string) => p.endsWith(".ts") && POLICY_DIRS.some((d) => p.startsWith(d));

function commentText(line: string): string | null {
  const t = line.trim();
  if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return t;
  const i = line.indexOf("//");
  return i >= 0 ? line.slice(i) : null;
}

const STATUSES = new Set(["PROVISIONAL", "CONSTITUTIONAL", "RATIFIED", "STRUCTURAL", "RESERVED"]);

export function checkRegistryShape(reg: Registry): Violation[] {
  const out: Violation[] = [];
  const seen = new Set<string>();
  for (const e of reg.entries) {
    if (!e.id || seen.has(e.id)) out.push({ gate: "registry", message: `duplicate or empty registry id "${e.id}"` });
    seen.add(e.id);
    if (!STATUSES.has(e.status)) out.push({ gate: "registry", message: `${e.id}: unknown status ${e.status}` });
  }
  return out;
}

/** RG-1: every exported constant in policy code is registered, and every registered symbol exists. */
export function checkRg1Constants(repo: Repo, reg: Registry): Violation[] {
  const out: Violation[] = [];
  const registered = new Set(reg.entries.flatMap((e) => (e.symbols ?? []).map((s) => `${s.file}#${s.name}`)));
  for (const [path, text] of repo) {
    if (!isPolicyTs(path)) continue;
    text.split("\n").forEach((line, i) => {
      const m = /^export const ([A-Za-z0-9_]+)\s*(?::[^=]+)?=/.exec(line);
      if (m && /^[A-Z][A-Z0-9_]*$/.test(m[1]) && !registered.has(`${path}#${m[1]}`)) {
        out.push({ gate: "RG-1", file: path, line: i + 1, message: `exported constant ${m[1]} is not in governance/registry.json` });
      }
    });
  }
  for (const e of reg.entries) {
    for (const s of e.symbols ?? []) {
      const text = repo.get(s.file);
      if (!text || !new RegExp(`^export const ${s.name}\\b`, "m").test(text)) {
        out.push({ gate: "RG-1", file: s.file, message: `${e.id}: registered symbol ${s.name} not found (stale registry)` });
      }
    }
  }
  return out;
}

/** RG-1 (markers) and RG-2 (tests) for PROVISIONAL entries. */
export function checkProvisional(repo: Repo, reg: Registry): Violation[] {
  const out: Violation[] = [];
  for (const e of reg.entries.filter((x) => x.status === "PROVISIONAL")) {
    if (!e.markers?.length) out.push({ gate: "RG-1", message: `${e.id}: PROVISIONAL entry names no marker file` });
    for (const f of e.markers ?? []) {
      const text = repo.get(f);
      if (!text) out.push({ gate: "RG-1", file: f, message: `${e.id}: marker file missing` });
      else if (!text.split("\n").some((l) => l.includes("PROVISIONAL") && l.includes(e.id))) {
        out.push({ gate: "RG-1", file: f, message: `${e.id}: no line in this file carries both "PROVISIONAL" and the id "${e.id}"` });
      }
    }
    if (!e.tests?.length) out.push({ gate: "RG-2", message: `${e.id}: PROVISIONAL entry names no test` });
    for (const f of e.tests ?? []) {
      const text = repo.get(f);
      if (!text) out.push({ gate: "RG-2", file: f, message: `${e.id}: test file missing` });
      else if (!text.includes(`registry: ${e.id}`)) {
        out.push({ gate: "RG-2", file: f, message: `${e.id}: test file does not reference "registry: ${e.id}"` });
      }
    }
  }
  return out;
}

const OWNER_CLAIM = /\bowner[- ]?(ruling|direction|decision|approval|approved|ratified|ratification)\b/i;
const RULING_ID = /\b(\d{10})\b/g;

/** RG-3: comments invoking owner authority cite a listed ruling. */
export function checkRg3(repo: Repo, rulings: OwnerRulings): Violation[] {
  const known = new Set(rulings.rulings.map((r) => r.id));
  const out: Violation[] = [];
  for (const [path, text] of repo) {
    if (!isPolicyTs(path)) continue;
    text.split("\n").forEach((line, i) => {
      const c = commentText(line);
      // "owner-ratification item" is BR-1's PENDING marker, not a claim of authority.
      if (!c || !OWNER_CLAIM.test(c.replace(/owner[- ]ratification item/gi, ""))) return;
      const ids = [...c.matchAll(RULING_ID)].map((m) => m[1]);
      if (!ids.some((id) => known.has(id))) {
        out.push({ gate: "RG-3", file: path, line: i + 1, message: `comment invokes owner authority without a ruling id from governance/owner-rulings.json: ${c.slice(0, 90)}` });
      }
    });
  }
  return out;
}

/** RG-4: nothing is RATIFIED or CONSTITUTIONAL without its source. */
export function checkRg4(repo: Repo, reg: Registry, rulings: OwnerRulings): Violation[] {
  const known = new Set(rulings.rulings.map((r) => r.id));
  const out: Violation[] = [];
  for (const e of reg.entries) {
    if (e.status === "RATIFIED") {
      const id = e.source && "ruling" in e.source ? e.source.ruling : undefined;
      if (!id || !known.has(id)) out.push({ gate: "RG-4", message: `${e.id}: RATIFIED without an owner ruling id listed in governance/owner-rulings.json` });
    }
    if (e.status === "CONSTITUTIONAL") {
      const src = e.source && "doc" in e.source ? e.source : undefined;
      const doc = src ? repo.get(src.doc) : undefined;
      if (!src || !doc || !doc.includes(src.ref)) out.push({ gate: "RG-4", message: `${e.id}: CONSTITUTIONAL without a reference found in the cited document` });
    }
  }
  return out;
}

const CONSTITUTION_CLAIM = /\b(constitutional(ly)?\s+(law|requires?|required|mandates?|mandated)|required by the constitution|the constitution (requires|mandates|says))\b/i;
const CITATION = /\b(AA\d+|AT-\d+|E\d+|Annex [A-Z])\b/;

/** RG-5: constitutional-authority claims carry a citation; RESERVED items are not implemented. */
export function checkRg5(repo: Repo, reg: Registry): Violation[] {
  const out: Violation[] = [];
  for (const [path, text] of repo) {
    if (!isPolicyTs(path)) continue;
    text.split("\n").forEach((line, i) => {
      const c = commentText(line);
      if (c && CONSTITUTION_CLAIM.test(c) && !CITATION.test(c)) {
        out.push({ gate: "RG-5", file: path, line: i + 1, message: `comment claims constitutional authority without citing AA/AT/E/Annex: ${c.slice(0, 90)}` });
      }
    });
  }
  for (const e of reg.entries.filter((x) => x.status === "RESERVED" && x.tripwire)) {
    const re = new RegExp(e.tripwire as string);
    for (const [path, text] of repo) {
      if (!path.endsWith(".ts") || path.startsWith("tests/") || path.startsWith("tools/")) continue;
      text.split("\n").forEach((line, i) => {
        if (re.test(line)) out.push({ gate: "RG-5", file: path, line: i + 1, message: `${e.id} is RESERVED; this line implements or names it` });
      });
    }
  }
  return out;
}

interface ImportEdge {
  from: string;
  to: string;
  spec: string;
  line: number;
}

function normalizedPath(path: string): string {
  const parts: string[] = [];
  for (const segment of path.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return parts.join("/");
}

/** Resolve source forms emitted by TypeScript/Node against the checked-out snapshot. */
function resolveRelative(repo: Repo, from: string, spec: string): string | undefined {
  const base = normalizedPath([...from.split("/").slice(0, -1), ...spec.split("/")].join("/"));
  const extensionless = base.replace(/\.(?:[cm]?js|jsx|tsx?)$/, "");
  const candidates = [
    base,
    extensionless,
    `${extensionless}.ts`, `${extensionless}.tsx`, `${extensionless}.js`, `${extensionless}.jsx`, `${extensionless}.json`,
    `${extensionless}/index.ts`, `${extensionless}/index.tsx`, `${extensionless}/index.js`,
  ];
  return candidates.find((candidate) => repo.has(candidate));
}

function importEdges(repo: Repo): { edges: ImportEdge[]; unresolved: Violation[] } {
  const edges: ImportEdge[] = [];
  const unresolved: Violation[] = [];
  for (const [from, text] of repo) {
    if (!/\.(?:ts|tsx|js|jsx)$/.test(from)) continue;
    text.split("\n").forEach((line, index) => {
      for (const match of line.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
        const spec = match[1];
        if (!spec.startsWith(".")) continue;
        const to = resolveRelative(repo, from, spec);
        if (!to) unresolved.push({ gate: "E6", file: from, line: index + 1, message: `unresolved relative import ${spec} in the checked-out snapshot` });
        else edges.push({ from, to, spec, line: index + 1 });
      }
    });
  }
  return { edges, unresolved };
}

/** E6 clause 7: no relative import path from validation code can reach observer/. */
export function checkObserverImports(repo: Repo): Violation[] {
  const { edges, unresolved } = importEdges(repo);
  const outgoing = new Map<string, ImportEdge[]>();
  for (const edge of edges) outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
  const unresolvedByFile = new Map<string, Violation[]>();
  for (const violation of unresolved) unresolvedByFile.set(violation.file as string, [...(unresolvedByFile.get(violation.file as string) ?? []), violation]);
  const out: Violation[] = [];
  const reportedUnresolved = new Set<string>();
  const reportedObserverEdges = new Set<string>();
  const isObserver = (path: string) => path === "observer" || path.startsWith("observer/");

  for (const root of repo.keys()) {
    if (!root.endsWith(".ts") || !NO_OBSERVER_DIRS.some((dir) => root.startsWith(dir))) continue;
    const queue: Array<{ path: string; chain: ImportEdge[] }> = [{ path: root, chain: [] }];
    const visited = new Set([root]);
    while (queue.length) {
      const current = queue.shift() as { path: string; chain: ImportEdge[] };
      for (const violation of unresolvedByFile.get(current.path) ?? []) {
        const key = `${violation.file}:${violation.line}:${violation.message}`;
        if (!reportedUnresolved.has(key)) { reportedUnresolved.add(key); out.push(violation); }
      }
      for (const edge of outgoing.get(current.path) ?? []) {
        const chain = [...current.chain, edge];
        if (isObserver(edge.to)) {
          const edgeKey = `${edge.from}\u0000${edge.to}`;
          if (reportedObserverEdges.has(edgeKey)) continue;
          reportedObserverEdges.add(edgeKey);
          const route = [root, ...chain.map((item) => item.to)].join(" → ");
          out.push({ gate: "E6", file: edge.from, line: edge.line, message: `observer is reachable from validation path: ${route}` });
          continue;
        }
        if (!visited.has(edge.to)) {
          visited.add(edge.to);
          queue.push({ path: edge.to, chain });
        }
      }
    }
  }
  return out;
}

export function checkAll(repo: Repo, reg: Registry, rulings: OwnerRulings): Violation[] {
  return [
    ...checkRegistryShape(reg),
    ...checkRg1Constants(repo, reg),
    ...checkProvisional(repo, reg),
    ...checkRg3(repo, rulings),
    ...checkRg4(repo, reg, rulings),
    ...checkRg5(repo, reg),
    ...checkObserverImports(repo),
  ];
}
