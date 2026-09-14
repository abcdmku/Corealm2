import { forwardRef, memo, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { WORLD_MAP_DETAIL_RENDITIONS, WORLD_MAP_IMAGE_BOUNDS, WORLD_MAP_MINIMAP_RENDITION, WORLD_MAP_TILED_LEVELS } from "../../../../game/src/generated/worldMapFingerprint.js";
import { gameUrl } from "../../model/gameUrl.js";
import { glyphColor, glyphIcon } from "./glyphs.js";
import { LAYERS, round, sameSelection, type Bounds, type Feature, type Layer, type Point, type Road, type Selection } from "./model.js";

/*
  The map. An SVG whose viewBox is world metres with y = -z (the image is north-up, +z north).
  Renditions are chosen by pixels per metre: the 800px minimap when zoomed out, the detail
  renditions in between, and the 600px tiles at the top level, only those intersecting the view.
  Layer groups are memoised on their data and the marker scale so panning only rewrites the
  viewBox; drags render through a local override and commit on release.
*/

export interface View { x: number; z: number; span: number }
export interface MapHandle { fit(bounds: Bounds, padding?: number): void; centre(x: number, z: number, span?: number): void; zoom(factor: number): void; view(): View; focus(): void }
export type Tool = "spawn" | "resource" | "location" | "landmark";

const MIN_SPAN = 6;
const MAX_SPAN = 6000;
const IMAGE = { x: WORLD_MAP_IMAGE_BOUNDS.minX, y: -WORLD_MAP_IMAGE_BOUNDS.maxZ, width: WORLD_MAP_IMAGE_BOUNDS.maxX - WORLD_MAP_IMAGE_BOUNDS.minX, height: WORLD_MAP_IMAGE_BOUNDS.maxZ - WORLD_MAP_IMAGE_BOUNDS.minZ };
const DETAIL = [...WORLD_MAP_DETAIL_RENDITIONS].sort((a, b) => a.width - b.width);
const TILES = WORLD_MAP_TILED_LEVELS[0];
const clampSpan = (span: number) => Math.max(MIN_SPAN, Math.min(MAX_SPAN, span));
const deg = (radians: number | undefined) => ((radians ?? 0) * 180) / Math.PI;

export interface MapCanvasProps {
  features: readonly Feature[];
  roads: readonly Road[];
  layers: Record<Layer, boolean>;
  selection?: Selection;
  /** Anchors of the selected spawn, absolute. */
  anchors: readonly Point[];
  editable: boolean;
  tool?: Tool;
  onSelect: (selection: Selection | undefined) => void;
  onMove: (selection: Selection, point: Point) => void;
  onMoveAnchor: (index: number, offset: Point) => void;
  onNudge: (dx: number, dz: number) => void;
  onPlace: (point: Point, client: { x: number; y: number }) => void;
  onViewChange: (view: View, size: { width: number; height: number }) => void;
  onEscape: () => void;
}

type Drag =
  | { kind: "pan"; startX: number; startY: number; view: View; moved: boolean }
  | { kind: "move"; feature: Feature; startX: number; startY: number; origin: Point; moved: boolean }
  | { kind: "anchor"; index: number; startX: number; startY: number; origin: Point; moved: boolean }
  | { kind: "place"; startX: number; startY: number; moved: boolean };

export const MapCanvas = forwardRef<MapHandle, MapCanvasProps>(function MapCanvas({ features, roads, layers, selection, anchors, editable, tool, onSelect, onMove, onMoveAnchor, onNudge, onPlace, onViewChange, onEscape }, ref) {
  const frame = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [view, setView] = useState<View>({ x: 300, z: 300, span: 2200 });
  const [hover, setHover] = useState<Feature | undefined>(undefined);
  const [liveMove, setLiveMove] = useState<{ key: string; x: number; z: number } | undefined>(undefined);
  const [liveAnchor, setLiveAnchor] = useState<{ index: number; point: Point } | undefined>(undefined);
  const drag = useRef<Drag | undefined>(undefined);
  const viewRef = useRef(view); viewRef.current = view;
  const sizeRef = useRef(size); sizeRef.current = size;

  const aspect = size.height / size.width;
  const marker = view.span / 180;
  const pixelsPerMetre = size.width / view.span;
  const selectedKey = selection ? keyOf(selection, features) : undefined;

  useImperativeHandle(ref, () => ({
    fit(bounds, padding = 1.12) {
      const width = Math.max(bounds.maxX - bounds.minX, 20), height = Math.max(bounds.maxZ - bounds.minZ, 20);
      const ratio = sizeRef.current.height / sizeRef.current.width;
      setView({ x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2, span: clampSpan(Math.max(width, height / ratio) * padding) });
    },
    centre(x, z, span) { setView(current => ({ x, z, span: clampSpan(span ?? current.span) })); },
    zoom(factor) { setView(current => ({ ...current, span: clampSpan(current.span * factor) })); },
    view: () => viewRef.current,
    focus: () => frame.current?.focus(),
  }), []);

  useLayoutEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => { const rect = entries[0]?.contentRect; if (rect && rect.width > 0 && rect.height > 0) setSize({ width: rect.width, height: rect.height }); });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    // React registers wheel listeners as passive; the map needs to stop the page scrolling.
    const element = svg.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const cursor = toWorld(element, event.clientX, event.clientY);
      if (!cursor) return;
      const factor = Math.exp(Math.sign(event.deltaY) * Math.min(Math.abs(event.deltaY), 60) * (event.ctrlKey ? 0.012 : 0.006));
      setView(current => {
        const span = clampSpan(current.span * factor);
        const ratio = span / current.span;
        return { x: cursor[0] - (cursor[0] - current.x) * ratio, z: cursor[1] - (cursor[1] - current.z) * ratio, span };
      });
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => onViewChange(view, size), 120);
    return () => clearTimeout(timer);
  }, [view, size, onViewChange]);

  // ---------------------------------------------------------------- pointer handling

  function worldPoint(event: { clientX: number; clientY: number }): Point { return toWorld(svg.current, event.clientX, event.clientY) ?? [0, 0]; }
  function featureAt(target: EventTarget | null): Feature | undefined {
    const element = (target as Element | null)?.closest?.("[data-key]");
    const key = element?.getAttribute("data-key");
    return key ? features.find(feature => feature.key === key) : undefined;
  }
  function placeTip(event: { clientX: number; clientY: number }) {
    const element = tip.current;
    if (!element) return;
    const left = Math.min(event.clientX + 14, window.innerWidth - element.offsetWidth - 8);
    const top = Math.min(event.clientY + 16, window.innerHeight - element.offsetHeight - 8);
    element.style.transform = `translate(${left}px, ${top}px)`;
  }

  function pointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return;
    setHover(undefined);
    const anchorTarget = (event.target as Element).closest?.("[data-anchor]");
    if (anchorTarget && editable && !tool) {
      const index = Number(anchorTarget.getAttribute("data-anchor"));
      const origin = anchors[index];
      if (origin) { drag.current = { kind: "anchor", index, startX: event.clientX, startY: event.clientY, origin: [origin[0], origin[1]], moved: false }; event.currentTarget.setPointerCapture(event.pointerId); return; }
    }
    const feature = tool ? undefined : featureAt(event.target);
    if (feature && feature.movable && editable) drag.current = { kind: "move", feature, startX: event.clientX, startY: event.clientY, origin: [feature.x, feature.z], moved: false };
    else if (feature) drag.current = { kind: "move", feature, startX: event.clientX, startY: event.clientY, origin: [feature.x, feature.z], moved: false };
    else if (tool) drag.current = { kind: "place", startX: event.clientX, startY: event.clientY, moved: false };
    else drag.current = { kind: "pan", startX: event.clientX, startY: event.clientY, view: viewRef.current, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function pointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const current = drag.current;
    if (!current) {
      const feature = featureAt(event.target);
      if (feature !== hover) setHover(feature);
      if (feature) placeTip(event);
      return;
    }
    const dx = event.clientX - current.startX, dy = event.clientY - current.startY;
    if (!current.moved && Math.hypot(dx, dy) < 3) return;
    current.moved = true;
    const scale = current.kind === "pan" ? current.view.span / sizeRef.current.width : viewRef.current.span / sizeRef.current.width;
    if (current.kind === "pan") setView({ ...current.view, x: current.view.x - dx * scale, z: current.view.z + dy * scale });
    else if (current.kind === "move" && current.feature.movable && editable) setLiveMove({ key: current.feature.key, x: current.origin[0] + dx * scale, z: current.origin[1] - dy * scale });
    else if (current.kind === "anchor") setLiveAnchor({ index: current.index, point: [current.origin[0] + dx * scale, current.origin[1] - dy * scale] });
  }

  function pointerEnd(event: ReactPointerEvent<SVGSVGElement>) {
    const current = drag.current;
    drag.current = undefined;
    if (!current) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const dx = event.clientX - current.startX, dy = event.clientY - current.startY;
    const scale = viewRef.current.span / sizeRef.current.width;
    if (current.kind === "move") {
      if (current.moved && current.feature.movable && editable) onMove(current.feature.selection, [round(current.origin[0] + dx * scale), round(current.origin[1] - dy * scale)]);
      else if (!current.moved) onSelect(current.feature.selection);
      setLiveMove(undefined);
    } else if (current.kind === "anchor") {
      if (current.moved) onMoveAnchor(current.index, [current.origin[0] + dx * scale, current.origin[1] - dy * scale]);
      setLiveAnchor(undefined);
    } else if (current.kind === "place") {
      if (!current.moved) onPlace(worldPoint(event), { x: event.clientX, y: event.clientY });
    } else if (!current.moved) onSelect(undefined);
  }

  function keyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).tagName === "INPUT") return;
    const step = event.shiftKey ? 10 : 1;
    const nudge: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const delta = nudge[event.key];
    if (delta && selection && editable) { event.preventDefault(); onNudge(delta[0], delta[1]); return; }
    if (delta) { event.preventDefault(); setView(current => ({ ...current, x: current.x - delta[0] * current.span * 0.1, z: current.z - delta[1] * current.span * 0.1 })); return; }
    if (event.key === "+" || event.key === "=") { event.preventDefault(); setView(current => ({ ...current, span: clampSpan(current.span / 1.5) })); }
    else if (event.key === "-" || event.key === "_") { event.preventDefault(); setView(current => ({ ...current, span: clampSpan(current.span * 1.5) })); }
    else if (event.key === "Escape") { event.preventDefault(); onEscape(); }
  }

  // ---------------------------------------------------------------- geometry per layer

  const perLayer = useMemo(() => {
    const groups = Object.fromEntries(LAYERS.map(layer => [layer, [] as Feature[]])) as Record<Layer, Feature[]>;
    for (const feature of features) groups[feature.layer].push(feature);
    return groups;
  }, [features]);

  const selectedFeature = selectedKey ? features.find(feature => feature.key === selectedKey) : undefined;
  const liveDelta: Point | undefined = liveMove && selectedFeature && liveMove.key === selectedFeature.key ? [liveMove.x - selectedFeature.x, liveMove.z - selectedFeature.z] : undefined;

  // ---------------------------------------------------------------- renditions

  const neededWidth = IMAGE.width * pixelsPerMetre;
  const useTiles = neededWidth > DETAIL.at(-1)!.width;
  const rendition = neededWidth <= WORLD_MAP_MINIMAP_RENDITION.width ? WORLD_MAP_MINIMAP_RENDITION : DETAIL.find(row => row.width >= neededWidth) ?? DETAIL.at(-1)!;
  const viewBox = { x: view.x - view.span / 2, y: -view.z - (view.span * aspect) / 2, width: view.span, height: view.span * aspect };
  const tiles = useTiles ? TILES.tiles.filter(tile => {
    const metres = TILES.tileMetres;
    const c0 = Math.floor((viewBox.x - IMAGE.x) / metres), c1 = Math.floor((viewBox.x + viewBox.width - IMAGE.x) / metres);
    const r0 = Math.floor((viewBox.y - IMAGE.y) / metres), r1 = Math.floor((viewBox.y + viewBox.height - IMAGE.y) / metres);
    return tile.column >= c0 && tile.column <= c1 && tile.row >= r0 && tile.row <= r1;
  }) : [];

  const showLabels = { far: view.span < 900, mid: view.span < 450, near: view.span < 160 };
  const Icon = hover ? glyphIcon(hover) : undefined;

  return <div ref={frame} className="world-frame" tabIndex={0} onKeyDown={keyDown} data-tool={tool ?? undefined} data-dragging={liveMove || liveAnchor ? "true" : undefined}>
    <svg ref={svg} className="world-svg" role="img" aria-label="World map" viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`} preserveAspectRatio="xMidYMid slice"
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd} onPointerLeave={() => { if (!drag.current) setHover(undefined); }}>
      <image href={gameUrl(useTiles ? DETAIL.at(-1)!.path : rendition.path)} x={IMAGE.x} y={IMAGE.y} width={IMAGE.width} height={IMAGE.height} preserveAspectRatio="none" />
      {tiles.map(tile => <image key={tile.path} href={gameUrl(tile.path)} x={IMAGE.x + tile.column * TILES.tileMetres} y={IMAGE.y + tile.row * TILES.tileMetres} width={TILES.tileMetres} height={TILES.tileMetres} preserveAspectRatio="none" />)}
      {layers.regions && <RegionLayer features={perLayer.regions} marker={marker} selectedKey={selectedKey} />}
      {layers.roads && <RoadLayer roads={roads} />}
      {layers.spawns && <AreaLayer features={perLayer.spawns} marker={marker} selectedKey={selectedKey} hoverKey={hover?.key} labels={showLabels.mid} override={overrideFor("spawns", liveMove, features)} />}
      {layers.resources && <AreaLayer features={perLayer.resources} marker={marker} selectedKey={selectedKey} hoverKey={hover?.key} labels={showLabels.mid} override={overrideFor("resources", liveMove, features)} />}
      {layers.settlements && <PointLayer features={perLayer.settlements} marker={marker} selectedKey={selectedKey} hoverKey={hover?.key} labels={showLabels.near} shapes override={overrideFor("settlements", liveMove, features)} />}
      {layers.obstacles && <PointLayer features={perLayer.obstacles} marker={marker} selectedKey={selectedKey} hoverKey={hover?.key} labels={showLabels.far} override={overrideFor("obstacles", liveMove, features)} />}
      {layers.gates && <PointLayer features={perLayer.gates} marker={marker} selectedKey={selectedKey} hoverKey={hover?.key} labels={showLabels.far} override={overrideFor("gates", liveMove, features)} />}
      {layers.landmarks && <PointLayer features={perLayer.landmarks} marker={marker} selectedKey={selectedKey} hoverKey={hover?.key} labels={showLabels.far} override={overrideFor("landmarks", liveMove, features)} />}
      {layers.locations && <PointLayer features={perLayer.locations} marker={marker} selectedKey={selectedKey} hoverKey={hover?.key} labels={showLabels.far} override={overrideFor("locations", liveMove, features)} />}
      {layers.npcs && <PointLayer features={perLayer.npcs} marker={marker} selectedKey={selectedKey} hoverKey={hover?.key} labels={showLabels.near} override={overrideFor("npcs", liveMove, features)} />}
      {selectedFeature && selectedFeature.layer === "spawns" && anchors.length > 0 && <g className="world-anchors">
        {anchors.map((anchor, index) => {
          const point: Point = liveAnchor?.index === index ? liveAnchor.point : liveDelta ? [anchor[0] + liveDelta[0], anchor[1] + liveDelta[1]] : anchor;
          const centre: Point = liveDelta ? [selectedFeature.x + liveDelta[0], selectedFeature.z + liveDelta[1]] : [selectedFeature.x, selectedFeature.z];
          return <g key={index}>
            <line x1={centre[0]} y1={-centre[1]} x2={point[0]} y2={-point[1]} />
            <circle data-anchor={index} cx={point[0]} cy={-point[1]} r={marker * 0.75} className={editable ? "is-draggable" : undefined}><title>{`Anchor ${index + 1} · ${round(point[0])}, ${round(point[1])}`}</title></circle>
          </g>;
        })}
      </g>}
    </svg>
    {hover && Icon && <div ref={tip} className="world-tip" role="presentation" style={{ transform: "translate(-1000px, -1000px)" }}><Icon size={12} /><strong>{hover.name}</strong><span>{hover.fact}</span></div>}
    <div className="world-readout">{Math.round(view.x)}, {Math.round(view.z)} · {view.span >= 100 ? `${Math.round(view.span)} m` : `${round(view.span, 1)} m`} wide · {round(1 / pixelsPerMetre, 2)} m/px</div>
  </div>;
});

function toWorld(element: SVGSVGElement | null, clientX: number, clientY: number): Point | undefined {
  const matrix = element?.getScreenCTM();
  if (!matrix) return undefined;
  const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
  return [point.x, -point.y];
}

function keyOf(selection: Selection, features: readonly Feature[]): string | undefined {
  return features.find(feature => sameSelection(feature.selection, selection))?.key;
}

function overrideFor(layer: Layer, live: { key: string; x: number; z: number } | undefined, features: readonly Feature[]): { key: string; x: number; z: number } | undefined {
  if (!live) return undefined;
  const feature = features.find(row => row.key === live.key);
  return feature?.layer === layer ? live : undefined;
}

// ---------------------------------------------------------------- layers

const RegionLayer = memo(function RegionLayer({ features, marker, selectedKey }: { features: readonly Feature[]; marker: number; selectedKey?: string }) {
  return <g className="world-regions">
    {features.map(feature => feature.bounds && <g key={feature.key} className={feature.key === selectedKey ? "is-selected" : undefined}>
      <rect x={feature.bounds.min[0]} y={-feature.bounds.max[1]} width={feature.bounds.max[0] - feature.bounds.min[0]} height={feature.bounds.max[1] - feature.bounds.min[1]} />
      <text data-key={feature.key} x={feature.bounds.min[0] + marker * 1.2} y={-feature.bounds.max[1] + marker * 3.4} fontSize={marker * 2.8}>{feature.name}</text>
    </g>)}
  </g>;
});

const RoadLayer = memo(function RoadLayer({ roads }: { roads: readonly Road[] }) {
  return <g className="world-roads">
    {roads.map(road => <line key={road.key} x1={road.from[0]} y1={-road.from[1]} x2={road.to[0]} y2={-road.to[1]} />)}
  </g>;
});

interface LayerProps { features: readonly Feature[]; marker: number; selectedKey?: string; hoverKey?: string; labels: boolean; override?: { key: string; x: number; z: number }; shapes?: boolean }

/** Spawns and resource nodes: a translucent radius circle in metres plus a marker-scaled disc. */
const AreaLayer = memo(function AreaLayer({ features, marker, selectedKey, hoverKey, labels, override }: LayerProps) {
  return <g className="world-areas">
    {features.map(feature => {
      const x = override?.key === feature.key ? override.x : feature.x, z = override?.key === feature.key ? override.z : feature.z;
      const colour = glyphColor(feature);
      const Icon = glyphIcon(feature);
      const size = marker * 1.5;
      return <g key={feature.key} data-key={feature.key} className={`world-feature${feature.key === selectedKey ? " is-selected" : ""}${feature.key === hoverKey ? " is-hover" : ""}`} style={{ "--glyph": colour } as CSSProperties}>
        {feature.radius !== undefined && <circle className="world-radius" cx={x} cy={-z} r={feature.radius} />}
        {feature.rank && <circle className="world-rank" data-rank={feature.rank} cx={x} cy={-z} r={size * 1.55} />}
        {feature.key === selectedKey && <circle className="world-selected" cx={x} cy={-z} r={size * 1.9} />}
        <circle className="world-disc" cx={x} cy={-z} r={size} />
        <Icon x={x - size * 0.62} y={-z - size * 0.62} width={size * 1.24} height={size * 1.24} className="world-icon" />
        {labels && <text x={x + size * 1.4} y={-z + marker * 0.8} fontSize={marker * 2.2}>{feature.name}</text>}
      </g>;
    })}
  </g>;
});

/** Everything that is a point: locations, settlement pieces, npcs, landmarks, gates, obstacles. */
const PointLayer = memo(function PointLayer({ features, marker, selectedKey, hoverKey, labels, override, shapes }: LayerProps) {
  return <g className="world-points">
    {features.map(feature => {
      const x = override?.key === feature.key ? override.x : feature.x, z = override?.key === feature.key ? override.z : feature.z;
      const colour = glyphColor(feature);
      const Icon = glyphIcon(feature);
      const junction = feature.layer === "locations" && feature.glyph === "junction";
      const piece = shapes && feature.glyph === "building";
      const size = junction ? marker * 0.6 : piece ? marker * 0.9 : marker * 1.25;
      const selected = feature.key === selectedKey;
      return <g key={feature.key} data-key={feature.key} className={`world-feature${selected ? " is-selected" : ""}${feature.key === hoverKey ? " is-hover" : ""}`} style={{ "--glyph": colour } as CSSProperties}>
        {feature.to && (selected || feature.layer === "obstacles") && <line className="world-link" x1={x} y1={-z} x2={feature.to[0]} y2={-feature.to[1]} strokeDasharray={feature.layer === "gates" ? "4 3" : undefined} />}
        {feature.to && feature.layer === "obstacles" && <circle className="world-exit" cx={feature.to[0]} cy={-feature.to[1]} r={marker * 0.5} />}
        {piece && feature.footprint && <rect className="world-footprint" transform={`translate(${x} ${-z}) rotate(${deg(feature.rotation)})`} x={-feature.footprint[0] / 2} y={-feature.footprint[1] / 2} width={feature.footprint[0]} height={feature.footprint[1]} />}
        {selected && <circle className="world-selected" cx={x} cy={-z} r={size * 1.9} />}
        <circle className="world-disc" cx={x} cy={-z} r={size} />
        {!junction && !piece && <Icon x={x - size * 0.62} y={-z - size * 0.62} width={size * 1.24} height={size * 1.24} className="world-icon" />}
        {labels && !junction && <text x={x + size * 1.4} y={-z + marker * 0.8} fontSize={marker * 2.2}>{feature.name}</text>}
        {labels && junction && <text x={x + size * 1.6} y={-z + marker * 0.7} fontSize={marker * 1.8} className="is-faint">{feature.name}</text>}
      </g>;
    })}
  </g>;
});
