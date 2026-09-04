import { z } from 'zod';

const clanEnum = z.enum([
  'BRUJAH', 'GANGREL', 'MALKAVIAN', 'NOSFERATU', 'TOREADOR', 'TREMERE',
  'TZIMISCE', 'VENTRUE', 'CAPPADOCIAN', 'ASSAMITE', 'TRUE_BRUJAH', 'CAITIFF',
  'OTHER', 'NONE',
]);

const lineageEnum = z.enum([
  'VAMPIRE', 'MAGE', 'WEREWOLF', 'FAIRY', 'MORTAL', 'HUNTER', 'UNKNOWN',
]);

const statusEnum = z.enum(['ALIVE', 'TORPOR', 'DEAD', 'MISSING', 'UNKNOWN', 'ACTIVE']);
const roleEnum = z.enum(['PLAYER', 'NPC', 'EPISODIC', 'FAMILIAR']);
const locationTypeEnum = z.enum([
  'HAVEN', 'CLUB', 'ELYSIUM', 'STREET', 'OFFICE', 'RESIDENCE',
  'GOVERNMENT', 'UNDERGROUND', 'OTHER',
]);
const scenarioStatusEnum = z.enum(['DRAFT', 'READY', 'PLAYED', 'ARCHIVED']);
const scenarioPhaseEnum = z.enum(['A', 'B', 'C']);

const jsonRecord = z.record(z.string(), z.number()).optional();

export const characterCreateSchema = z.object({
  name: z.string().min(1, 'Имя обязательно'),
  slug: z.string().optional(),
  concept: z.string().optional(),
  lineage: lineageEnum.optional(),
  clan: clanEnum.optional(),
  generation: z.number().int().min(1).max(16).optional(),
  sire: z.string().optional(),
  status: statusEnum.optional(),
  role: roleEnum.optional(),
  playerName: z.string().optional(),
  nature: z.string().optional(),
  demeanor: z.string().optional(),
  attributes: jsonRecord,
  abilities: jsonRecord,
  virtues: jsonRecord,
  disciplines: jsonRecord,
  backgrounds: jsonRecord,
  humanity: z.number().int().min(0).max(10).optional(),
  path: z.string().optional(),
  willpower: z.number().int().min(0).max(10).optional(),
  bloodPool: z.number().int().min(0).optional(),
  biography: z.string().optional(),
  goals: z.string().optional(),
  notes: z.string().optional(),
});

export const characterUpdateSchema = characterCreateSchema.partial();

export const locationCreateSchema = z.object({
  name: z.string().min(1, 'Название обязательно'),
  slug: z.string().optional(),
  type: locationTypeEnum.optional(),
  city: z.string().optional(),
  district: z.string().optional(),
  address: z.string().optional(),
  description: z.string().optional(),
  atmosphere: z.string().optional(),
  hooks: z.string().optional(),
  notes: z.string().optional(),
});

export const locationUpdateSchema = locationCreateSchema.partial();

export const scenarioCreateSchema = z.object({
  title: z.string().min(1, 'Название обязательно'),
  summary: z.string().optional(),
  phase: scenarioPhaseEnum.optional(),
  status: scenarioStatusEnum.optional(),
  notes: z.string().optional(),
});

export const scenarioUpdateSchema = scenarioCreateSchema.partial();

export const scenarioCharactersSchema = z.object({
  characters: z
    .array(
      z.object({
        characterId: z.number().int().positive(),
        role: z.string().optional(),
      }),
    )
    .default([]),
});

export const scenarioLocationsSchema = z.object({
  locations: z
    .array(
      z.object({
        locationId: z.number().int().positive(),
        purpose: z.string().optional(),
      }),
    )
    .default([]),
});
