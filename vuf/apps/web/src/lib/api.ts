import type {
  Character,
  CharacterCreateInput,
  CharacterUpdateInput,
  Location,
  LocationCreateInput,
  LocationUpdateInput,
  Paginated,
  Scenario,
  ScenarioCreateInput,
  ScenarioUpdateInput,
} from '@vuf/shared';

const BASE = import.meta.env.VITE_API_BASE ?? '/api/v1';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    let message = `Ошибка ${res.status}`;
    try {
      const body = await res.json();
      message = body?.error?.message ?? message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  // characters
  listCharacters: (page = 1, pageSize = 25) =>
    request<Paginated<Character>>(`/characters?page=${page}&pageSize=${pageSize}`),
  getCharacter: (id: number) => request<{ data: Character }>(`/characters/${id}`),
  createCharacter: (input: CharacterCreateInput) =>
    request<{ data: Character }>('/characters', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateCharacter: (id: number, input: CharacterUpdateInput) =>
    request<{ data: Character }>(`/characters/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  deleteCharacter: (id: number) => request<void>(`/characters/${id}`, { method: 'DELETE' }),

  // locations
  listLocations: (page = 1, pageSize = 25) =>
    request<Paginated<Location>>(`/locations?page=${page}&pageSize=${pageSize}`),
  getLocation: (id: number) => request<{ data: Location }>(`/locations/${id}`),
  createLocation: (input: LocationCreateInput) =>
    request<{ data: Location }>('/locations', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateLocation: (id: number, input: LocationUpdateInput) =>
    request<{ data: Location }>(`/locations/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  deleteLocation: (id: number) => request<void>(`/locations/${id}`, { method: 'DELETE' }),

  // scenarios
  listScenarios: (page = 1, pageSize = 25) =>
    request<Paginated<Scenario>>(`/scenarios?page=${page}&pageSize=${pageSize}`),
  getScenario: (id: number) => request<{ data: Scenario }>(`/scenarios/${id}`),
  createScenario: (input: ScenarioCreateInput) =>
    request<{ data: Scenario }>('/scenarios', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateScenario: (id: number, input: ScenarioUpdateInput) =>
    request<{ data: Scenario }>(`/scenarios/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  deleteScenario: (id: number) => request<void>(`/scenarios/${id}`, { method: 'DELETE' }),

  getScenarioCharacters: (id: number) => request<{ data: unknown[] }>(`/scenarios/${id}/characters`),
  getScenarioLocations: (id: number) => request<{ data: unknown[] }>(`/scenarios/${id}/locations`),
};
