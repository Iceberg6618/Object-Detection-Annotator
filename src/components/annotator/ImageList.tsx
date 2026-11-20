import { ChevronDown, Folder, FolderOpen, Image as ImageIcon } from 'lucide-react';
import { filename } from './annotations';
import type { WorkingImage } from './editHistory';
import styles from './annotator.module.css';

type Directory = {
  folders: Map<string, Directory>;
  images: WorkingImage[];
};

type ImageListProps = {
  images: WorkingImage[];
  selectedId: string | null;
  expanded: Set<string>;
  disabled: boolean;
  onSelect: (image: WorkingImage) => void;
  onToggle: (path: string) => void;
};

function imageTree(images: WorkingImage[]): Directory {
  const root: Directory = { folders: new Map(), images: [] };
  for (const image of images) {
    let directory = root;
    for (const name of image.path.split('/').slice(0, -1)) {
      let child = directory.folders.get(name);
      if (!child) {
        child = { folders: new Map(), images: [] };
        directory.folders.set(name, child);
      }
      directory = child;
    }
    directory.images.push(image);
  }
  return root;
}

export function ImageList({ images, selectedId, expanded, disabled, onSelect, onToggle }: ImageListProps) {
  function rows(directory: Directory, prefix: string) {
    return (
      <>
        {Array.from(directory.folders, ([name, child]) => {
          const path = prefix + name;
          const open = expanded.has(path);
          return (
            <li key={path}>
              <button
                type="button" className={styles.folderItem} aria-expanded={open}
                title={path} onClick={() => onToggle(path)}
              >
                <ChevronDown size={15} />
                {open ? <FolderOpen size={17} /> : <Folder size={17} />}
                <span>{name}</span>
              </button>
              {open && <ul className={styles.folderContents} aria-label={path}>{rows(child, path + '/')}</ul>}
            </li>
          );
        })}
        {directory.images.map((image) => (
          <li key={image.id}>
            <button
              type="button" className={styles.imageItem}
              aria-current={image.id === selectedId ? 'true' : undefined}
              disabled={disabled} title={image.path} onClick={() => onSelect(image)}
            >
              <ImageIcon size={17} />
              <span>
                <strong>{filename(image.path)}</strong>
                <small>{image.size.width} × {image.size.height}</small>
              </span>
              <span className={styles.count}>{image.boxes.length}</span>
            </button>
          </li>
        ))}
      </>
    );
  }

  return <ul className={styles.imageList}>{rows(imageTree(images), '')}</ul>;
}
