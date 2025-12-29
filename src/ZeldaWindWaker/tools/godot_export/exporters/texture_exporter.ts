import { ExportConfig, BaseExporter } from '../types.js';
import { Logger } from '../utils/logger.js';
import { DataLoader } from '../utils/data_loaders.js';
import * as RARC from '../../../../Common/JSYSTEM/JKRArchive.js';
import { readBTITextureLite } from '../utils/bti_reader.js';
import { BTIToPNGConverter } from '../converters/bti_to_png.js';
import { readdirSync, statSync } from 'fs';
import path from 'path';
import { initRustForNode } from '../utils/rust_node_init.js';
import { extractTEX1Textures } from '../utils/tex1_extractor.js';
import ArrayBufferSlice from '../../../../ArrayBufferSlice.js';

interface TextureData {
    name: string;
    data: Uint8Array;
}

export class TextureExporter implements BaseExporter {
    private loader: DataLoader;
    private textures: Map<string, TextureData[]> = new Map();

    constructor(private config: ExportConfig, private logger: Logger) {
        this.loader = new DataLoader(logger);
    }

    async export(): Promise<void> {
        this.logger.info('Loading textures into memory...');
        try {
            await initRustForNode();
            await this.loadStageTextures();
            await this.loadObjectTextures();
            this.logger.info(`Textures loaded into memory (${this.textures.size} assets)`);
        } catch (e) {
            this.logger.error(`Texture loading failed: ${e}`);
            throw e;
        }
    }

    private async loadStageTextures(): Promise<void> {
        const stageDir = path.join(this.config.inputBase, 'Stage');
        let stages: string[] = [];
        try {
            stages = readdirSync(stageDir);
        } catch {
            this.logger.warn(`No Stage directory found at ${stageDir}`);
            return;
        }

        for (const stageName of stages) {
            const stagePath = path.join(stageDir, stageName);
            try {
                if (!statSync(stagePath).isDirectory()) continue;
            } catch { continue; }

            // Only load selected stages if configured
            if (this.config.stages && this.config.stages.length > 0 && !this.config.stages.includes(stageName))
                continue;

            let entries: string[] = [];
            try {
                entries = readdirSync(stagePath).filter(f => f.toLowerCase().endsWith('.arc'));
            } catch {}

            for (const entry of entries) {
                // Check if this archive is excluded
                const relativePath = `Stage/${stageName}/${entry}`;
                if (this.config.excludeArchives.includes(relativePath)) {
                    this.logger.debug(`Skipping excluded archive: ${relativePath}`);
                    continue;
                }
                const arcPath = path.join(stagePath, entry);
                await this.loadArchiveTextures(arcPath, relativePath);
            }
        }
    }

    private async loadObjectTextures(): Promise<void> {
        const objectDir = path.join(this.config.inputBase, 'Object');
        let entries: string[] = [];
        try {
            entries = readdirSync(objectDir).filter(f => f.toLowerCase().endsWith('.arc'));
        } catch {
            this.logger.warn(`No Object directory found at ${objectDir}`);
            return;
        }

        for (const entry of entries) {
            const objectName = entry.replace(/\.arc$/i, '');
            // Only load selected objects if configured
            if (this.config.objects && this.config.objects.length > 0 && !this.config.objects.includes(objectName))
                continue;

            const arcPath = path.join(objectDir, entry);
            await this.loadArchiveTextures(arcPath, `Object/${objectName}`);
        }
    }

    private async loadArchiveTextures(archivePath: string, assetKey: string): Promise<void> {
        this.logger.debug(`Scanning archive for textures: ${archivePath}`);
        try {
            const archive = this.loader.loadArchive(archivePath);
            const texList: TextureData[] = [];
            
            // Load BTI textures
            for (const file of archive.files) {
                if (!file.name.toLowerCase().endsWith('.bti')) continue;
                try {
                    const tex = readBTITextureLite(file.buffer, file.name);
                    const png = await BTIToPNGConverter.convertToPNG(tex);
                    const base = file.name.replace(/\.bti$/i, '');
                    texList.push({ name: base, data: png });
                    this.logger.debug(`Loaded BTI: ${base}`);
                } catch (e) {
                    this.logger.warn(`Failed to load BTI ${file.name}: ${e}`);
                }
            }
            
            // Load embedded TEX1 textures from models
            for (const file of archive.files) {
                const lower = file.name.toLowerCase();
                if (!(lower.endsWith('.bdl') || lower.endsWith('.bmd'))) continue;
                try {
                    const textures = extractTEX1Textures(file.buffer);
                    for (const tex of textures) {
                        const png = await BTIToPNGConverter.convertToPNG(tex);
                        const safeName = tex.name.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
                        texList.push({ name: safeName, data: png });
                        this.logger.debug(`Loaded TEX1: ${safeName}`);
                    }
                } catch (e) {
                    this.logger.warn(`TEX1 extraction failed in archive: ${archivePath}, model file: ${file.name}, error: ${e}`);
                }
            }
            
            if (texList.length > 0) {
                this.textures.set(assetKey, texList);
                this.logger.debug(`Loaded ${texList.length} textures for ${assetKey}`);
            }
        } catch (e) {
            this.logger.warn(`Failed to process archive ${archivePath}: ${e}`);
        }
    }

    public getTextures(): Map<string, TextureData[]> {
        return this.textures;
    }
}

