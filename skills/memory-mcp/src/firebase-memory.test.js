import { describe, it, expect, beforeEach, vi } from 'vitest';

// Hoisted mocks so factory functions can reference them
const {
  mockSet,
  mockPushRef,
  mockPush,
  mockOnce,
  mockUpdate,
  mockRemove,
  mockRef,
  mockDb,
  mockApp,
} = vi.hoisted(() => {
  const mockSet = vi.fn().mockResolvedValue(undefined);
  const mockPushRef = { key: 'auto-generated-id', set: mockSet };
  const mockPush = vi.fn(() => mockPushRef);
  const mockOnce = vi.fn();
  const mockUpdate = vi.fn().mockResolvedValue(undefined);
  const mockRemove = vi.fn().mockResolvedValue(undefined);
  const mockRef = vi.fn(() => ({ push: mockPush, once: mockOnce, update: mockUpdate, remove: mockRemove }));
  const mockDb = { ref: mockRef };
  const mockApp = { database: vi.fn(() => mockDb) };
  return { mockSet, mockPushRef, mockPush, mockOnce, mockUpdate, mockRemove, mockRef, mockDb, mockApp };
});

vi.mock('firebase-admin', () => ({
  default: {
    app: vi.fn(() => mockApp),
    initializeApp: vi.fn(),
    credential: { cert: vi.fn(() => ({})) },
  },
}));

vi.mock('fs', () => ({
  readFileSync: vi.fn(() => JSON.stringify({ type: 'service_account' })),
}));

vi.mock('./config.js', () => ({
  firebaseConfig: {
    useFirebaseMemory: true,
    serviceAccountPath: '/fake/service-account.json',
    databaseURL: 'https://fake-project.firebaseio.com',
  },
}));

import {
  createMemoryEntry,
  getMemoryEntries,
  getMemoryEntry,
  updateMemoryEntry,
  deleteMemoryEntry,
  getMemoryDb,
  COLLECTIONS,
} from './firebase-memory.js';

// ── getMemoryDb — error paths ─────────────────────────────
// Each test uses vi.resetModules() + vi.doMock() to get a fresh module instance
// with db=null so the initialization guards can be exercised.

describe('getMemoryDb — error paths', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('lanza error cuando useFirebaseMemory=false', async () => {
    vi.doMock('./config.js', () => ({
      firebaseConfig: { useFirebaseMemory: false, serviceAccountPath: '', databaseURL: '' },
    }));
    vi.doMock('firebase-admin', () => ({
      default: { app: vi.fn(), initializeApp: vi.fn(), credential: { cert: vi.fn() } },
    }));
    vi.doMock('fs', () => ({ readFileSync: vi.fn() }));
    const { getMemoryDb: fresh } = await import('./firebase-memory.js');
    expect(() => fresh()).toThrow('USE_FIREBASE_MEMORY=true requerido');
  });

  it('lanza error cuando faltan credenciales', async () => {
    vi.doMock('./config.js', () => ({
      firebaseConfig: { useFirebaseMemory: true, serviceAccountPath: '', databaseURL: '' },
    }));
    vi.doMock('firebase-admin', () => ({
      default: { app: vi.fn(), initializeApp: vi.fn(), credential: { cert: vi.fn() } },
    }));
    vi.doMock('fs', () => ({ readFileSync: vi.fn() }));
    const { getMemoryDb: fresh } = await import('./firebase-memory.js');
    expect(() => fresh()).toThrow('Faltan variables de entorno Firebase');
  });

  it('lanza error cuando readFileSync falla', async () => {
    vi.doMock('./config.js', () => ({
      firebaseConfig: {
        useFirebaseMemory: true,
        serviceAccountPath: '/bad/path.json',
        databaseURL: 'https://test.firebaseio.com',
      },
    }));
    vi.doMock('firebase-admin', () => ({
      default: {
        app: vi.fn(() => { throw new Error('app not found'); }),
        initializeApp: vi.fn(),
        credential: { cert: vi.fn() },
      },
    }));
    vi.doMock('fs', () => ({
      readFileSync: vi.fn(() => { throw new Error('ENOENT: no such file'); }),
    }));
    const { getMemoryDb: fresh } = await import('./firebase-memory.js');
    expect(() => fresh()).toThrow('No se pudo leer o parsear');
  });
});

describe('firebase-memory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPush.mockReturnValue(mockPushRef);
    mockRef.mockImplementation(() => ({
      push: mockPush,
      once: mockOnce,
      update: mockUpdate,
      remove: mockRemove,
    }));
  });

  // ── COLLECTIONS ───────────────────────────────────────────

  describe('COLLECTIONS', () => {
    it('expone las tres colecciones correctas', () => {
      expect(COLLECTIONS.PATTERNS).toBe('patterns');
      expect(COLLECTIONS.DECISIONS).toBe('decisions');
      expect(COLLECTIONS.LESSONS).toBe('lessons');
    });
  });

  // ── createMemoryEntry ─────────────────────────────────────

  describe('createMemoryEntry', () => {
    it('llama a ref con la ruta correcta y hace push + set', async () => {
      const result = await createMemoryEntry('proj-1', 'patterns', {
        text: 'TypeError en producción',
        severity: 'high',
      });

      expect(mockRef).toHaveBeenCalledWith('memory/proj-1/patterns');
      expect(mockPush).toHaveBeenCalled();
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'TypeError en producción', severity: 'high' })
      );
      expect(result).toEqual({ id: 'auto-generated-id' });
    });

    it('aplica valores por defecto en campos opcionales', async () => {
      await createMemoryEntry('proj-1', 'patterns', { text: 'simple pattern' });

      const [entry] = mockSet.mock.calls[0];
      expect(entry.embedding).toBeNull();
      expect(entry.severity).toBeNull();
      expect(entry.frequency).toBe(0);
      expect(entry.relatedFiles).toEqual([]);
      expect(entry.lastSeen).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('funciona con las tres colecciones', async () => {
      for (const col of Object.values(COLLECTIONS)) {
        mockRef.mockImplementationOnce(() => ({ push: mockPush, once: mockOnce, update: mockUpdate, remove: mockRemove }));
        await createMemoryEntry('proj-1', col, { text: `entry en ${col}` });
        expect(mockRef).toHaveBeenCalledWith(`memory/proj-1/${col}`);
      }
    });
  });

  // ── getMemoryEntries ──────────────────────────────────────

  describe('getMemoryEntries', () => {
    it('devuelve array de entries cuando la colección tiene datos', async () => {
      mockOnce.mockResolvedValue({
        exists: () => true,
        val: () => ({
          'id-1': { text: 'patrón A', frequency: 3, relatedFiles: [], lastSeen: '2024-01-01T00:00:00.000Z' },
          'id-2': { text: 'patrón B', frequency: 1, relatedFiles: [], lastSeen: '2024-01-02T00:00:00.000Z' },
        }),
      });

      const entries = await getMemoryEntries('proj-1', 'patterns');

      expect(mockRef).toHaveBeenCalledWith('memory/proj-1/patterns');
      expect(mockOnce).toHaveBeenCalledWith('value');
      expect(entries).toHaveLength(2);
      expect(entries[0]).toMatchObject({ id: 'id-1', text: 'patrón A' });
      expect(entries[1]).toMatchObject({ id: 'id-2', text: 'patrón B' });
    });

    it('devuelve array vacío cuando la colección no existe', async () => {
      mockOnce.mockResolvedValue({ exists: () => false, val: () => null });

      const entries = await getMemoryEntries('proj-1', 'patterns');

      expect(entries).toEqual([]);
    });
  });

  // ── getMemoryEntry ────────────────────────────────────────

  describe('getMemoryEntry', () => {
    it('devuelve la entry con su id cuando existe', async () => {
      mockOnce.mockResolvedValue({
        exists: () => true,
        val: () => ({ text: 'un patrón', frequency: 5, relatedFiles: ['src/foo.js'] }),
      });

      const entry = await getMemoryEntry('proj-1', 'patterns', 'entry-abc');

      expect(mockRef).toHaveBeenCalledWith('memory/proj-1/patterns/entry-abc');
      expect(entry).toMatchObject({ id: 'entry-abc', text: 'un patrón', frequency: 5 });
    });

    it('devuelve null cuando la entry no existe', async () => {
      mockOnce.mockResolvedValue({ exists: () => false, val: () => null });

      const entry = await getMemoryEntry('proj-1', 'patterns', 'nonexistent');

      expect(entry).toBeNull();
    });
  });

  // ── updateMemoryEntry ─────────────────────────────────────

  describe('updateMemoryEntry', () => {
    it('llama a update con la ruta y datos correctos', async () => {
      await updateMemoryEntry('proj-1', 'decisions', 'entry-xyz', { frequency: 10, lastSeen: '2024-06-01T00:00:00.000Z' });

      expect(mockRef).toHaveBeenCalledWith('memory/proj-1/decisions/entry-xyz');
      expect(mockUpdate).toHaveBeenCalledWith({ frequency: 10, lastSeen: '2024-06-01T00:00:00.000Z' });
    });

    it('sanitiza undefined a null antes de actualizar', async () => {
      await updateMemoryEntry('proj-1', 'patterns', 'entry-xyz', { frequency: 1, embedding: undefined });

      const [data] = mockUpdate.mock.calls[0];
      expect(data.embedding).toBeNull();
    });
  });

  // ── deleteMemoryEntry ─────────────────────────────────────

  describe('deleteMemoryEntry', () => {
    it('llama a remove con la ruta correcta', async () => {
      await deleteMemoryEntry('proj-1', 'lessons', 'lesson-99');

      expect(mockRef).toHaveBeenCalledWith('memory/proj-1/lessons/lesson-99');
      expect(mockRemove).toHaveBeenCalled();
    });
  });

  // ── collection validation ─────────────────────────────────

  describe('validación de collection', () => {
    it('createMemoryEntry lanza error con colección inválida', async () => {
      await expect(createMemoryEntry('proj-1', 'hacks', { text: 'x' })).rejects.toThrow('Colección inválida');
    });

    it('getMemoryEntries lanza error con colección inválida', async () => {
      await expect(getMemoryEntries('proj-1', 'hacks')).rejects.toThrow('Colección inválida');
    });

    it('getMemoryEntry lanza error con colección inválida', async () => {
      await expect(getMemoryEntry('proj-1', 'hacks', 'id-1')).rejects.toThrow('Colección inválida');
    });

    it('updateMemoryEntry lanza error con colección inválida', async () => {
      await expect(updateMemoryEntry('proj-1', 'hacks', 'id-1', { frequency: 1 })).rejects.toThrow('Colección inválida');
    });

    it('deleteMemoryEntry lanza error con colección inválida', async () => {
      await expect(deleteMemoryEntry('proj-1', 'hacks', 'id-1')).rejects.toThrow('Colección inválida');
    });
  });
});
