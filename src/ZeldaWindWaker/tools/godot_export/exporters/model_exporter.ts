import { ExportConfig, BaseExporter } from '../types.js';
import { Logger } from '../utils/logger.js';
import { DataLoader } from '../utils/data_loaders.js';
import { J3DToGLBConverter } from '../converters/j3d_to_glb.js';
import { readdirSync, statSync, existsSync, mkdirSync } from 'fs';
import path from 'path';

export class ModelExporter implements BaseExporter {
    private dataLoader: DataLoader;
    private converter: J3DToGLBConverter;

    constructor(private config: ExportConfig, private logger: Logger) {
        this.dataLoader = new DataLoader(logger);
        this.converter = new J3DToGLBConverter(logger);
    }

    async export(): Promise<void> {
        this.logger.info('Starting model export (BMD/BDL to GLB)...');

        try {
            // Export stage models
            await this.exportStageModels();

            // Export object models
            await this.exportObjectModels();

            this.logger.info('Model export complete!');
        } catch (error) {
            this.logger.error(`Model export failed: ${error}`);
            throw error;
        }
    }

    private async exportStageModels(): Promise<void> {
        const stageDir = path.join(this.config.inputBase, 'Stage');
        
        if (!existsSync(stageDir)) {
            this.logger.warn(`Stage directory not found: ${stageDir}`);
            return;
        }

        const stages = this.config.stages.length > 0
            ? this.config.stages
            : this.getAvailableStages(stageDir);

        this.logger.info(`Exporting ${stages.length} stage models...`);

        for (const stageName of stages) {
            await this.exportStageModel(stageName);
            await this.exportRoomModels(stageName);
        }
    }

    private async exportStageModel(stageName: string): Promise<void> {
        try {
            const stagePath = path.join(this.config.inputBase, 'Stage', stageName);
            
            // Look for Stage.arc file
            const stageArcPath = path.join(stagePath, 'Stage.arc');
            if (!existsSync(stageArcPath)) {
                this.logger.debug(`Stage.arc not found for stage: ${stageName}`);
                return;
            }

            this.logger.debug(`Loading stage archive: ${stageName}/Stage.arc`);
            const archive = this.dataLoader.loadArchive(stageArcPath);
            const modelFiles = this.dataLoader.findModelsInArchive(archive);

            if (modelFiles.length === 0) {
                this.logger.debug(`No models found in Stage.arc for: ${stageName}`);
                return;
            }

            // Create output directory for this stage's Stage.arc models
            const outputDir = path.join(this.config.outputBase, 'Stage', stageName, 'Stage');
            if (!existsSync(outputDir)) {
                mkdirSync(outputDir, { recursive: true });
            }

            // Export each model from Stage.arc
            for (const modelFile of modelFiles) {
                const bmd = this.dataLoader.loadBDLFromArchive(archive, modelFile);
                if (!bmd) continue;
                const baseName = modelFile.replace(/\.(bmd|bdl)$/i, '');
                const outputPath = path.join(outputDir, `${baseName}.glb`);
                await this.converter.convert(bmd, outputPath, baseName);
            }

            this.logger.info(`✓ Exported stage: ${stageName} (${modelFiles.length} models)`);
        } catch (error) {
            this.logger.error(`Failed to export stage ${stageName}: ${error}`);
        }
    }

    private async exportObjectModels(): Promise<void> {
        const objectDir = path.join(this.config.inputBase, 'Object');
        
        if (!existsSync(objectDir)) {
            this.logger.warn(`Object directory not found: ${objectDir}`);
            return;
        }

        const objects = this.config.objects.length > 0
            ? this.config.objects
            : this.getAvailableObjects(objectDir);

        this.logger.info(`Exporting ${objects.length} object models...`);

        for (const objectName of objects) {
            await this.exportObjectModel(objectName);
        }
    }

    private async exportObjectModel(objectName: string): Promise<void> {
        try {
            const objectPath = path.join(this.config.inputBase, 'Object', `${objectName}.arc`);

            if (!existsSync(objectPath)) {
                this.logger.debug(`Archive not found for object: ${objectName}`);
                return;
            }

            this.logger.debug(`Loading object archive: ${objectName}`);
            const archive = this.dataLoader.loadArchive(objectPath);

            // Find all model files in the archive
            const modelFiles = this.dataLoader.findModelsInArchive(archive);

            if (modelFiles.length === 0) {
                this.logger.debug(`No models found in archive: ${objectName}`);
                return;
            }

            // Create output directory for this object
            const outputDir = path.join(this.config.outputBase, 'Object', objectName);
            if (!existsSync(outputDir)) {
                mkdirSync(outputDir, { recursive: true });
            }

            // Export each model in the archive
            for (const modelFile of modelFiles) {
                const bmd = this.dataLoader.loadBDLFromArchive(archive, modelFile);
                if (!bmd) continue;
                // Use the model file name without extension as the base name
                const baseName = modelFile.replace(/\.(bmd|bdl)$/i, '');
                const outputPath = path.join(outputDir, `${baseName}.glb`);
                await this.converter.convert(bmd, outputPath, baseName);
            }
            this.logger.info(`✓ Exported object: ${objectName} (${modelFiles.length} models)`);
        } catch (error) {
            this.logger.error(`Failed to export object ${objectName}: ${error}`);
        }
    }

    private async exportRoomModels(stageName: string): Promise<void> {
        try {
            const stagePath = path.join(this.config.inputBase, 'Stage', stageName);
            let roomArcs: string[] = [];
            try {
                roomArcs = readdirSync(stagePath).filter(f => /^Room\d+\.arc$/i.test(f));
            } catch {
                return;
            }

            if (roomArcs.length === 0) return;

            for (const arcName of roomArcs) {
                // Check if this archive is excluded
                const relativePath = `Stage/${stageName}/${arcName}`;
                if (this.config.excludeArchives.includes(relativePath)) {
                    this.logger.debug(`Skipping excluded archive: ${relativePath}`);
                    continue;
                }
                const roomDirName = arcName.replace(/\.arc$/i, ''); // e.g., "Room0"
                const arcPath = path.join(stagePath, arcName);
                try {
                    const archive = this.dataLoader.loadArchive(arcPath);
                    const modelFiles = this.dataLoader.findModelsInArchive(archive);
                    if (modelFiles.length === 0) continue;

                    // Create output directory for this specific room
                    const roomOutputDir = path.join(this.config.outputBase, 'Stage', stageName, roomDirName);
                    if (!existsSync(roomOutputDir)) {
                        mkdirSync(roomOutputDir, { recursive: true });
                    }

                    // Export each model in the room
                    for (const modelFile of modelFiles) {
                        const bmd = this.dataLoader.loadBDLFromArchive(archive, modelFile);
                        if (!bmd) continue;
                        const baseName = modelFile.replace(/\.(bmd|bdl)$/i, '');
                        const outputPath = path.join(roomOutputDir, `${baseName}.glb`);
                        await this.converter.convert(bmd, outputPath, baseName);
                    }
                    this.logger.debug(`✓ Exported room: ${stageName}/${roomDirName} (${modelFiles.length} models)`);
                } catch (e) {
                    this.logger.debug(`Failed exporting room from ${arcName}: ${e}`);
                }
            }
        } catch (error) {
            this.logger.debug(`Failed to export room models for stage ${stageName}: ${error}`);
        }
    }

    private getAvailableStages(stageDir: string): string[] {
        try {
            return readdirSync(stageDir)
                .filter(name => {
                    const fullPath = path.join(stageDir, name);
                    return statSync(fullPath).isDirectory();
                });
        } catch (error) {
            this.logger.warn(`Failed to read stage directory: ${error}`);
            return [];
        }
    }

    private getAvailableObjects(objectDir: string): string[] {
        try {
            return readdirSync(objectDir)
                .filter(name => name.endsWith('.arc'))
                .map(name => name.replace('.arc', ''));
        } catch (error) {
            this.logger.warn(`Failed to read object directory: ${error}`);
            return [];
        }
    }
}
