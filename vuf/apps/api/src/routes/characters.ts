import { Router } from 'express';
import { asyncHandler, notFound, parsePagination } from '../util/http.js';
import * as charactersRepo from '../repositories/characters.js';
import { characterCreateSchema, characterUpdateSchema } from '../schemas.js';

export const charactersRouter = Router();

charactersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, pageSize } = parsePagination(req.query);
    const result = await charactersRepo.listCharacters({
      page,
      pageSize,
      clan: typeof req.query.clan === 'string' ? req.query.clan : undefined,
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
    });
    res.json(result);
  }),
);

charactersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const character = await charactersRepo.getCharacter(id);
    if (!character) throw notFound('Персонаж не найден');
    res.json({ data: character });
  }),
);

charactersRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = characterCreateSchema.parse(req.body);
    const character = await charactersRepo.createCharacter(input);
    res.status(201).json({ data: character });
  }),
);

charactersRouter.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const input = characterUpdateSchema.parse(req.body);
    const character = await charactersRepo.updateCharacter(id, input);
    res.json({ data: character });
  }),
);

charactersRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    await charactersRepo.deleteCharacter(id);
    res.status(204).send();
  }),
);
