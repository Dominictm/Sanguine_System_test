import { Router } from 'express';
import { asyncHandler, notFound, parsePagination } from '../util/http.js';
import * as scenariosRepo from '../repositories/scenarios.js';
import {
  scenarioCreateSchema,
  scenarioUpdateSchema,
  scenarioCharactersSchema,
  scenarioLocationsSchema,
} from '../schemas.js';

export const scenariosRouter = Router();

scenariosRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, pageSize } = parsePagination(req.query);
    const result = await scenariosRepo.listScenarios({
      page,
      pageSize,
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
    });
    res.json(result);
  }),
);

scenariosRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const scenario = await scenariosRepo.getScenario(id);
    if (!scenario) throw notFound('Сценарий не найден');
    res.json({ data: scenario });
  }),
);

scenariosRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = scenarioCreateSchema.parse(req.body);
    const scenario = await scenariosRepo.createScenario(input);
    res.status(201).json({ data: scenario });
  }),
);

scenariosRouter.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const input = scenarioUpdateSchema.parse(req.body);
    const scenario = await scenariosRepo.updateScenario(id, input);
    res.json({ data: scenario });
  }),
);

scenariosRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    await scenariosRepo.deleteScenario(id);
    res.status(204).send();
  }),
);

// Персонажи сценария
scenariosRouter.get(
  '/:id/characters',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const scenario = await scenariosRepo.getScenario(id);
    if (!scenario) throw notFound('Сценарий не найден');
    res.json({ data: scenario.characters });
  }),
);

scenariosRouter.put(
  '/:id/characters',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { characters } = scenarioCharactersSchema.parse(req.body);
    const scenario = await scenariosRepo.setScenarioCharacters(id, characters);
    res.json({ data: scenario });
  }),
);

// Локации сценария
scenariosRouter.get(
  '/:id/locations',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const scenario = await scenariosRepo.getScenario(id);
    if (!scenario) throw notFound('Сценарий не найден');
    res.json({ data: scenario.locations });
  }),
);

scenariosRouter.put(
  '/:id/locations',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { locations } = scenarioLocationsSchema.parse(req.body);
    const scenario = await scenariosRepo.setScenarioLocations(id, locations);
    res.json({ data: scenario });
  }),
);
