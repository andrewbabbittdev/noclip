// Asset type definitions
export interface ExportAsset {
    id: string;
    name: string;
    type: AssetType;
    sourcePath: string;
    outputPath: string;
    metadata?: Record<string, any>;
}

export enum AssetType {
    Model = 'model',
    Texture = 'texture',
    Material = 'material',
    Scene = 'scene',
}

export interface ExportConfig {
    inputBase: string;        // data/ZeldaWindWaker
    outputBase: string;       // data/ZeldaWindWaker_Godot
    stages: string[];         // Which stages to export, empty = all
    objects: string[];        // Which objects to export, empty = all
    excludeArchives: string[]; // Relative archive paths to exclude (e.g., 'Stage/A_R00/Room0.arc')
    textureFormat: 'png' | 'webp' | 'jpg';
    jpegQuality: number;
    validateOutput: boolean;
    verbose: boolean;
}

export interface ExportProgress {
    total: number;
    completed: number;
    current: string;
    errors: string[];
}

export interface GLBExportOptions {
    includeArmature: boolean;
    includeAnimations: boolean;
    packTextures: boolean;
}

export interface TextureExportOptions {
    format: 'png' | 'jpg' | 'webp';
    quality: number;
    maxDimension: number; // For downsampling if needed
}

export interface ShaderExportOptions {
    targetVersion: 'gdshader';
    includeNormalsMap: boolean;
    includePBR: boolean;
}

export interface BaseExporter {
    export(): Promise<void>;
}
