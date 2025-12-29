import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
// Import the wasm-bindgen JS shim from the Rust package
import init, * as rust from '../../../../../rust/pkg/noclip_support';

let initialized = false;

export async function initRustForNode(): Promise<void> {
    if (initialized) return;

    // Resolve wasm file relative to this file
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const wasmPath = path.resolve(__dirname, '../../../../../rust/pkg/noclip_support_bg.wasm');

    try {
        const wasm = fs.readFileSync(wasmPath);
        // @ts-ignore
        if (typeof (rust as any).initSync === 'function') {
            // @ts-ignore
            (rust as any).initSync({ module: wasm });
            initialized = true;
            return;
        }
    } catch {
        // Fall back to default async init below
    }

    await init();
    initialized = true;
}

export { rust };
