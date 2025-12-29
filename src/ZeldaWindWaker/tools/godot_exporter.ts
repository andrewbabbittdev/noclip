// Define minimal WebGL constants before any imports that pull gfx
import './godot_export/utils/webgl_mock.js';
import { GodotExporter, getDefaultConfig } from './godot_export/index.js';

async function main() {
    try {
        const config = getDefaultConfig();
        config.verbose = process.argv.includes('--verbose');

        // Export all stages and objects
        // config.stages = []; // Empty = all stages
        // config.objects = []; // Empty = all objects

        const exporter = new GodotExporter(config);
        await exporter.export();

        console.log('\n✅ Export successful!');
        process.exit(0);
    } catch (error) {
        console.error('\n❌ Export failed:', error);
        process.exit(1);
    }
}

main();
