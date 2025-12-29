import { ExportConfig, BaseExporter } from '../types.js';
import { Logger } from '../utils/logger.js';
import { DataLoader } from '../utils/data_loaders.js';
import * as RARC from '../../../../Common/JSYSTEM/JKRArchive.js';
import path from 'path';
import { readdirSync, statSync } from 'fs';
import { extractTEX1Textures } from '../utils/tex1_extractor.js';

interface SimpleMaterialResource {
    name: string;
    baseColorTexture: string | null;
    wrapS?: number;
    wrapT?: number;
    minFilter?: number;
    magFilter?: number;
}

export class MaterialExporter implements BaseExporter {
    private loader: DataLoader;
    private materials: Map<string, SimpleMaterialResource[]> = new Map();

    constructor(private config: ExportConfig, private logger: Logger) {
        this.loader = new DataLoader(logger);
    }

    async export(): Promise<void> {
        this.logger.info('Loading materials into memory...');
        try {
            await this.loadStageMaterials();
            await this.loadObjectMaterials();
            this.logger.info(`Materials loaded into memory (${this.materials.size} assets)`);
        } catch (e) {
            this.logger.error(`Material loading failed: ${e}`);
            throw e;
        }
    }

    private async loadStageMaterials(): Promise<void> {
        const stageDir = path.join(this.config.inputBase, 'Stage');
        let stages: string[] = [];
        try { stages = readdirSync(stageDir); } catch { return; }
        for (const stageName of stages) {
            const stagePath = path.join(stageDir, stageName);
            try { if (!statSync(stagePath).isDirectory()) continue; } catch { continue; }
            if (this.config.stages?.length && !this.config.stages.includes(stageName)) continue;
            const arcs = readdirSync(stagePath).filter(f => f.toLowerCase().endsWith('.arc'));
            for (const arc of arcs) {
                // Check if this archive is excluded
                const relativePath = `Stage/${stageName}/${arc}`;
                if (this.config.excludeArchives.includes(relativePath)) {
                    this.logger.debug(`Skipping excluded archive: ${relativePath}`);
                    continue;
                }
                const archive = this.loader.loadArchive(path.join(stagePath, arc));
                await this.loadMaterialsFromArchive(archive, relativePath);
            }
        }
    }

    private async loadObjectMaterials(): Promise<void> {
        const objDir = path.join(this.config.inputBase, 'Object');
        let arcs: string[] = [];
        try { arcs = readdirSync(objDir).filter(f => f.toLowerCase().endsWith('.arc')); } catch { return; }
        for (const arc of arcs) {
            const objectName = arc.replace(/\.arc$/i, '');
            if (this.config.objects?.length && !this.config.objects.includes(objectName)) continue;
            const archive = this.loader.loadArchive(path.join(objDir, arc));
            await this.loadMaterialsFromArchive(archive, `Object/${objectName}`);
        }
    }

    private async loadMaterialsFromArchive(archive: RARC.JKRArchive, assetKey: string): Promise<void> {
        const mats: SimpleMaterialResource[] = [];
        for (const file of archive.files) {
            const lower = file.name.toLowerCase();
            if (!(lower.endsWith('.bdl') || lower.endsWith('.bmd'))) continue;
            try {
                const textures = extractTEX1Textures(file.buffer);
                for (const tex of textures) {
                    const mat: SimpleMaterialResource = {
                        name: tex.name,
                        baseColorTexture: tex.name ? `${tex.name}.png` : null,
                        wrapS: tex.wrapS, wrapT: tex.wrapT, minFilter: tex.minFilter, magFilter: tex.magFilter,
                    };
                    mats.push(mat);
                }
            } catch (e) {
                this.logger.warn(`TEX1 extraction failed in asset: ${assetKey}, model file: ${file.name}, error: ${e}`);
            }
        }
        if (mats.length > 0) {
            this.materials.set(assetKey, mats);
            this.logger.debug(`Loaded ${mats.length} materials for ${assetKey}`);
        }
    }

    public getMaterials(): Map<string, SimpleMaterialResource[]> {
        return this.materials;
    }
}
