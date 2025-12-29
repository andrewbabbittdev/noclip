import { DZS } from '../../../d_resorce';
import { Logger } from './logger.js';
import ArrayBufferSlice from '../../../../ArrayBufferSlice.js';
import { readString } from '../../../../util.js';

export interface DZSObject {
    id: number;
    name: string;
    type: string;
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
    params: Record<string, number>;
    roomId: number;
}

export interface DZSRoom {
    roomId: number;
    name: string;
    filename: string;
    position: [number, number, number];
    object_count: number;
    objects: DZSObject[];
}

export interface DZSStageData {
    stageName: string;
    rooms: DZSRoom[];
    allObjects: DZSObject[];
    spawnPoints: any[];
    paths: any[];
    environment: Record<string, any>;
    mult: Array<{ roomNo: number; transX: number; transZ: number; rotY: number }>;
}

/**
 * Minimal scaffold for DZS parsing to be fleshed out later.
 */
export class DZSLoader {
    constructor(private logger: Logger) {}

    parseStageDZS(stageName: string, dzs: DZS): DZSStageData {
        this.logger.debug(`Parsing DZS headers for stage: ${stageName}`);

        const buffer = dzs.buffer;
        const roomsSet = new Set<number>();

        // RTBL: Room table entries
        const rtbl = dzs.headers.get('RTBL');
        if (rtbl) {
            const view = buffer.createDataView();
            let offs = rtbl.offs;
            for (let i = 0; i < rtbl.count; i++) {
                const roomReadOffs = view.getUint32(offs);
                offs += 0x04;
                const rrView = buffer.createDataView(roomReadOffs);
                const tableCount = rrView.getUint8(0x00);
                const tableOffs = rrView.getUint32(0x04);
                const table = buffer.createTypedArray(Uint8Array, tableOffs, tableCount);
                for (let j = 0; j < table.length; j++) roomsSet.add(table[j]);
            }
        }

        const rooms: DZSRoom[] = Array.from(roomsSet)
            .sort((a, b) => a - b)
            .map((id) => {
                // Calculate room position based on grid layout
                // For 'sea' stage: 7-wide grid (0-6 are X coords, rows are Z coords), 10000 unit spacing
                // Room numbering: 1 = (1,0), 2 = (2,0), ..., 7 = (0,1), etc.
                const isSeaStage = stageName === 'sea';
                const gridWidth = isSeaStage ? 7 : 1;
                const cellSize = isSeaStage ? 10000 : 0;
                
                let posX = 0, posZ = 0;
                if (isSeaStage && gridWidth > 0) {
                    // Convert room ID to grid coordinates (0-indexed internally)
                    const gridX = (id - 1) % gridWidth;
                    const gridZ = Math.floor((id - 1) / gridWidth);
                    posX = gridX * cellSize;
                    posZ = gridZ * cellSize;
                }
                
                return { roomId: id, name: `Room${id}`, filename: `Room${id}.arc`, position: [posX, 0, posZ], object_count: 0, objects: [] };
            });

        // Environment: lights and palette selection indices
        const environment: Record<string, any> = {};
        const lights: Array<{ pos: [number, number, number]; radius: number; color: [number, number, number, number]; fluctuation: number; }> = [];
        const lght = dzs.headers.get('LGHT');
        if (lght) {
            let offs = lght.offs;
            const view = buffer.createDataView();
            for (let i = 0; i < lght.count; i++) {
                const posX = view.getFloat32(offs + 0x00);
                const posY = view.getFloat32(offs + 0x04);
                const posZ = view.getFloat32(offs + 0x08);
                const radius = view.getFloat32(offs + 0x0C);
                const rgba = view.getUint32(offs + 0x18);
                const r = (rgba >>> 24) & 0xFF, g = (rgba >>> 16) & 0xFF, b = (rgba >>> 8) & 0xFF, a = 0xFF;
                const fluct = view.getUint8(offs + 0x1B);
                lights.push({ pos: [posX, posY, posZ], radius, color: [r, g, b, a], fluctuation: fluct });
                offs += 0x1C;
            }
            environment.lights = lights;
        }

        const envr = dzs.headers.get('EnvR');
        if (envr) {
            const pselList: number[][] = [];
            let offs = envr.offs;
            for (let i = 0; i < envr.count; i++) {
                const bytes = buffer.createTypedArray(Uint8Array, offs, 0x08);
                pselList.push(Array.from(bytes));
                offs += 0x08;
            }
            environment.paletteSelectIndices = pselList;
        }

        // Parse MULT chunk for room positions
        const mult: Array<{ roomNo: number; transX: number; transZ: number; rotY: number }> = [];
        const multChunk = dzs.headers.get('MULT');
        if (multChunk) {
            const view = buffer.createDataView();
            let offs = multChunk.offs;
            for (let i = 0; i < multChunk.count; i++) {
                const transX = view.getFloat32(offs + 0x00);
                const transZ = view.getFloat32(offs + 0x04);
                const rotY = view.getUint16(offs + 0x08);
                const roomNo = view.getUint8(offs + 0x0A);
                mult.push({ roomNo, transX, transZ, rotY });
                offs += 0x0C;
            }
        }

        // Future: SCRO/SCLS, PATH/PPNT parsing
        return {
            stageName,
            rooms,
            allObjects: [],
            spawnPoints: [],
            paths: [],
            environment,
            mult,
        };
    }

    // Convenience: parse a raw stage.dzs buffer
    parseStageFromBuffer(stageName: string, buffer: ArrayBufferSlice): DZSStageData {
        const dzs = this.parseHeaders(buffer);
        return this.parseStageDZS(stageName, dzs);
    }

    /**
     * Parse DZR buffer (room.dzr) and return object placements.
     */
    parseRoomObjectsFromBuffer(roomId: number, buffer: ArrayBufferSlice): DZSObject[] {
        const dzr = this.parseHeaders(buffer);
        const objects: DZSObject[] = [];

        const getChunkInfo = (type: string): { entrySize: number; hasScale: boolean; baseType: string } | null => {
            if (type === 'ACTR' || /^ACT[0-9A-Z]$/.test(type)) return { entrySize: 0x20, hasScale: false, baseType: 'ACTR' };
            if (type === 'SCOB' || /^SCO[0-9A-Z]$/.test(type)) return { entrySize: 0x24, hasScale: true, baseType: 'SCOB' };
            if (type === 'TGSC' || /^TGS[0-9A-Z]$/.test(type)) return { entrySize: 0x24, hasScale: true, baseType: 'TGSC' };
            if (type === 'DOOR') return { entrySize: 0x24, hasScale: true, baseType: 'DOOR' };
            return null;
        };

        const view = dzr.buffer.createDataView();
        for (const [type, h] of (dzr.headers as Map<string, { type: string; count: number; offs: number }>)) {
            const info = getChunkInfo(type);
            if (!info) continue;
            let offs = h.offs;
            for (let i = 0; i < h.count; i++) {
                const name = readString(dzr.buffer, offs + 0x00, 0x08, true);
                const parameter = view.getUint32(offs + 0x08);
                const posX = view.getFloat32(offs + 0x0C);
                const posY = view.getFloat32(offs + 0x10);
                const posZ = view.getFloat32(offs + 0x14);
                const angleX = view.getInt16(offs + 0x18);
                const angleY = view.getInt16(offs + 0x1A);
                const angleZ = view.getInt16(offs + 0x1C);
                const enemyNo = view.getUint16(offs + 0x1E);

                let scale: [number, number, number] = [1, 1, 1];
                if (info.hasScale) {
                    const sx = view.getUint8(offs + 0x20) / 10.0;
                    const sy = view.getUint8(offs + 0x21) / 10.0;
                    const sz = view.getUint8(offs + 0x22) / 10.0;
                    scale = [sx, sy, sz];
                }

                const obj: DZSObject = {
                    id: i,
                    name,
                    type: info.baseType,
                    position: [posX, posY, posZ],
                    rotation: [angleX, angleY, angleZ],
                    scale,
                    params: { parameter, enemyNo },
                    roomId,
                };
                objects.push(obj);
                offs += info.entrySize;
            }
        }

        return objects;
    }

    private parseHeaders(buffer: ArrayBufferSlice): DZS {
        const view = buffer.createDataView();
        const chunkCount = view.getUint32(0x00);
        const chunkHeaders = new Map<string, { type: string; count: number; offs: number }>();
        let chunkTableIdx = 0x04;
        for (let i = 0; i < chunkCount; i++) {
            const type = readString(buffer, chunkTableIdx + 0x00, 0x04);
            const numEntries = view.getUint32(chunkTableIdx + 0x04);
            const offs = view.getUint32(chunkTableIdx + 0x08);
            chunkHeaders.set(type, { type, count: numEntries, offs });
            chunkTableIdx += 0x0C;
        }
        return { headers: chunkHeaders as any, buffer } as DZS;
    }
}
