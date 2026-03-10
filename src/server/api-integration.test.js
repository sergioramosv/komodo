import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { KomodoApiServer } from './api-server.js';
import { config } from '../config.js';
import { komodoState, EXECUTION_STATES } from '../state/komodo-state.js';

describe('API Integration Tests', () => {
  let server;
  const PORT = 3098;
  const API_KEY = 'integration-test-key';
  const BASE_URL = `http://localhost:${PORT}/api`;

  beforeAll(async () => {
    // Setup config for integration test
    config.apiPort = PORT;
    config.komodoApiKey = API_KEY;
    
    server = new KomodoApiServer({ 
      port: PORT,
      onRun: (tasks) => {
        // Mock onRun that just updates state
        komodoState.setExecutionState(EXECUTION_STATES.RUNNING);
        setTimeout(() => {
          komodoState.setExecutionState(EXECUTION_STATES.STOPPED);
        }, 100);
      },
      onCreateTask: async (data) => {
        return { id: 'new-task-id', ...data };
      }
    });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  // --- Authentication ---

  describe('Authentication', () => {
    it('returns 401 when X-Komodo-Key is missing', async () => {
      const res = await fetch(`${BASE_URL}/status`);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('Unauthorized');
    });

    it('returns 401 when X-Komodo-Key is incorrect', async () => {
      const res = await fetch(`${BASE_URL}/status`, {
        headers: { 'X-Komodo-Key': 'wrong-key' }
      });
      expect(res.status).toBe(401);
    });

    it('returns 200 when X-Komodo-Key is correct', async () => {
      const res = await fetch(`${BASE_URL}/status`, {
        headers: { 'X-Komodo-Key': API_KEY }
      });
      expect(res.status).toBe(200);
    });
  });

  // --- Endpoints ---

  describe('Endpoints', () => {
    it('GET /status returns system status', async () => {
      const res = await fetch(`${BASE_URL}/status`, {
        headers: { 'X-Komodo-Key': API_KEY }
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('executionState');
      expect(body).toHaveProperty('agents');
    });

    it('POST /run starts execution', async () => {
      const res = await fetch(`${BASE_URL}/run`, {
        method: 'POST',
        headers: { 
          'X-Komodo-Key': API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ tasks: 2 })
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('started');
      expect(body.tasks).toBe(2);
    });

    it('POST /stop stops execution', async () => {
      const res = await fetch(`${BASE_URL}/stop`, {
        method: 'POST',
        headers: { 'X-Komodo-Key': API_KEY }
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('stopping');
      expect(komodoState.setExecutionState).toHaveBeenCalled;
    });

    it('POST /pause pauses execution', async () => {
      const res = await fetch(`${BASE_URL}/pause`, {
        method: 'POST',
        headers: { 'X-Komodo-Key': API_KEY }
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('pausing');
    });

    it('POST /task creates a new task', async () => {
      const taskData = {
        title: 'Integration test task',
        userStory: 'As a dev I want to test',
        bizPoints: 3,
        devPoints: 5
      };
      const res = await fetch(`${BASE_URL}/task`, {
        method: 'POST',
        headers: { 
          'X-Komodo-Key': API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(taskData)
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.status).toBe('created');
      expect(body.task.title).toBe(taskData.title);
      expect(body.task.id).toBeDefined();
    });

    it('returns 404 for non-existent endpoint', async () => {
      const res = await fetch(`${BASE_URL}/non-existent`, {
        headers: { 'X-Komodo-Key': API_KEY }
      });
      expect(res.status).toBe(404);
    });
  });

  // --- Rate Limiting ---

  describe('Rate Limiting', () => {
    it('returns 429 when exceeding limit', async () => {
      // The limit is 60, but since we are running integration tests
      // we can't easily change the limit in the instance without
      // exposing it. 
      // But we can just blast it with 61 requests.
      
      const requests = [];
      for (let i = 0; i < 60; i++) {
        requests.push(fetch(`${BASE_URL}/status`, {
          headers: { 'X-Komodo-Key': API_KEY }
        }));
      }
      
      await Promise.all(requests);
      
      const res = await fetch(`${BASE_URL}/status`, {
        headers: { 'X-Komodo-Key': API_KEY }
      });
      
      expect(res.status).toBe(429);
      const body = await res.json();
      expect(body.error).toBe('Too Many Requests');
    });
  });
});
