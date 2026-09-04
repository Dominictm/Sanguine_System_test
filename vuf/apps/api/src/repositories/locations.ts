import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { LocationCreateInput, LocationUpdateInput, slugify } from '@vuf/shared';

export interface ListOptions {
  page: number;
  pageSize: number;
  type?: string;
  city?: string;
  search?: string;
}

export async function listLocations(opts: ListOptions) {
  const page = Math.max(1, opts.page);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize));

  const where: Prisma.LocationWhereInput = {
    ...(opts.type ? { type: opts.type as Prisma.EnumLocationTypeFilter['equals'] } : {}),
    ...(opts.city ? { city: { contains: opts.city } } : {}),
    ...(opts.search ? { name: { contains: opts.search } } : {}),
  };

  const [data, total] = await Promise.all([
    prisma.location.findMany({
      where,
      orderBy: { name: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.location.count({ where }),
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

export async function getLocation(id: number) {
  return prisma.location.findUnique({
    where: { id },
    include: { scenarioLocations: true },
  });
}

export async function createLocation(input: LocationCreateInput) {
  const slug = input.slug || slugify(input.name);
  return prisma.location.create({
    data: {
      name: input.name,
      slug,
      type: input.type ?? 'OTHER',
      city: input.city,
      district: input.district,
      address: input.address,
      description: input.description,
      atmosphere: input.atmosphere,
      hooks: input.hooks,
      notes: input.notes,
    },
  });
}

export async function updateLocation(id: number, input: LocationUpdateInput) {
  const data: Prisma.LocationUpdateInput = {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.type !== undefined ? { type: input.type } : {}),
    ...(input.city !== undefined ? { city: input.city } : {}),
    ...(input.district !== undefined ? { district: input.district } : {}),
    ...(input.address !== undefined ? { address: input.address } : {}),
    ...(input.description !== undefined
      ? { description: input.description }
      : {}),
    ...(input.atmosphere !== undefined
      ? { atmosphere: input.atmosphere }
      : {}),
    ...(input.hooks !== undefined ? { hooks: input.hooks } : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
  };
  return prisma.location.update({ where: { id }, data });
}

export async function deleteLocation(id: number) {
  await prisma.location.delete({ where: { id } });
}
