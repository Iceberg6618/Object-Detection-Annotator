import type { Checkpoint, SavedImage } from './annotations';

const storeName = 'images';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('detection-annotator', 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName, { keyPath: 'id' });
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function loadSavedImages(): Promise<SavedImage[]> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(storeName).objectStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

export async function saveCheckpoint(image: SavedImage, checkpoint: Checkpoint): Promise<SavedImage> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.get(image.id);
      let saved: SavedImage;
      request.onsuccess = () => {
        const previous: SavedImage | undefined = request.result;
        saved = { ...image, checkpoints: [...(previous?.checkpoints ?? []), checkpoint] };
        store.put(saved);
      };
      transaction.oncomplete = () => resolve(saved);
      transaction.onabort = () => reject(transaction.error ?? new Error('저장이 중단됐습니다.'));
    });
  } finally {
    database.close();
  }
}
