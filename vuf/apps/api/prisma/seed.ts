import { PrismaClient } from '@prisma/client';
import { loadEnvFile } from 'node:process';

// Подгружаем .env из каталога приложения (apps/api), если он есть
try {
  loadEnvFile();
} catch {
  /* .env отсутствует — используем переменные окружения */
}

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.upsert({
    where: { email: 'root@vuf.local' },
    update: {},
    create: { email: 'root@vuf.local', name: 'Рассказчик', role: 'root' },
  });

  const lucien = await prisma.character.upsert({
    where: { slug: 'lucien_vale' },
    update: {},
    create: {
      userId: user.id,
      name: 'Люсьен Вейл',
      slug: 'lucien_vale',
      concept: 'Аристократ-манипулятор',
      lineage: 'VAMPIRE',
      clan: 'VENTRUE',
      generation: 9,
      sire: 'Сэр Август',
      status: 'ALIVE',
      role: 'NPC',
      nature: 'Коннетабль',
      demeanor: 'Джентльмен',
      attributes: { strength: 2, dexterity: 3, stamina: 3, charisma: 4, manipulation: 4, appearance: 3, perception: 3, intelligence: 3, wits: 3 },
      abilities: { alertness: 3, intimidation: 2, streetwise: 2, etiquette: 4, politics: 4, investigation: 3 },
      virtues: { conscience: 2, selfControl: 3, courage: 3 },
      disciplines: { dominate: 3, fortitude: 2, presence: 3 },
      backgrounds: { resources: 4, status: 3, contacts: 2 },
      humanity: 6,
      willpower: 5,
      bloodPool: 15,
      biography: 'Видный Примоген Камарильи, хранитель баланса в Совете.',
      goals: 'Укрепить влияние клана в Совете.',
    },
  });

  const club = await prisma.location.upsert({
    where: { slug: 'velvet_nocturne' },
    update: {},
    create: {
      userId: user.id,
      name: 'Velvet Nocturne',
      slug: 'velvet_nocturne',
      type: 'CLUB',
      city: 'Париж',
      district: 'Маре',
      description: 'Элитный клуб, излюбленное место Элизиума по пятницам.',
      atmosphere: 'Приглушённый свет, бархат и запах дыма и дорогих духов.',
      hooks: 'Шёпоты о сделках между кланами в приватных ложах.',
    },
  });

  const haven = await prisma.location.upsert({
    where: { slug: 'lucien_haven' },
    update: {},
    create: {
      userId: user.id,
      name: 'Убежище Люсьена',
      slug: 'lucien_haven',
      type: 'HAVEN',
      city: 'Париж',
      description: 'Старинный особняк на холме, защищённый от посторонних глаз.',
    },
  });

  const scenario = await prisma.scenario.upsert({
    where: { id: 1 },
    update: {},
    create: {
      userId: user.id,
      title: 'Шёпот в Элизиуме',
      summary: 'Примогены собираются, чтобы обсудить исчезновение старейшины Тореадоров.',
      phase: 'A',
      status: 'DRAFT',
      notes: 'Открытая нить: кто-то знает больше, чем говорит.',
    },
  });

  await prisma.scenarioCharacter.upsert({
    where: { scenarioId_characterId: { scenarioId: scenario.id, characterId: lucien.id } },
    update: {},
    create: { scenarioId: scenario.id, characterId: lucien.id, role: 'Хозяин вечера' },
  });
  await prisma.scenarioLocation.upsert({
    where: { scenarioId_locationId: { scenarioId: scenario.id, locationId: club.id } },
    update: {},
    create: { scenarioId: scenario.id, locationId: club.id, purpose: 'Место сбора Элизиума' },
  });

  console.log('✅ Seed завершён: пользователь, персонаж, локации, сценарий и связи созданы.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
