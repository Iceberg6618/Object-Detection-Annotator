import { exportYolo, filename, importYolo, withoutExtension } from './annotations';
import type { Box, ImageSize, SavedImage } from './annotations';

import { editBoxes } from './editHistory';
import type { WorkingImage } from './editHistory';

export type FileSource = { file: File; path: string };

async function readEntry(entry: FileSystemEntry, parent = ''): Promise<FileSource[]> {
  const path = parent + entry.name;
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
    return [{ file, path }];
  }

  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const children: FileSource[] = [];
  while (true) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) return children;
    for (const child of batch) children.push(...await readEntry(child, path + '/'));
  }
}

export async function readDroppedFiles(transfer: DataTransfer): Promise<FileSource[]> {
  // Capture handles during the drop event, before the browser protects the drag data.
  const files = Array.from(transfer.files);
  const entries = Array.from(transfer.items)
    .filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry?.());
  if (!entries.some(Boolean)) return files.map((file) => ({ file, path: file.name }));
  const sources = await Promise.all(entries.map((entry, index) =>
    entry ? readEntry(entry) : files[index] ? [{ file: files[index], path: files[index].name }] : [],
  ));
  return sources.flat();
}

async function imageSize(file: File): Promise<ImageSize> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return { width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function relativeStem(path: string) {
  const parts = withoutExtension(path).split('/');
  const directory = parts.findLastIndex((part, index) =>
    index < parts.length - 1 && /^(images|labels)$/i.test(part),
  );
  if (directory !== -1) parts[directory] = '';
  return parts.join('/');
}

export async function importFiles(files: FileSource[], current: WorkingImage[]) {
  const images = [...current];
  const errors: string[] = [];
  const imported: { image: WorkingImage; label: FileSource }[] = [];
  const labels: FileSource[] = [];
  const existingIds = new Set(current.map((image) => image.id));
  let firstImageId: string | undefined;
  let imageCount = 0;
  let labelCount = 0;

  for (const { file, path } of files) {
    if (/\.txt$/i.test(path)) {
      labels.push({ file, path });
      continue;
    }
    if (!(file.type.startsWith('image/') || /\.(avif|bmp|gif|jpe?g|png|svg|webp|ico)$/i.test(path))) continue;
    const existing = images.find((image) =>
      image.path === path && image.file.size === file.size && image.file.lastModified === file.lastModified,
    );
    if (existing) {
      firstImageId ??= existing.id;
      continue;
    }
    try {
      const size = await imageSize(file);
      const image: WorkingImage = { id: crypto.randomUUID(), path, file, size, boxes: [], checkpoints: [], undo: [] };
      images.push(image);
      firstImageId ??= image.id;
      imageCount++;
    } catch {
      errors.push(`${path} 이미지를 열 수 없습니다.`);
    }
  }

  for (const label of labels) {
    const { path } = label;
    const matches = images.filter((image) => relativeStem(image.path) === relativeStem(path));
    const candidates = matches.length ? matches : images.filter((image) =>
      filename(withoutExtension(image.path)) === filename(withoutExtension(path)),
    );
    if (candidates.length !== 1) {
      errors.push(`${path}에 대응하는 이미지를 하나로 지정할 수 없습니다.`);
      continue;
    }
    imported.push({ image: candidates[0], label });
  }

  for (const { image, label } of imported) {
    const { path } = label;
    if (imported.filter((entry) => entry.image.id === image.id).length > 1) {
      errors.push(`${path}와 같은 이미지를 지정하는 라벨 파일이 여러 개 있습니다.`);
      continue;
    }
    try {
      const boxes = importYolo(await label.file.text(), image.size);
      images[images.findIndex((entry) => entry.id === image.id)] = existingIds.has(image.id)
        ? editBoxes(image, boxes) : { ...image, boxes };
      firstImageId ??= image.id;
      labelCount++;
    } catch (error) {
      errors.push(`${path} · ${error instanceof Error ? error.message : '읽기 실패'}`);
    }
  }

  return { images, firstImageId, imageCount, labelCount, errors };
}

export function downloadLabels(image: SavedImage, boxes: Box[]) {
  const content = new Blob([exportYolo(boxes, image.size)], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(content);
  const link = document.createElement('a');
  link.href = url;
  link.download = withoutExtension(filename(image.path)) + '.txt';
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
