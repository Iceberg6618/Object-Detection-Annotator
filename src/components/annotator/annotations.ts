export type Point = { x: number; y: number };
export type ImageSize = { width: number; height: number };
export type Corner = 'nw' | 'ne' | 'se' | 'sw';
export type Edge = 'xMin' | 'yMin' | 'xMax' | 'yMax';

export type Box = Record<Edge, number> & {
  id: string;
  classId: number;
};

export type Checkpoint = {
  id: string;
  savedAt: number;
  boxes: Box[];
};

export type SavedImage = {
  id: string;
  path: string;
  file: File;
  size: ImageSize;
  checkpoints: Checkpoint[];
};

export const corners: Corner[] = ['nw', 'ne', 'se', 'sw'];

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function drawBox(id: string, classId: number, start: Point, end: Point): Box {
  return {
    id, classId,
    xMin: Math.min(start.x, end.x),
    yMin: Math.min(start.y, end.y),
    xMax: Math.max(start.x, end.x),
    yMax: Math.max(start.y, end.y),
  };
}

export function moveBox(box: Box, dx: number, dy: number, size: ImageSize): Box {
  const x = clamp(dx, -box.xMin, size.width - box.xMax);
  const y = clamp(dy, -box.yMin, size.height - box.yMax);
  return { ...box, xMin: box.xMin + x, xMax: box.xMax + x, yMin: box.yMin + y, yMax: box.yMax + y };
}

export function getEdges(corner: Corner): [Edge, Edge] {
  return [corner.endsWith('w') ? 'xMin' : 'xMax', corner.startsWith('n') ? 'yMin' : 'yMax'];
}

export function getCorner(box: Box, corner: Corner): Point {
  const [x, y] = getEdges(corner);
  return { x: box[x], y: box[y] };
}

export function setEdge(box: Box, edge: Edge, value: number, size: ImageSize): Box {
  const axis = edge[0] as 'x' | 'y';
  const min = box[`${axis}Min`];
  const max = box[`${axis}Max`];
  const gap = Math.min(1, max - min);
  const limit = axis === 'x' ? size.width : size.height;
  return {
    ...box,
    [edge]: edge.endsWith('Min') ? clamp(value, 0, max - gap) : clamp(value, min + gap, limit),
  };
}

export function moveCorner(box: Box, corner: Corner, point: Point, size: ImageSize): Box {
  const [x, y] = getEdges(corner);
  return setEdge(setEdge(box, x, point.x, size), y, point.y, size);
}

export function exportYolo(boxes: Box[], { width, height }: ImageSize) {
  const format = (value: number) => Number(value.toPrecision(12)).toString();
  return boxes.map(({ classId, xMin, yMin, xMax, yMax }) => [
    classId,
    format((xMin + xMax) / (2 * width)),
    format((yMin + yMax) / (2 * height)),
    format((xMax - xMin) / width),
    format((yMax - yMin) / height),
  ].join(' ')).join('\n') + (boxes.length ? '\n' : '');
}

export function importYolo(text: string, { width, height }: ImageSize): Box[] {
  return text.split(/\r?\n/).flatMap((line, index) => {
    if (!line.trim()) return [];
    const values = line.trim().split(/\s+/).map(Number);
    const [classId, x, y, w, h] = values;
    const epsilon = 0.000001;
    if (values.length !== 5 || !Number.isSafeInteger(classId) || classId < 0 ||
        ![x, y, w, h].every((value) => Number.isFinite(value) && value >= 0 && value <= 1) ||
        w <= 0 || h <= 0 || x - w / 2 < -epsilon || y - h / 2 < -epsilon ||
        x + w / 2 > 1 + epsilon || y + h / 2 > 1 + epsilon) {
      throw new Error(`${index + 1}행의 YOLO 좌표 또는 클래스 ID를 확인해 주세요.`);
    }
    const box = drawBox(
      crypto.randomUUID(),
      classId,
      { x: clamp(x - w / 2, 0, 1) * width, y: clamp(y - h / 2, 0, 1) * height },
      { x: clamp(x + w / 2, 0, 1) * width, y: clamp(y + h / 2, 0, 1) * height },
    );
    if (box.xMax <= box.xMin || box.yMax <= box.yMin) {
      throw new Error(`${index + 1}행의 박스 너비 또는 높이가 너무 작습니다.`);
    }
    return [box];
  });
}

export function filename(path: string) {
  return path.split('/').at(-1) ?? path;
}

export function withoutExtension(path: string) {
  return path.replace(/\.[^./]+$/, '');
}

export function getFilePath(file: File) {
  return file.webkitRelativePath || file.name;
}
