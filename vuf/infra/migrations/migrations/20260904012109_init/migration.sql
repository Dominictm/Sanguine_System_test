-- CreateTable
CREATE TABLE `User` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `email` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NULL,
    `passwordHash` VARCHAR(191) NULL,
    `role` VARCHAR(191) NOT NULL DEFAULT 'root',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Character` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NULL,
    `name` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `concept` VARCHAR(191) NULL,
    `lineage` ENUM('VAMPIRE', 'MAGE', 'WEREWOLF', 'FAIRY', 'MORTAL', 'HUNTER', 'UNKNOWN') NOT NULL DEFAULT 'VAMPIRE',
    `clan` ENUM('BRUJAH', 'GANGREL', 'MALKAVIAN', 'NOSFERATU', 'TOREADOR', 'TREMERE', 'TZIMISCE', 'VENTRUE', 'CAPPADOCIAN', 'ASSAMITE', 'TRUE_BRUJAH', 'CAITIFF', 'OTHER', 'NONE') NOT NULL DEFAULT 'NONE',
    `generation` INTEGER NULL,
    `sire` VARCHAR(191) NULL,
    `status` ENUM('ALIVE', 'TORPOR', 'DEAD', 'MISSING', 'UNKNOWN', 'ACTIVE') NOT NULL DEFAULT 'ALIVE',
    `role` ENUM('PLAYER', 'NPC', 'EPISODIC', 'FAMILIAR') NOT NULL DEFAULT 'NPC',
    `playerName` VARCHAR(191) NULL,
    `nature` VARCHAR(191) NULL,
    `demeanor` VARCHAR(191) NULL,
    `attributes` JSON NULL,
    `abilities` JSON NULL,
    `virtues` JSON NULL,
    `disciplines` JSON NULL,
    `backgrounds` JSON NULL,
    `humanity` INTEGER NULL,
    `path` VARCHAR(191) NULL,
    `willpower` INTEGER NULL,
    `bloodPool` INTEGER NULL,
    `experience` JSON NULL,
    `appearance` JSON NULL,
    `biography` TEXT NULL,
    `goals` TEXT NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Character_slug_key`(`slug`),
    INDEX `Character_userId_idx`(`userId`),
    INDEX `Character_clan_idx`(`clan`),
    INDEX `Character_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Location` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NULL,
    `name` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `type` ENUM('HAVEN', 'CLUB', 'ELYSIUM', 'STREET', 'OFFICE', 'RESIDENCE', 'GOVERNMENT', 'UNDERGROUND', 'OTHER') NOT NULL DEFAULT 'OTHER',
    `city` VARCHAR(191) NULL,
    `district` VARCHAR(191) NULL,
    `address` VARCHAR(191) NULL,
    `description` TEXT NULL,
    `atmosphere` TEXT NULL,
    `hooks` TEXT NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Location_slug_key`(`slug`),
    INDEX `Location_userId_idx`(`userId`),
    INDEX `Location_type_idx`(`type`),
    INDEX `Location_city_idx`(`city`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Scenario` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NULL,
    `title` VARCHAR(191) NOT NULL,
    `summary` TEXT NULL,
    `phase` ENUM('A', 'B', 'C') NOT NULL DEFAULT 'A',
    `status` ENUM('DRAFT', 'READY', 'PLAYED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Scenario_userId_idx`(`userId`),
    INDEX `Scenario_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ScenarioCharacter` (
    `scenarioId` INTEGER NOT NULL,
    `characterId` INTEGER NOT NULL,
    `role` VARCHAR(191) NULL,

    INDEX `ScenarioCharacter_characterId_idx`(`characterId`),
    PRIMARY KEY (`scenarioId`, `characterId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ScenarioLocation` (
    `scenarioId` INTEGER NOT NULL,
    `locationId` INTEGER NOT NULL,
    `purpose` VARCHAR(191) NULL,

    INDEX `ScenarioLocation_locationId_idx`(`locationId`),
    PRIMARY KEY (`scenarioId`, `locationId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Character` ADD CONSTRAINT `Character_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Location` ADD CONSTRAINT `Location_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Scenario` ADD CONSTRAINT `Scenario_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ScenarioCharacter` ADD CONSTRAINT `ScenarioCharacter_scenarioId_fkey` FOREIGN KEY (`scenarioId`) REFERENCES `Scenario`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ScenarioCharacter` ADD CONSTRAINT `ScenarioCharacter_characterId_fkey` FOREIGN KEY (`characterId`) REFERENCES `Character`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ScenarioLocation` ADD CONSTRAINT `ScenarioLocation_scenarioId_fkey` FOREIGN KEY (`scenarioId`) REFERENCES `Scenario`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ScenarioLocation` ADD CONSTRAINT `ScenarioLocation_locationId_fkey` FOREIGN KEY (`locationId`) REFERENCES `Location`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
