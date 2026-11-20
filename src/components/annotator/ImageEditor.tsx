'use client';

import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { ImagePlus, Image as ImageIcon } from 'lucide-react';
import { clamp, corners, drawBox, getCorner, moveBox, moveCorner } from './annotations';
import type { Box, Corner, Point, SavedImage } from './annotations';
import styles from './annotator.module.css';

type Drag = {
  pointerId: number;
  start: Point;
  box: Box;
  mode: 'draw' | 'move' | Corner;
};

type ImageEditorProps = {
  image: SavedImage;
  boxes: Box[];
  zoom: number;
  selectedId: string | null;
  selectedCorner: Corner | null;
  onSelect: (id: string | null, corner?: Corner) => void;
  onChange: (box: Box, fromArrow?: boolean) => void;
};

const palette = ['#56efd1', '#ffd277', '#9fb9ff', '#ffa9d6', '#c5f57a', '#fb9d83'];

export function boxColor(classId: number) {
  return palette[classId % palette.length];
}

export function EmptyEditor({ disabled, onBrowse }: { disabled: boolean; onBrowse: () => void }) {
  return (
    <div className={styles.emptyCanvas}>
      <div className={styles.emptyIcon}><ImageIcon size={34} strokeWidth={1.5} /></div>
      <h2>이미지를 작업 영역에 놓아주세요</h2>
      <p>이미지를 불러오면 박스를 그리거나 기존 YOLO 라벨을 편집할 수 있습니다.</p>
      <button className={styles.canvasButton} type="button" disabled={disabled} onClick={onBrowse}>
        <ImagePlus size={17} /> 이미지 선택
      </button>
    </div>
  );
}

export function ImageEditor({
  image, boxes, zoom, selectedId, selectedCorner, onSelect, onChange,
}: ImageEditorProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const [preview, setPreview] = useState<Box | null>(null);
  const [source, setSource] = useState('');
  const [available, setAvailable] = useState({ width: 1, height: 1 });
  const { width, height } = image.size;
  const fit = Math.min(1, Math.max(1, available.width - 48) / width, Math.max(1, available.height - 48) / height);
  const scale = fit * zoom;
  const handle = 8 / scale;

  useEffect(() => {
    const url = URL.createObjectURL(image.file);
    setSource(url);
    return () => URL.revokeObjectURL(url);
  }, [image.file]);

  useEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setAvailable({
      width: entry.contentRect.width,
      height: entry.contentRect.height,
    }));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  function imagePoint(event: PointerEvent) {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return null;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: point.x, y: point.y };
  }

  function boundedPoint(point: Point): Point {
    return {
      x: clamp(Math.round(point.x), 0, width),
      y: clamp(Math.round(point.y), 0, height),
    };
  }

  function startDrag(event: PointerEvent, box?: Box, corner?: Corner) {
    if (event.button !== 0 || drag.current || !svg.current) return;
    const start = imagePoint(event);
    if (!start) return;
    event.preventDefault();
    event.stopPropagation();
    svg.current.focus({ preventScroll: true });
    svg.current.setPointerCapture(event.pointerId);
    const point = boundedPoint(start);
    drag.current = {
      pointerId: event.pointerId,
      start,
      box: box ?? drawBox(crypto.randomUUID(), 0, point, point),
      mode: corner ?? (box ? 'move' : 'draw'),
    };
    onSelect(box?.id ?? null, corner);
  }

  function getPreview(current: Drag, point: Point) {
    const { box, start, mode } = current;
    if (mode === 'draw') return drawBox(box.id, box.classId, boundedPoint(start), boundedPoint(point));
    const dx = Math.round(point.x - start.x);
    const dy = Math.round(point.y - start.y);
    if (dx === 0 && dy === 0) return box;
    if (mode === 'move') return moveBox(box, dx, dy, image.size);
    const original = getCorner(box, mode);
    return moveCorner(box, mode, { x: original.x + dx, y: original.y + dy }, image.size);
  }

  function updateDrag(event: PointerEvent<SVGSVGElement>) {
    const current = drag.current;
    if (current?.pointerId !== event.pointerId) return;
    const point = imagePoint(event);
    if (point) setPreview(getPreview(current, point));
  }

  function clearDrag(event: PointerEvent<SVGSVGElement>) {
    if (drag.current?.pointerId === event.pointerId) {
      drag.current = null;
      setPreview(null);
    }
  }

  function finishDrag(event: PointerEvent<SVGSVGElement>) {
    const current = drag.current;
    if (current?.pointerId !== event.pointerId) return;
    const point = imagePoint(event);
    clearDrag(event);
    if (!point) return;
    const box = getPreview(current, point);
    if (current.mode === 'draw' && (box.xMax <= box.xMin || box.yMax <= box.yMin)) return;
    if (box === current.box) return;
    onChange(box);
    onSelect(box.id, current.mode === 'move' || current.mode === 'draw' ? undefined : current.mode);
  }

  function onKeyDown(event: KeyboardEvent<SVGSVGElement>) {
    if (event.key === 'Escape') {
      drag.current = null;
      setPreview(null);
      onSelect(null);
      return;
    }
    if (drag.current || event.altKey || event.ctrlKey || event.metaKey) return;
    const offsets: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    };
    const offset = offsets[event.key];
    const box = boxes.find((entry) => entry.id === selectedId);
    if (!offset || !box) return;
    event.preventDefault();
    const step = event.shiftKey ? 10 : 1;
    const dx = offset[0] * step;
    const dy = offset[1] * step;
    if (!selectedCorner) {
      onChange(moveBox(box, dx, dy, image.size), true);
      return;
    }
    const corner = getCorner(box, selectedCorner);
    onChange(moveCorner(box, selectedCorner, { x: corner.x + dx, y: corner.y + dy }, image.size), true);
  }

  const visible = boxes.map((box) => preview?.id === box.id ? preview : box);
  if (preview && !visible.some((box) => box.id === preview.id)) visible.push(preview);
  const selected = visible.find((box) => box.id === selectedId);

  return (
    <div className={styles.viewport} ref={viewport}>
      <div className={styles.imagePlacement}>
        <svg
          ref={svg}
          className={styles.imageEditor}
          viewBox={`0 0 ${width} ${height}`}
          width={width * scale}
          height={height * scale}
          tabIndex={0}
          aria-label="이미지 박스 편집기"
          onPointerDown={(event) => startDrag(event)}
          onPointerMove={updateDrag}
          onPointerUp={finishDrag}
          onPointerCancel={clearDrag}
          onLostPointerCapture={clearDrag}
          onKeyDown={onKeyDown}
        >
          {source && <image href={source} width={width} height={height} />}
          {visible.map((box) => {
            const color = boxColor(box.classId);
            const font = 12 / scale;
            const labelY = box.yMin > font * 1.5 ? box.yMin - 5 / scale : box.yMin + font * 1.25;
            return (
              <g key={box.id}>
                <rect
                  x={box.xMin}
                  y={box.yMin}
                  width={box.xMax - box.xMin}
                  height={box.yMax - box.yMin}
                  fill={color}
                  fillOpacity={box.id === selectedId || box.id === preview?.id ? 0.2 : 0.09}
                  stroke={color}
                  strokeWidth={box.id === selectedId ? 2.5 : 1.5}
                  vectorEffect="non-scaling-stroke"
                  className={styles.boxShape}
                  onPointerDown={(event) => startDrag(event, box)}
                  data-box-id={box.id}
                />
                <text
                  x={box.xMin + 4 / scale}
                  y={labelY}
                  fill={color}
                  stroke="#101829"
                  strokeWidth={3}
                  vectorEffect="non-scaling-stroke"
                  paintOrder="stroke"
                  fontSize={font}
                  fontWeight={700}
                  pointerEvents="none"
                >
                  {box.classId}
                </text>
              </g>
            );
          })}
          {selected && corners.map((corner) => {
            const point = getCorner(selected, corner);
            return (
              <rect
                key={corner}
                data-corner={corner}
                x={point.x - handle / 2}
                y={point.y - handle / 2}
                width={handle}
                height={handle}
                fill={corner === selectedCorner ? '#fff' : boxColor(selected.classId)}
                stroke="#111827"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
                style={{ cursor: `${corner}-resize` }}
                onPointerDown={(event) => startDrag(event, selected, corner)}
              />
            );
          })}
        </svg>
      </div>
    </div>
  );
}
