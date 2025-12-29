import { readFileSync, existsSync } from 'fs';
import path from 'path';

/**
 * Reads the UID from a Godot .import file
 */
export function readGodotUID(glbPath: string): string | null {
    const importPath = `${glbPath}.import`;
    
    if (!existsSync(importPath)) {
        return null;
    }

    try {
        const content = readFileSync(importPath, 'utf-8');
        const match = content.match(/^uid="([^"]+)"/m);
        return match ? match[1] : null;
    } catch {
        return null;
    }
}

/**
 * Reads UIDs for multiple GLB files
 */
export function readGodotUIDs(glbPaths: string[]): Map<string, string> {
    const uidMap = new Map<string, string>();
    
    for (const glbPath of glbPaths) {
        const uid = readGodotUID(glbPath);
        if (uid) {
            uidMap.set(glbPath, uid);
        }
    }
    
    return uidMap;
}
