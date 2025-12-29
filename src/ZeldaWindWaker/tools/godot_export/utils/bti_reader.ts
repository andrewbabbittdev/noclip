import ArrayBufferSlice from '../../../../ArrayBufferSlice';
import * as GX from '../../../../gx/gx_enum';

export interface BTITextureLite {
    name: string;
    format: GX.TexFormat;
    width: number;
    height: number;
    data: ArrayBufferSlice | null;
    mipCount: number;
    paletteFormat?: GX.TexPalette | null;
    paletteData?: ArrayBufferSlice | null;
    wrapS?: GX.WrapMode;
    wrapT?: GX.WrapMode;
    minFilter?: GX.TexFilter;
    magFilter?: GX.TexFilter;
    minLOD?: number;
    maxLOD?: number;
    lodBias?: number;
    maxAnisotropy?: GX.Anisotropy;
}

export function readBTITextureLite(buffer: ArrayBufferSlice, name: string): BTITextureLite {
    const view = buffer.createDataView();

    const format: GX.TexFormat = view.getUint8(0x00);
    const width: number = view.getUint16(0x02);
    const height: number = view.getUint16(0x04);
    const wrapS: GX.WrapMode = view.getUint8(0x06);
    const wrapT: GX.WrapMode = view.getUint8(0x07);
    const paletteFormat: GX.TexPalette = view.getUint8(0x09);
    const paletteCount: number = view.getUint16(0x0A);
    const paletteOffs: number = view.getUint32(0x0C);
    const maxAnisotropy: GX.Anisotropy = view.getUint8(0x13);
    const minFilter: GX.TexFilter = view.getUint8(0x14);
    const magFilter: GX.TexFilter = view.getUint8(0x15);
    const minLOD: number = view.getInt8(0x16) * 1/8;
    const maxLOD: number = view.getInt8(0x17) * 1/8;
    const mipCount: number = view.getUint8(0x18);
    const lodBias: number = view.getInt16(0x1A) * 1/100;
    const dataOffs: number = view.getUint32(0x1C);

    let data: ArrayBufferSlice | null = null;
    if (dataOffs !== 0)
        data = buffer.slice(dataOffs);

    let paletteData: ArrayBufferSlice | null = null;
    if (paletteOffs !== 0)
        paletteData = buffer.subarray(paletteOffs, paletteCount * 2);

    return { name, format, width, height, data, mipCount, paletteFormat, paletteData, wrapS, wrapT, minFilter, magFilter, minLOD, maxLOD, lodBias, maxAnisotropy };
}
