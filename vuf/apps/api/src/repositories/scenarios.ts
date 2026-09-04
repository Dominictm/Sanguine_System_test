import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { ScenarioCreateInput, ScenarioUpdateInput } from '@vuf/shared';

export interface ListOptions {
  page: number;
  pageSize: number;
  status?: string;
  search?: string;
}

export async function listScenarios(opts: ListOptions) {
  const page = Math.max(1, opts.page);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize));

  const where: Prisma.ScenarioWhereInput = {
    ...(opts.status
      ? { status: opts.status as Prisma.EnumScenarioStatusFilter['equals'] }
      : {}),
    ...(opts.search ? { title: { contains: opts.search } } : {}),
  };

  const [data, total] = await Promise.all([
    prisma.scenario.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        _count: { select: { characters: true, locations: true } },
      },
    }),
    prisma.scenario.count({ where }),
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

export async function getScenario(id: number) {
  return prisma.scenario.findUnique({
    where: { id },
    include: {
      characters: { include: { character: true } },
      locations: { include: { location: true } },
    },
  });
}

export async function createScenario(input: ScenarioCreateInput) {
  return prisma.scenario.create({
    data: {
      title: input.title,
      summary: input.summary,
      phase: input.phase ?? 'A',
      status: input.status ?? 'DRAFT',
      notes: input.notes,
    },
  });
}

export async function updateScenario(id: number, input: ScenarioUpdateInput) {
  const data: Prisma.ScenarioUpdateInput = {
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.summary !== undefined ? { summary: input.summary } : {}),
    ...(input.phase !== undefined ? { phase: input.phase } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
  };
  return prisma.scenario.update({ where: { id }, data });
}

export async function deleteScenario(id: number) {
  await prisma.scenario.delete({ where: { id } });
}

// --- Связки сценария ⇄ персонажи / локации (M:N) ---

export async function setScenarioCharacters(scenarioId: number, links: { characterId: number; role?: string }[]) {
  await prisma.$transaction([
    prisma.scenarioCharacter.deleteMany({ where: { scenarioId } }),
    ...links.map((l) =>
      prisma.scenarioCharacter.create({
        data: {
          scenarioId,
          characterId: l.characterId,
          role: l.role,
        },
      }),
    ),
  ]);
  return getScenario(scenarioId);
}

export async function setScenarioLocations(scenarioId: number, links: { locationId: number; purpose?: string }[]) {
  await prisma.$transaction([
    prisma.scenarioLocation.deleteMany({ where: { scenarioId } }),
    ...links.map((l) =>
      prisma.scenarioLocation.create({
        data: {
          scenarioId,
          locationId: l.locationId,
          purpose: l.purpose,
        },
      }),
    ),
  ]);
  return getScenario(scenarioId);
}
