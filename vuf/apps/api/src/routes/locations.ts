import { Router } from 'express';
import { asyncHandler, notFound, parsePagination } from '../util/http.js';
import * as locationsRepo from '../repositories/locations.js';
import { locationCreateSchema, locationUpdateSchema } from '../schemas.js';

export const locationsRouter = Router();

locationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, pageSize } = parsePagination(req.query);
    const result = await locationsRepo.listLocations({
      page,
      pageSize,
      type: typeof req.query.type === 'string' ? req.query.type : undefined,
      city: typeof req.query.city === 'string' ? req.query.city : undefined,
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
    });
    res.json(result);
  }),
);

locationsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const location = await locationsRepo.getLocation(id);
    if (!location) throw notFound('Локация не найдена');
    res.json({ data: location });
  }),
);

locationsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = locationCreateSchema.parse(req.body);
    const location = await locationsRepo.createLocation(input);
    res.status(201).json({ data: location });
  }),
);

locationsRouter.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const input = locationUpdateSchema.parse(req.body);
    const location = await locationsRepo.updateLocation(id, input);
    res.json({ data: location });
  }),
);

locationsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    await locationsRepo.deleteLocation(id);
    res.status(204).send();
  }),
);
