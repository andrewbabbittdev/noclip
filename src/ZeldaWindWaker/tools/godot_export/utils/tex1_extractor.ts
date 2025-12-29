import ArrayBufferSlice from '../../../../ArrayBufferSlice.js';
import { readBTITextureLite, BTITextureLite } from './bti_reader.js';
import { readString } from '../../../../util.js';

function readStringTable(buffer: ArrayBufferSlice, offs: number): string[] {
    const view = buffer.createDataView(offs);
    const stringCount = view.getUint16(0x00);
    let tableIdx = 0x04;
    const strings: string[] = [];
    for (let i = 0; i < stringCount; i++) {
        const stringOffs = view.getUint16(tableIdx + 0x02);
        const str = readString(buffer, offs + stringOffs, 255);
        strings.push(str);
        tableIdx += 0x04;
    }
    return strings;
}

function findChunk(buffer: ArrayBufferSlice, chunkId: string): ArrayBufferSlice | null {
    const view = buffer.createDataView();
    let offs = 0x20;
    const fileSize = view.getUint32(0x08);
    while (offs + 0x08 <= fileSize) {
        const id = readString(buffer, offs + 0x00, 4);
        const size = view.getUint32(offs + 0x04);
        const thisChunk = buffer.subarray(offs, size);
        if (id === chunkId)
            return thisChunk;
        offs += size;
    }
    return null;
}

export function extractTEX1Textures(modelData: ArrayBufferSlice): BTITextureLite[] {
    const tex1 = findChunk(modelData, 'TEX1');
    if (!tex1) return [];
    const view = tex1.createDataView();
    const textureCount = view.getUint16(0x08);
    const textureHeaderOffs = view.getUint32(0x0C);
    const nameTableOffs = view.getUint32(0x10);
    const names = readStringTable(tex1, nameTableOffs);
    const textures: BTITextureLite[] = [];
    for (let i = 0; i < textureCount; i++) {
        const textureIdx = textureHeaderOffs + i * 0x20;
        const name = names[i] ?? `tex_${i}`;
        const tex = readBTITextureLite(tex1.slice(textureIdx), name);
        textures.push(tex);
    }
    return textures;
}
