import { readFileSync, existsSync } from 'fs';

/**
 * Validates if a GLB file has a valid header
 * Valid GLB files start with the magic number 0x46546C67 ("glTF" in ASCII)
 */
export function isValidGLB(filePath: string): boolean {
    if (!existsSync(filePath)) {
        return false;
    }

    try {
        // Read first 4 bytes to check GLB magic number
        const buffer = readFileSync(filePath);
        
        if (buffer.length < 20) {
            // GLB minimum file size is 20 bytes (12 byte header + 8 byte JSON chunk header minimum)
            return false;
        }

        // Check magic number: should be 0x46546C67 in little-endian (which reads as "glTF")
        const magic = buffer.readUInt32LE(0);
        const expectedMagic = 0x46546C67; // 'g' + 'l' + 'T' + 'F' in little-endian
        
        if (magic !== expectedMagic) {
            return false;
        }

        // Check version: should be 2
        const version = buffer.readUInt32LE(4);
        if (version !== 2) {
            return false;
        }

        // Check file size is reasonable (at least 20 bytes, less than 2GB)
        const fileSize = buffer.readUInt32LE(8);
        if (fileSize < 20 || fileSize > 2147483648) {
            return false;
        }

        return true;
    } catch {
        return false;
    }
}
