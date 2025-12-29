import { readFileSync, existsSync } from 'fs';
import { BMD } from '../vendor/minimal_j3d.js';
import * as RARC from '../../../../Common/JSYSTEM/JKRArchive.js';
import * as Yaz0 from '../../../../Common/Compression/Yaz0.js';
import ArrayBufferSlice from '../../../../ArrayBufferSlice.js';
import { Logger } from './logger.js';

export class DataLoader {
    constructor(private logger: Logger) {}

    /**
     * Load a file synchronously from disk
     */
    loadFileSync(filePath: string): ArrayBufferSlice {
        if (!existsSync(filePath)) {
            throw new Error(`File not found: ${filePath}`);
        }
        
        const buffer = readFileSync(filePath);
        return new ArrayBufferSlice(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    }

    /**
     * Load a file and automatically decompress if Yaz0 compressed
     */
    loadAndDecompress(filePath: string): ArrayBufferSlice {
        this.logger.debug(`Loading file: ${filePath}`);
        let data = this.loadFileSync(filePath);
        
        // Check for Yaz0 compression
        const view = data.createDataView();
        const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
        if (magic === 'Yaz0') {
            this.logger.debug(`Decompressing Yaz0...`);
            // Use software (pure JS) decompressor to avoid WASM dependency
            data = Yaz0.decompressSW(data);
        }
        
        return data;
    }

    /**
     * Load a RARC archive file
     */
    loadArchive(filePath: string): RARC.JKRArchive {
        const data = this.loadAndDecompress(filePath);
        this.logger.debug(`Parsing RARC archive...`);
        return RARC.parse(data);
    }

    /**
     * Load a BDL/BMD model file
     */
    loadBDL(filePath: string): BMD {
        const data = this.loadAndDecompress(filePath);
        this.logger.debug(`Parsing BMD/BDL...`);
        return BMD.parse(data);
    }

    /**
     * Load a BDL/BMD from within a RARC archive
     */
    loadBDLFromArchive(archive: RARC.JKRArchive, filename: string): BMD | null {
        this.logger.debug(`Finding ${filename} in archive...`);
        // Look up by filename regardless of subdirectory
        const file = archive.findFilenameData(filename);
        if (!file) {
            this.logger.warn(`File not found in archive: ${filename}`);
            return null;
        }
        return BMD.parse(file);
    }

    /**
     * Find all BDL/BMD files in a RARC archive
     */
    findModelsInArchive(archive: RARC.JKRArchive): string[] {
        const models: string[] = [];
        
        // Search through files
        for (const file of archive.files) {
            const name = file.name.toLowerCase();
            if (name.endsWith('.bdl') || name.endsWith('.bmd')) {
                models.push(file.name);
            }
        }
        
        return models;
    }
}
