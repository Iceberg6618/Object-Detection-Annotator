'use client';

import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent, FormEvent, ReactNode } from 'react';
import {
  BoxSelect, ChevronDown, CircleHelp, FileText, FolderOpen, History,
  Image as ImageIcon, ImagePlus, Layers3, Maximize, Minus, Plus, RotateCcw, Save, ScanLine, Trash2, Undo2,
} from 'lucide-react';
import { clamp, filename, getFilePath, setEdge } from './annotations';
import type { Box, Corner, Edge, SavedImage } from './annotations';
import { loadSavedImages, saveCheckpoint } from './checkpoints';
import { editBoxes, sameBox } from './editHistory';
import type { WorkingImage } from './editHistory';
import { downloadLabels, importFiles, readDroppedFiles } from './files';
import type { FileSource } from './files';
import { boxColor, EmptyEditor, ImageEditor } from './ImageEditor';
import { ImageList } from './ImageList';
import styles from './annotator.module.css';

const coordinates: { edge: Edge; label: string }[] = [
  { edge: 'xMin', label: 'X min' }, { edge: 'yMin', label: 'Y min' },
  { edge: 'xMax', label: 'X max' }, { edge: 'yMax', label: 'Y max' },
];

const checkpointTime = new Intl.DateTimeFormat('ko-KR', {
  month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
});

function NumberField({ label, value, max, onChange }: {
  label: string;
  value: number;
  max?: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  function commit(event: FormEvent<HTMLInputElement>) {
    const next = event.currentTarget.valueAsNumber;
    if (draft !== null && Number.isFinite(next)) onChange(next);
    setDraft(null);
  }

  return (
    <label className={styles.field}>
      <span>{label}</span>
      <input
        type="number"
        min={0}
        max={max}
        step="any"
        value={draft ?? Number(value.toFixed(4))}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            setDraft(null);
          }
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
          event.preventDefault();
          const entered = event.currentTarget.valueAsNumber;
          const current = draft !== null && Number.isFinite(entered) ? entered : value;
          onChange(current + (event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 10 : 1));
          setDraft(null);
        }}
      />
    </label>
  );
}

function Count({ children }: { children: ReactNode }) {
  return <span className={styles.count}>{children}</span>;
}

export function Annotator() {
  const [images, setImages] = useState<WorkingImage[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set());
  const [imageId, setImageId] = useState<string | null>(null);
  const [boxId, setBoxId] = useState<string | null>(null);
  const [corner, setCorner] = useState<Corner | null>(null);
  const [zoom, setZoom] = useState(1);
  const [checkpointId, setCheckpointId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'import' | 'save' | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [status, setStatus] = useState<{ message: string; errors?: string[] } | null>(null);
  const filePicker = useRef<HTMLInputElement>(null);
  const folderPicker = useRef<HTMLInputElement>(null);
  const labelPicker = useRef<HTMLInputElement>(null);
  const operation = useRef(false);
  const dragDepth = useRef(0);
  const arrowGroup = useRef(0);

  const image = images.find((entry) => entry.id === imageId);
  const selected = image?.boxes.find((box) => box.id === boxId);
  const latest = image?.checkpoints.at(-1);
  const targetCheckpoint = image?.checkpoints.find((checkpoint) => checkpoint.id === checkpointId) ?? latest;
  const dirty = Boolean(image && (!latest || image.boxes !== latest.boxes));
  const blocked = loading || busy !== null;

  useEffect(() => {
    let active = true;
    loadSavedImages()
      .then((records) => {
        if (!active) return;
        const ordered = records.sort((a, b) => a.path.localeCompare(b.path, 'ko'));
        setImages(ordered.map((record) => ({
          ...record, boxes: record.checkpoints.at(-1)?.boxes ?? [], undo: [],
        })));
        if (ordered[0]) {
          setImageId(ordered[0].id);
          revealFolders(ordered[0].path);
        }
      })
      .catch(() => {
        if (active) setStatus({ message: '브라우저에 저장된 체크포인트를 불러오지 못했습니다.' });
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  function selectBox(id: string | null, nextCorner: Corner | null = null) {
    if (id !== boxId || nextCorner !== corner) arrowGroup.current++;
    setBoxId(id);
    setCorner(nextCorner);
  }

  function revealFolders(path: string) {
    const parts = path.split('/').slice(0, -1);
    if (!parts.length) return;
    setExpandedFolders((current) => {
      const expanded = new Set(current);
      parts.forEach((_, index) => expanded.add(parts.slice(0, index + 1).join('/')));
      return expanded;
    });
  }

  function toggleFolder(path: string) {
    setExpandedFolders((current) => {
      const expanded = new Set(current);
      if (expanded.has(path)) expanded.delete(path);
      else expanded.add(path);
      return expanded;
    });
  }

  function selectImage(next: SavedImage) {
    if (next.id !== imageId) arrowGroup.current++;
    revealFolders(next.path);
    setImageId(next.id);
    selectBox(null);
    setZoom(1);
    setCheckpointId(null);
  }

  function updateBoxes(update: (boxes: Box[]) => Box[], fromArrow = false) {
    if (!image || operation.current) return;
    const group = fromArrow ? arrowGroup.current : undefined;
    if (!fromArrow) arrowGroup.current++;
    setImages((current) => current.map((entry) =>
      entry.id === image.id ? editBoxes(entry, update(entry.boxes), group) : entry,
    ));
  }

  function changeBox(box: Box, fromArrow = false) {
    updateBoxes((boxes) => {
      const existing = boxes.find((entry) => entry.id === box.id);
      if (!existing) return [...boxes, box];
      if (sameBox(existing, box)) return boxes;
      return boxes.map((entry) => entry.id === box.id ? box : entry);
    }, fromArrow);
  }

  function undoEdit() {
    const previous = image?.undo.at(-1);
    if (!image || !previous || operation.current) return;
    arrowGroup.current++;
    setImages((current) => current.map((entry) =>
      entry.id === image.id ? { ...entry, boxes: previous.boxes, undo: entry.undo.slice(0, -1) } : entry,
    ));
    if (!previous.boxes.some((box) => box.id === boxId)) selectBox(null);
  }

  function resetBoxes() {
    if (!image?.boxes.length || operation.current) return;
    updateBoxes(() => []);
    selectBox(null);
  }

  async function addFiles(readFiles: () => FileSource[] | Promise<FileSource[]>) {
    if (loading || operation.current) return;
    operation.current = true;
    setBusy('import');
    try {
      const files = await readFiles();
      const result = await importFiles(files, images);
      setImages(result.images);
      const firstImage = result.images.find((entry) => entry.id === result.firstImageId);
      if (firstImage && !files.some(({ path }) => path.includes('/'))) selectImage(firstImage);
      const counts = [result.imageCount && `이미지 ${result.imageCount}개`, result.labelCount && `라벨 ${result.labelCount}개`]
        .filter(Boolean).join(', ');
      const message = counts ? `불러오기 완료 · ${counts}`
        : result.errors.length ? '일부 파일을 읽을 수 없습니다.'
        : result.firstImageId ? '이미 불러온 이미지입니다.' : '지원되는 이미지 또는 YOLO 라벨을 선택해 주세요.';
      setStatus({ message, errors: result.errors });
    } catch {
      setStatus({ message: '파일을 불러오지 못했습니다.' });
    } finally {
      operation.current = false;
      setBusy(null);
    }
  }

  function onFilesPicked(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    if (files.length) void addFiles(() => files.map((file) => ({ file, path: getFilePath(file) })));
  }

  function dropFiles(event: DragEvent) {
    event.preventDefault();
    dragDepth.current = 0;
    setDropActive(false);
    const transfer = event.dataTransfer;
    if (transfer.types.includes('Files')) void addFiles(() => readDroppedFiles(transfer));
  }

  async function save() {
    if (!image || operation.current) return;
    operation.current = true;
    setBusy('save');
    arrowGroup.current++;
    const { id, path, file, size, checkpoints, boxes } = image;
    const record = { id, path, file, size, checkpoints };
    const errors: string[] = [];
    try {
      const checkpoint = { id: crypto.randomUUID(), savedAt: Date.now(), boxes };
      const saved = await saveCheckpoint(record, checkpoint);
      setImages((current) => current.map((entry) =>
        entry.id === record.id ? { ...entry, checkpoints: saved.checkpoints } : entry,
      ));
      setCheckpointId(null);
    } catch {
      errors.push('브라우저 저장소에 체크포인트를 기록하지 못했습니다.');
    }

    let message = errors.length ? 'YOLO 라벨을 내보냈습니다.'
      : `${filename(record.path)} 라벨을 내보내고 체크포인트를 저장했습니다.`;
    try {
      downloadLabels(record, boxes);
    } catch {
      message = 'YOLO 라벨을 다운로드하지 못했습니다.';
      if (!errors.length) errors.push('체크포인트는 저장했습니다.');
    } finally {
      operation.current = false;
      setBusy(null);
    }
    setStatus({ message, errors });
  }

  function restore() {
    if (!image || !targetCheckpoint || operation.current) return;
    if (image.boxes !== targetCheckpoint.boxes && dirty && !window.confirm('현재 작업을 선택한 체크포인트의 내용으로 바꿀까요?')) {
      return;
    }
    updateBoxes(() => targetCheckpoint.boxes);
    selectBox(null);
    setStatus({ message: `${checkpointTime.format(targetCheckpoint.savedAt)} 체크포인트를 복원했습니다.` });
  }

  return (
    <main
      className={styles.app}
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        dragDepth.current++;
        setDropActive(true);
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) {
          event.preventDefault();
          event.dataTransfer.dropEffect = blocked ? 'none' : 'copy';
        }
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDropActive(false);
      }}
      onDrop={dropFiles}
    >
      <header className={styles.header}>
        <div className={styles.brand}>
          <div className={styles.brandMark}><ScanLine size={23} /></div>
          <div>
            <h1>Detection Annotator</h1>
            <p>객체 검출 라벨 편집기</p>
          </div>
        </div>
        <div className={styles.headerActions}>
          {image && <span className={styles.saveState} data-dirty={dirty}>{dirty ? '저장 전' : '저장됨'}</span>}
          <button className={styles.secondary} type="button" disabled={!image?.boxes.length || blocked} onClick={resetBoxes}>
            <RotateCcw size={16} /> 초기화
          </button>
          <button className={styles.secondary} type="button" disabled={!image?.undo.length || blocked} onClick={undoEdit}>
            <Undo2 size={17} /> 실행취소
          </button>
          <button className={styles.primary} type="button" disabled={!image || blocked} onClick={save}>
            <Save size={17} /> {busy === 'save' ? '저장 중' : 'Save YOLO'}
          </button>
        </div>
      </header>

      <div className={styles.workspace}>
        <aside className={styles.sidebar} aria-label="이미지 목록">
          <div className={styles.sectionTitle}><ImageIcon size={18} /><h2>이미지</h2><Count>{images.length}</Count></div>
          <input type="file" hidden multiple ref={filePicker} accept="image/*,.txt" onChange={onFilesPicked} />
          <input
            type="file" hidden multiple
            ref={(node) => {
              folderPicker.current = node;
              node?.setAttribute('webkitdirectory', '');
            }}
            onChange={onFilesPicked}
          />
          <input type="file" hidden multiple ref={labelPicker} accept=".txt" onChange={onFilesPicked} />
          <button className={styles.importButton} type="button" disabled={blocked} onClick={() => filePicker.current?.click()}>
            <ImagePlus size={18} /> 파일 열기
          </button>
          <div className={styles.importActions}>
            <button className={styles.secondary} type="button" disabled={blocked} onClick={() => folderPicker.current?.click()}>
              <FolderOpen size={16} /> 폴더
            </button>
            <button className={styles.secondary} type="button" disabled={blocked || !images.length} onClick={() => labelPicker.current?.click()}>
              <FileText size={16} /> 라벨
            </button>
          </div>

          {images.length ? (
            <ImageList
              images={images} selectedId={imageId} expanded={expandedFolders}
              disabled={blocked} onSelect={selectImage} onToggle={toggleFolder}
            />
          ) : <p className={styles.sidebarHint}>{loading ? '저장된 이미지 불러오는 중…' : busy === 'import' ? '파일 읽는 중…' : '열어 둔 이미지가 여기에 표시됩니다.'}</p>}
        </aside>

        <section className={styles.canvasPanel} aria-label="이미지 작업 영역">
          <div className={styles.canvasToolbar}>
            <span className={styles.canvasName} title={image?.path}>
              <ImageIcon size={16} /><span>{image ? filename(image.path) : '작업 영역'}</span>
            </span>
            <div className={styles.zoomGroup}>
              <button className={styles.iconButton} type="button" aria-label="축소" title="축소" disabled={!image || zoom <= 0.25} onClick={() => setZoom((value) => clamp(value / 1.25, 0.25, 8))}><Minus size={17} /></button>
              <output aria-label="맞춤 크기 기준 확대율">{Math.round(zoom * 100)}%</output>
              <button className={styles.iconButton} type="button" aria-label="확대" title="확대" disabled={!image || zoom >= 8} onClick={() => setZoom((value) => clamp(value * 1.25, 0.25, 8))}><Plus size={17} /></button>
              <button className={styles.iconButton} type="button" aria-label="화면에 맞추기" title="화면에 맞추기" disabled={!image} onClick={() => setZoom(1)}><Maximize size={16} /></button>
            </div>
          </div>
          <div className={styles.canvas} aria-busy={blocked}>
            {image ? (
              <ImageEditor
                key={image.id}
                image={image}
                boxes={image.boxes}
                zoom={zoom}
                selectedId={boxId}
                selectedCorner={corner}
                onSelect={selectBox}
                onChange={changeBox}
              />
            ) : (
              <EmptyEditor disabled={blocked} onBrowse={() => filePicker.current?.click()} />
            )}
            {dropActive && <div className={styles.dropOverlay}><ImagePlus size={24} /> 파일을 놓아 불러오기</div>}
          </div>
          <div className={styles.canvasFooter}>
            <span><CircleHelp size={15} /> 드래그로 그리기 · Shift + 방향키로 10 px 이동</span>
            {image && <span>{image.size.width} × {image.size.height} px</span>}
          </div>
          {status && (
            <div className={styles.notice} role="status">
              <strong>{status.message}</strong>
              {status.errors && status.errors.length > 0 && <ul>{status.errors.map((error, index) => <li key={index}>{error}</li>)}</ul>}
              <button className={styles.noticeClose} type="button" onClick={() => setStatus(null)}>닫기</button>
            </div>
          )}
        </section>

        <aside className={styles.inspector} aria-label="박스 및 체크포인트">
          <div className={styles.sectionTitle}><Layers3 size={18} /><h2>박스</h2><Count>{image?.boxes.length ?? 0}</Count></div>
          {image?.boxes.length ? (
            <ul className={styles.boxList}>
              {image.boxes.map((box, index) => (
                <li key={box.id}>
                  <button
                    type="button" className={styles.boxItem} aria-pressed={selected?.id === box.id}
                    disabled={blocked} onClick={() => selectBox(box.id)}
                  >
                    <span className={styles.swatch} style={{ backgroundColor: boxColor(box.classId) }} />
                    <strong>박스 {index + 1}</strong><span>Class {box.classId}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <div className={styles.emptyBoxes}><BoxSelect size={21} /><span>이미지에서 드래그해 박스를 그려보세요.</span></div>}

          {image && selected && (
            <fieldset className={styles.properties} key={selected.id} disabled={blocked}>
              <div className={styles.propertyHeading}>
                <h3>박스 속성</h3>
                <button className={styles.deleteButton} type="button" aria-label="선택한 박스 삭제" title="박스 삭제" onClick={() => {
                  updateBoxes((boxes) => boxes.filter((box) => box.id !== selected.id));
                  selectBox(null);
                }}><Trash2 size={16} /></button>
              </div>
              <NumberField label="클래스 ID" value={selected.classId} onChange={(value) => {
                const classId = Math.max(0, Math.round(value));
                if (Number.isSafeInteger(classId)) changeBox({ ...selected, classId });
              }} />
              <div className={styles.coordinateTitle}>원본 이미지 좌표 <span>px</span></div>
              <div className={styles.coordinates}>
                {coordinates.map(({ edge, label }) => (
                  <NumberField
                    key={edge}
                    label={label}
                    value={selected[edge]}
                    max={edge.startsWith('x') ? image.size.width : image.size.height}
                    onChange={(value) => changeBox(setEdge(selected, edge, value, image.size))}
                  />
                ))}
              </div>
            </fieldset>
          )}

          <section className={styles.checkpoints}>
            <div className={styles.sectionTitle}><History size={18} /><h2>체크포인트</h2></div>
            <div className={styles.selectWrap}>
              <select aria-label="복원할 체크포인트" value={targetCheckpoint?.id ?? ''} disabled={!latest || blocked} onChange={(event) => setCheckpointId(event.target.value)}>
                {!latest && <option value="">저장된 버전 없음</option>}
                {image?.checkpoints.slice().reverse().map((checkpoint, index) => (
                  <option key={checkpoint.id} value={checkpoint.id}>
                    {checkpointTime.format(checkpoint.savedAt)}{index === 0 ? ' · 최신' : ` · #${image.checkpoints.length - index}`}
                  </option>
                ))}
              </select>
              <ChevronDown size={16} />
            </div>
            <button className={styles.secondary} type="button" disabled={!targetCheckpoint || blocked} onClick={restore}>
              <History size={16} /> 선택한 버전으로 복원
            </button>
          </section>
        </aside>
      </div>
    </main>
  );
}
