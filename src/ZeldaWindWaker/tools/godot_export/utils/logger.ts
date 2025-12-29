import { ExportConfig } from '../types.js';

export class Logger {
    constructor(private config: ExportConfig) {}

    info(message: string): void {
        console.log(`[INFO] ${message}`);
    }

    warn(message: string): void {
        console.log(`[WARN] ${message}`);
    }

    error(message: string): void {
        console.error(`[ERROR] ${message}`);
    }

    debug(message: string): void {
        if (this.config.verbose) {
            console.log(`[DEBUG] ${message}`);
        }
    }

    progress(current: number, total: number, message: string): void {
        const percent = ((current / total) * 100).toFixed(1);
        console.log(`[${percent}%] ${message}`);
    }
}
