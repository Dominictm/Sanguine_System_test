import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { CharacterCreateInput, CharacterUpdateInput } from '@vuf/shared';
import { slugify } from '@vuf/shared';

export interface ListOptions {
  page: number;
  pageSize: number;
  clan?: string;
  status?: string;
  search?: string;
}

export async function listCharacters(opts: ListOptions) {
  const page = Math.max(1, opts.page);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize));

  const where: Prisma.CharacterWhereInput = {
    ...(opts.clan ? { clan: opts.clan as Prisma.EnumClanFilter['equals'] } : {}),
    ...(opts.status
      ? { status: opts.status as Prisma.EnumCharacterStatusFilter['equals'] }
      : {}),
    ...(opts.search
      ? { name: { contains: opts.search } }
      : {}),
  };

  const [data, total] = await Promise.all([
    prisma.character.findMany({
      where,
      orderBy: { name: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.character.count({ where }),
  ]);

  return {
    data,
    meta: {
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize) || 1,
    },
  };
}

export async function getCharacter(id: number) {
  return prisma.character.findUnique({
    where: { id },
    include: { scenarioCharacters: true },
  });
}

export async function createCharacter(input: CharacterCreateInput) {
  const slug = input.slug || slugify(input.name);
  return prisma.character.create({
    data: {
      name: input.name,
      slug,
      concept: input.concept,
      lineage: input.lineage ?? 'VAMPIRE',
      clan: input.clan ?? 'NONE',
      generation: input.generation,
      sire: input.sire,
      status: input.status ?? 'ALIVE',
      role: input.role ?? 'NPC',
      playerName: input.playerName,
      nature: input.nature,
      demeanor: input.demeanor,
      attributes: input.attributes as Prisma.InputJsonValue | undefined,
      abilities: input.abilities as Prisma.InputJsonValue | undefined,
      virtues: input.virtues as Prisma.InputJsonValue | undefined,
      disciplines: input.disciplines as Prisma.InputJsonValue | undefined,
      backgrounds: input.backgrounds as Prisma.InputJsonValue | undefined,
      humanity: input.humanity,
      path: input.path,
      willpower: input.willpower,
      bloodPool: input.bloodPool,
      biography: input.biography,
      goals: input.goals,
      notes: input.notes,
    },
  });
}

export async function updateCharacter(id: number, input: CharacterUpdateInput) {
  const data: Prisma.CharacterUpdateInput = {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.concept !== undefined ? { concept: input.concept } : {}),
    ...(input.lineage !== undefined ? { lineage: input.lineage } : {}),
    ...(input.clan !== undefined ? { clan: input.clan } : {}),
    ...(input.generation !== undefined
      ? { generation: input.generation }
      : {}),
    ...(input.sire !== undefined ? { sire: input.sire } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.role !== undefined ? { role: input.role } : {}),
    ...(input.playerName !== undefined
      ? { playerName: input.playerName }
      : {}),
    ...(input.nature !== undefined ? { nature: input.nature } : {}),
    ...(input.demeanor !== undefined ? { demeanor: input.demeanor } : {}),
    ...(input.attributes !== undefined
      ? { attributes: input.attributes as Prisma.InputJsonValue }
      : {}),
    ...(input.abilities !== undefined
      ? { abilities: input.abilities as Prisma.InputJsonValue }
      : {}),
    ...(input.virtues !== undefined
      ? { virtues: input.virtues as Prisma.InputJsonValue }
      : {}),
    ...(input.disciplines !== undefined
      ? { disciplines: input.disciplines as Prisma.InputJsonValue }
      : {}),
    ...(input.backgrounds !== undefined
      ? { backgrounds: input.backgrounds as Prisma.InputJsonValue }
      : {}),
    ...(input.humanity !== undefined ? { humanity: input.humanity } : {}),
    ...(input.path !== undefined ? { path: input.path } : {}),
    ...(input.willpower !== undefined ? { willpower: input.willpower } : {}),
    ...(input.bloodPool !== undefined ? { bloodPool: input.bloodPool } : {}),
    ...(input.biography !== undefined ? { biography: input.biography } : {}),
    ...(input.goals !== undefined ? { goals: input.goals } : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
  };
  return prisma.character.update({ where: { id }, data });
}

export async function deleteCharacter(id: number) {
  await prisma.character.delete({ where: { id } });
}
