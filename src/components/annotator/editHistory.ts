import type { Box, SavedImage } from './annotations';

type EditStep = { boxes: Box[]; arrowGroup?: number };

export type WorkingImage = SavedImage & { boxes: Box[]; undo: EditStep[] };

export function sameBox(a: Box, b: Box) {
  return a.id === b.id && a.classId === b.classId && a.xMin === b.xMin &&
    a.yMin === b.yMin && a.xMax === b.xMax && a.yMax === b.yMax;
}

export function editBoxes(image: WorkingImage, boxes: Box[], arrowGroup?: number): WorkingImage {
  if (boxes === image.boxes) return image;
  const previous = image.undo.at(-1);
  if (arrowGroup !== undefined && previous?.arrowGroup === arrowGroup) {
    if (boxes.length === previous.boxes.length && boxes.every((box, index) => sameBox(box, previous.boxes[index]))) {
      return { ...image, boxes: previous.boxes, undo: image.undo.slice(0, -1) };
    }
    return { ...image, boxes };
  }
  return { ...image, boxes, undo: [...image.undo, { boxes: image.boxes, arrowGroup }] };
}
