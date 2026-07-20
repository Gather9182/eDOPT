const DB_NAME = 'EnergyToolDB';
const STORE_NAME = 'SimulationResults';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not supported in this environment.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = (event) => {
      resolve(event.target.result);
    };
    request.onerror = (event) => {
      reject(event.target.error);
    };
  });
}

export async function getItem(key) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(key);
      request.onsuccess = () => {
        if (request.result !== undefined) {
          resolve(request.result);
        } else {
          // Fallback to localStorage
          try {
            const val = localStorage.getItem(key);
            resolve(val ? JSON.parse(val) : null);
          } catch (e) {
            resolve(null);
          }
        }
      };
      request.onerror = () => {
        // Fallback to localStorage
        try {
          const val = localStorage.getItem(key);
          resolve(val ? JSON.parse(val) : null);
        } catch (e) {
          resolve(null);
        }
      };
    });
  } catch (err) {
    console.warn("IndexedDB not available, falling back to localStorage", err);
    try {
      const val = localStorage.getItem(key);
      return val ? JSON.parse(val) : null;
    } catch (e) {
      return null;
    }
  }
}

export async function setItem(key, value) {
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(value, key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn("IndexedDB write failed, falling back to localStorage", err);
    localStorage.setItem(key, JSON.stringify(value));
  }
}

export async function removeItem(key) {
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn("IndexedDB delete failed, falling back to localStorage", err);
  }
  // Always clear localStorage as well for clean up
  try {
    localStorage.removeItem(key);
  } catch (e) {}
}
