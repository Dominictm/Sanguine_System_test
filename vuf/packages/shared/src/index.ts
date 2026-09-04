// Vuf shared domain types (framework-agnostic, used by both API and Web)

// ------------- Enum-based domains -------------

export type Clan =
  | 'BRUJAH'
  | 'GANGREL'
  | 'MALKAVIAN'
  | 'NOSFERATU'
  | 'TOREADOR'
  | 'TREMERE'
  | 'TZIMISCE'
  | 'VENTRUE'
  | 'CAPPADOCIAN'
  | 'ASSAMITE'
  | 'TRUE_BRUJAH'
  | 'CAITIFF'
  | 'OTHER'
  | 'NONE';

export type Lineage =
  | 'VAMPIRE'
  | 'MAGE'
  | 'WEREWOLF'
  | 'FAIRY'
  | 'MORTAL'
  | 'HUNTER'
  | 'UNKNOWN';

export type CharacterStatus =
  | 'ALIVE'
  | 'TORPOR'
  | 'DEAD'
  | 'MISSING'
  | 'UNKNOWN'
  | 'ACTIVE';

export type CharacterRole = 'PLAYER' | 'NPC' | 'EPISODIC' | 'FAMILIAR';

export type LocationType =
  | 'HAVEN'
  | 'CLUB'
  | 'ELYSIUM'
  | 'STREET'
  | 'OFFICE'
  | 'RESIDENCE'
  | 'GOVERNMENT'
  | 'UNDERGROUND'
  | 'OTHER';

export type ScenarioStatus = 'DRAFT' | 'READY' | 'PLAYED' | 'ARCHIVED';
export type ScenarioPhase = 'A' | 'B' | 'C';

// ------------- entities -------------

export interface Character {
  id: number;
  name: string;
  slug: string;
  concept?: string | null;
  lineage: Lineage;
  clan: Clan;
  generation?: number | null;
  sire?: string | null;
  status: CharacterStatus;
  role: CharacterRole;
  playerName?: string | null;
  nature?: string | null;
  demeanor?: string | null;
  attributes?: Record<string, number> | null;
  abilities?: Record<string, number> | null;
  virtues?: Record<string, number> | null;
  disciplines?: Record<string, number> | null;
  backgrounds?: Record<string, number> | null;
  humanity?: number | null;
  path?: string | null;
  willpower?: number | null;
  bloodPool?: number | null;
  biography?: string | null;
  goals?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Location {
  id: number;
  name: string;
  slug: string;
  type: LocationType;
  city?: string | null;
  district?: string | null;
  address?: string | null;
  description?: string | null;
  atmosphere?: string | null;
  hooks?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Scenario {
  id: number;
  title: string;
  summary?: string | null;
  phase: ScenarioPhase;
  status: ScenarioStatus;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { characters: number; locations: number };
}

export interface ScenarioCharacterLink {
  scenarioId: number;
  characterId: number;
  role?: string | null;
}

export interface ScenarioLocationLink {
  scenarioId: number;
  locationId: number;
  purpose?: string | null;
}

// ------------- DTO -------------

export interface Paginated<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface CharacterCreateInput {
  name: string;
  slug?: string;
  concept?: string;
  lineage?: Lineage;
  clan?: Clan;
  generation?: number;
  sire?: string;
  status?: CharacterStatus;
  role?: CharacterRole;
  playerName?: string;
  nature?: string;
  demeanor?: string;
  attributes?: Record<string, number>;
  abilities?: Record<string, number>;
  virtues?: Record<string, number>;
  disciplines?: Record<string, number>;
  backgrounds?: Record<string, number>;
  humanity?: number;
  path?: string;
  willpower?: number;
  bloodPool?: number;
  biography?: string;
  goals?: string;
  notes?: string;
}

export type CharacterUpdateInput = Partial<CharacterCreateInput>;

export interface LocationCreateInput {
  name: string;
  slug?: string;
  type?: LocationType;
  city?: string;
  district?: string;
  address?: string;
  description?: string;
  atmosphere?: string;
  hooks?: string;
  notes?: string;
}

export type LocationUpdateInput = Partial<LocationCreateInput>;

export interface ScenarioCreateInput {
  title: string;
  summary?: string;
  phase?: ScenarioPhase;
  status?: ScenarioStatus;
  notes?: string;
}

export type ScenarioUpdateInput = Partial<ScenarioCreateInput>;

// Утилита: слаг по имени (транслитерация-заглушка, ASCII ключ)
export function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'item'
  );
}
