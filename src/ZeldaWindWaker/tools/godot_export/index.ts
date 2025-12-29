import { ExportConfig, ExportProgress, AssetType, ExportAsset, BaseExporter } from './types.js';
import { Logger } from './utils/logger.js';
import { ensureOutputDirs, getDefaultConfig } from './config.js';
import { ModelExporter } from './exporters/model_exporter.js';
import { TextureExporter } from './exporters/texture_exporter.js';
import { MaterialExporter } from './exporters/material_exporter.js';
import { SceneExporter } from './exporters/scene_exporter.js';

export class GodotExporter {
    private logger: Logger;
    private progress: ExportProgress;
    private exporters: Map<AssetType, BaseExporter>;

    constructor(private config: ExportConfig) {
        this.logger = new Logger(config);
        this.progress = {
            total: 0,
            completed: 0,
            current: '',
            errors: [],
        };
        this.setupExporters();
    }

    private setupExporters(): void {
        this.exporters = new Map<AssetType, BaseExporter>([
            [AssetType.Model, new ModelExporter(this.config, this.logger) as BaseExporter],
            [AssetType.Texture, new TextureExporter(this.config, this.logger) as BaseExporter],
            [AssetType.Material, new MaterialExporter(this.config, this.logger) as BaseExporter],
            [AssetType.Scene, new SceneExporter(this.config, this.logger) as BaseExporter],
        ]);
    }

    async export(): Promise<void> {
        try {
            this.logger.info('Starting Godot export...');
            ensureOutputDirs(this.config);

            // Phase order
            await this.exportAssets(AssetType.Texture);      // Phase 2a - Load textures to memory
            await this.exportAssets(AssetType.Model);        // Phase 1 - Export GLB models
            await this.exportAssets(AssetType.Material);     // Phase 2b - Load materials to memory
            await this.exportAssets(AssetType.Scene);        // Phase 3 - Generate Godot scenes

            this.logger.info(`Export complete! Processed ${this.progress.completed} assets.`);
            if (this.progress.errors.length > 0) {
                this.logger.warn(`${this.progress.errors.length} errors encountered:`);
                this.progress.errors.forEach(err => this.logger.error(err));
            }
        } catch (error) {
            this.logger.error(`Export failed: ${error}`);
            throw error;
        }
    }

    private async exportAssets(type: AssetType): Promise<void> {
        const exporter = this.exporters.get(type);
        if (!exporter) {
            this.logger.warn(`No exporter found for type: ${type}`);
            return;
        }

        try {
            await exporter.export();
        } catch (error) {
            this.progress.errors.push(`${type}: ${error}`);
            this.logger.error(`Failed to export ${type}: ${error}`);
        }
    }
}

export type { ExportConfig, ExportAsset, AssetType } from './types.js';
export { getDefaultConfig } from './config.js';
