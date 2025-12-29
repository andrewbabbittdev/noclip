import { ExportConfig } from './types.js';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export function getDefaultConfig(): ExportConfig {
    // Get the absolute path to the project root
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const projectRoot = path.resolve(__dirname, '../../../../');

    return {
        inputBase: path.join(projectRoot, 'data', 'ZeldaWindWaker'),
        outputBase: path.join(projectRoot, 'data', 'ZeldaWindWaker_Godot'),
        stages: [], // Empty = all
        objects: [], // Empty = all
        excludeArchives: ['Stage/A_R00/Room0.arc'],
        textureFormat: 'png',
        jpegQuality: 85,
        validateOutput: true,
        verbose: false,
    };
}

export function ensureOutputDirs(config: ExportConfig): void {
    const dirs = [
        config.outputBase,
        path.join(config.outputBase, 'Stage'),
        path.join(config.outputBase, 'Object'),
    ];

    dirs.forEach(dir => {
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
    });
}
