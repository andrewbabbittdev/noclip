import { calcMipChain, decodeTexture } from '../../../../gx/gx_texture.js';
import { PNG } from 'pngjs';
import type { BTITextureLite } from '../utils/bti_reader.js';

export class BTIToPNGConverter {
    static async convertToPNG(texture: BTITextureLite): Promise<Buffer> {
        // Decode base mip level to RGBA8
        const mipChain = calcMipChain(texture, 1);
        const base = mipChain.mipLevels[0];
        const decoded = await decodeTexture(base);
        const pixelData = decoded.pixels as Uint8Array;

        const png = new PNG({ width: base.width, height: base.height });
        // pngjs expects a Buffer; ensure proper type
        if (Buffer.isBuffer(pixelData)) {
            png.data = pixelData as unknown as Buffer;
        } else {
            png.data = Buffer.from(pixelData);
        }

        return PNG.sync.write(png);
    }
}
