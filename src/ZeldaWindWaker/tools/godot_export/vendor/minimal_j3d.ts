import { mat4, quat, vec3 } from 'gl-matrix';
import ArrayBufferSlice from '../../../../ArrayBufferSlice.js';
import { Endianness } from '../../../../endian.js';
import { assert, readString } from '../../../../util.js';
import { AABB } from '../../../../Geometry.js';
import { compileLoadedVertexLayout, compileVtxLoader, getAttributeByteSize, GX_Array, GX_VtxAttrFmt, GX_VtxDesc, LoadedVertexData, LoadedVertexLayout } from '../../../../gx/gx_displaylist.js';
import * as GX from '../../../../gx/gx_enum.js';

// Minimal versions of J3D structures for parsing in Node

export interface INF1 { hierarchyData: ArrayBufferSlice; }

function readINF1Chunk(buffer: ArrayBufferSlice): INF1 {
    const view = buffer.createDataView();
    const hierarchyOffs = view.getUint32(0x14);
    const hierarchyData = buffer.slice(hierarchyOffs);
    return { hierarchyData };
}

export interface VTX1 {
    vat: GX_VtxAttrFmt[];
    arrayData: (ArrayBufferSlice | undefined)[];
}

function readVTX1Chunk(buffer: ArrayBufferSlice): VTX1 {
    const view = buffer.createDataView();
    const formatOffs = view.getUint32(0x08);
    const dataOffsLookupTable = 0x0C;

    const arrayAttribs = [
        GX.Attr.POS,
        GX.Attr.NRM,
        GX.Attr._NBT,
        GX.Attr.CLR0,
        GX.Attr.CLR1,
        GX.Attr.TEX0,
        GX.Attr.TEX1,
        GX.Attr.TEX2,
        GX.Attr.TEX3,
        GX.Attr.TEX4,
        GX.Attr.TEX5,
        GX.Attr.TEX6,
        GX.Attr.TEX7,
    ];

    let offs = formatOffs;
    const vat: GX_VtxAttrFmt[] = [];
    while (true) {
        const vtxAttrib: GX.Attr = view.getUint32(offs + 0x00);
        if (vtxAttrib === GX.Attr.NULL) break;
        const compCnt: GX.CompCnt = view.getUint32(offs + 0x04);
        const compType: GX.CompType = view.getUint32(offs + 0x08);
        const compShift: number = view.getUint8(offs + 0x0C);
        offs += 0x10;
        vat[vtxAttrib] = { compType, compCnt, compShift };
    }

    function getArrayData(formatIdx: number): ArrayBufferSlice | null {
        const dataOffsLookupTableEntry: number = dataOffsLookupTable + formatIdx*0x04;
        const dataStart: number = view.getUint32(dataOffsLookupTableEntry);
        if (dataStart === 0) return null;
        const dataEnd: number = getDataEnd(dataOffsLookupTableEntry);
        const dataSize: number = dataEnd - dataStart;
        return buffer.subarray(dataStart, dataSize);
    }

    const dataOffsLookupTableEnd: number = dataOffsLookupTable + arrayAttribs.length*0x04;
    function getDataEnd(dataOffsLookupTableEntry: number): number {
        let offs = dataOffsLookupTableEntry + 0x04;
        while (offs < dataOffsLookupTableEnd) {
            const dataOffs = view.getUint32(offs);
            if (dataOffs !== 0) return dataOffs;
            offs += 0x04;
        }
        return buffer.byteLength;
    }

    const arrayData: (ArrayBufferSlice | undefined)[] = [];
    for (let i = 0; i < arrayAttribs.length; i++) {
        const vtxAttrib = arrayAttribs[i];
        const array = getArrayData(i);
        if (array !== null) arrayData[vtxAttrib] = array;
    }

    return { vat, arrayData };
}

interface WeightedBone { weight: number; jointIndex: number; }
export interface EVP1 { envelopes: { weightedBones: WeightedBone[]; }[]; inverseBinds: mat4[]; }

function readEVP1Chunk(buffer: ArrayBufferSlice): EVP1 {
    const view = buffer.createDataView();
    const envelopeTableCount = view.getUint16(0x08);
    const weightedBoneCountTableOffs = view.getUint32(0x0C);
    const weightedBoneIndexTableOffs = view.getUint32(0x10);
    const weightedBoneWeightTableOffs = view.getUint32(0x14);
    const inverseBindPoseTableOffs = view.getUint32(0x18);

    let weightedBoneId = 0;
    let maxBoneIndex = -1;
    const envelopes: { weightedBones: WeightedBone[]; }[] = [];
    for (let i = 0; i < envelopeTableCount; i++) {
        const numWeightedBones = view.getUint8(weightedBoneCountTableOffs + i);
        const weightedBones: WeightedBone[] = [];
        for (let j = 0; j < numWeightedBones; j++) {
            const index = view.getUint16(weightedBoneIndexTableOffs + weightedBoneId * 0x02);
            const weight = view.getFloat32(weightedBoneWeightTableOffs + weightedBoneId * 0x04);
            weightedBones.push({ jointIndex: index, weight });
            maxBoneIndex = Math.max(maxBoneIndex, index);
            weightedBoneId++;
        }
        envelopes.push({ weightedBones });
    }

    const inverseBinds: mat4[] = [];
    for (let i = 0; i < maxBoneIndex + 1; i++) {
        const offs = inverseBindPoseTableOffs + (i * 0x30);
        const m00 = view.getFloat32(offs + 0x00);
        const m10 = view.getFloat32(offs + 0x04);
        const m20 = view.getFloat32(offs + 0x08);
        const m30 = view.getFloat32(offs + 0x0C);
        const m01 = view.getFloat32(offs + 0x10);
        const m11 = view.getFloat32(offs + 0x14);
        const m21 = view.getFloat32(offs + 0x18);
        const m31 = view.getFloat32(offs + 0x1C);
        const m02 = view.getFloat32(offs + 0x20);
        const m12 = view.getFloat32(offs + 0x24);
        const m22 = view.getFloat32(offs + 0x28);
        const m32 = view.getFloat32(offs + 0x2C);
        inverseBinds.push(mat4.fromValues(
            m00, m01, m02, 0,
            m10, m11, m12, 0,
            m20, m21, m22, 0,
            m30, m31, m32, 1,
        ));
    }
    return { envelopes, inverseBinds };
}

export enum DRW1MatrixKind { Joint = 0x00, Envelope = 0x01 }
type DRW1Matrix = { kind: DRW1MatrixKind.Joint, jointIndex: number } | { kind: DRW1MatrixKind.Envelope, envelopeIndex: number };
export interface DRW1 { matrixDefinitions: DRW1Matrix[]; }

function readDRW1Chunk(buffer: ArrayBufferSlice): DRW1 {
    const view = buffer.createDataView();
    const drawMatrixCount = view.getUint16(0x08);
    const drawMatrixTypeTableOffs = view.getUint32(0x0C);
    const dataArrayOffs = view.getUint32(0x10);
    const matrixDefinitions: DRW1Matrix[] = [];
    for (let i = 0; i < drawMatrixCount; i++) {
        const kind: DRW1MatrixKind = view.getUint8(drawMatrixTypeTableOffs + i);
        const param = view.getUint16(dataArrayOffs + i * 0x02);
        if (kind === DRW1MatrixKind.Joint) matrixDefinitions.push({ kind, jointIndex: param });
        else if (kind === DRW1MatrixKind.Envelope) matrixDefinitions.push({ kind, envelopeIndex: param });
    }
    return { matrixDefinitions };
}

export class JointTransformInfo {
    public scale = vec3.fromValues(1.0, 1.0, 1.0);
    public rotation = quat.create();
    public translation = vec3.create();
}

export interface Joint { name: string; transform: JointTransformInfo; bbox: AABB; calcFlags: number; }
export interface JNT1 { joints: Joint[]; }

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

function quatFromEulerRadians(dst: quat, rx: number, ry: number, rz: number): void {
    const qx = quat.set(quat.create(), Math.sin(rx/2), 0, 0, Math.cos(rx/2));
    const qy = quat.set(quat.create(), 0, Math.sin(ry/2), 0, Math.cos(ry/2));
    const qz = quat.set(quat.create(), 0, 0, Math.sin(rz/2), Math.cos(rz/2));
    quat.mul(dst, qz, quat.mul(dst, qy, qx));
}

function readJNT1Chunk(buffer: ArrayBufferSlice): JNT1 {
    const view = buffer.createDataView();
    const jointDataCount = view.getUint16(0x08);
    const jointDataTableOffs = view.getUint32(0x0C);
    const remapTableOffs = view.getUint32(0x10);
    const nameTableOffs = view.getUint32(0x14);
    const nameTable = readStringTable(buffer, nameTableOffs);
    const remapTable: number[] = [];
    for (let i = 0; i < jointDataCount; i++) remapTable[i] = view.getUint16(remapTableOffs + i * 0x02);
    const joints: Joint[] = [];
    for (let i = 0; i < jointDataCount; i++) {
        const name = nameTable[i];
        const idx = jointDataTableOffs + (remapTable[i] * 0x40);
        const calcFlags = view.getUint8(idx + 0x02);
        const scaleX = view.getFloat32(idx + 0x04);
        const scaleY = view.getFloat32(idx + 0x08);
        const scaleZ = view.getFloat32(idx + 0x0C);
        const rotationX = view.getInt16(idx + 0x10) / 0x7FFF * Math.PI;
        const rotationY = view.getInt16(idx + 0x12) / 0x7FFF * Math.PI;
        const rotationZ = view.getInt16(idx + 0x14) / 0x7FFF * Math.PI;
        const translationX = view.getFloat32(idx + 0x18);
        const translationY = view.getFloat32(idx + 0x1C);
        const translationZ = view.getFloat32(idx + 0x20);
        const bboxMinX = view.getFloat32(idx + 0x28);
        const bboxMinY = view.getFloat32(idx + 0x2C);
        const bboxMinZ = view.getFloat32(idx + 0x30);
        const bboxMaxX = view.getFloat32(idx + 0x34);
        const bboxMaxY = view.getFloat32(idx + 0x38);
        const bboxMaxZ = view.getFloat32(idx + 0x3C);
        const bbox = new AABB(bboxMinX, bboxMinY, bboxMinZ, bboxMaxX, bboxMaxY, bboxMaxZ);
        const transform = new JointTransformInfo();
        transform.scale[0] = scaleX; transform.scale[1] = scaleY; transform.scale[2] = scaleZ;
        quatFromEulerRadians(transform.rotation, rotationX, rotationY, rotationZ);
        transform.translation[0] = translationX; transform.translation[1] = translationY; transform.translation[2] = translationZ;
        joints.push({ name, calcFlags, transform, bbox });
    }
    return { joints };
}

export enum ShapeMtxType { Mtx = 0, BBoard = 1, YBBoard = 2, Multi = 3 }
export interface MtxGroup { useMtxTable: Uint16Array; indexOffset: number; indexCount: number; loadedVertexData: LoadedVertexData; }
export interface Shape { shapeMtxType: ShapeMtxType; loadedVertexLayout: LoadedVertexLayout; mtxGroups: MtxGroup[]; bbox: AABB; boundingSphereRadius: number; materialIndex: number; }
export interface MaterialEntry {
    index: number;
    name: string;
    textureIndexes: number[]; // Maps material texture slots (0-7) to TEX1 texture indices
}

export interface MAT3 {
    materialEntries: MaterialEntry[];
}

function readMAT3Chunk(buffer: ArrayBufferSlice): MAT3 {
    const view = buffer.createDataView();
    const materialCount = view.getUint16(0x08);

    const remapTableOffs = view.getUint32(0x10);
    const remapTable: number[] = [];
    for (let i = 0; i < materialCount; i++)
        remapTable[i] = view.getUint16(remapTableOffs + i * 0x02);

    const nameTableOffs = view.getUint32(0x14);
    const nameTable = readStringTable(buffer, nameTableOffs);

    const texNoOffs = view.getUint32(0x48);
    const materialEntryTableOffs = view.getUint32(0x0C);

    const materialEntries: MaterialEntry[] = [];
    for (let i = 0; i < materialCount; i++) {
        const index = i;
        const name = nameTable[i];
        const materialEntryIdx = materialEntryTableOffs + (0x014C * remapTable[i]);

        // Extract texture indices (which TEX1 texture each texture slot uses)
        const textureIndexes: number[] = [];
        for (let j = 0; j < 8; j++) {
            const textureTableIndex = view.getUint16(materialEntryIdx + 0x84 + j * 0x02);
            if (textureTableIndex !== 0xFFFF)
                textureIndexes.push(view.getUint16(texNoOffs + textureTableIndex * 0x02));
            else
                textureIndexes.push(-1);
        }

        materialEntries.push({ index, name, textureIndexes });
    }

    return { materialEntries };
}

export interface SHP1 { shapes: Shape[]; }

function readSHP1Chunk(buffer: ArrayBufferSlice, bmd: MinimalBMD): SHP1 {
    const view = buffer.createDataView();
    const shapeCount = view.getUint16(0x08);
    const shapeInitDataOffs = view.getUint32(0x0C);
    const remapTableOffs = view.getUint32(0x10);
    const vtxDeclTableOffs = view.getUint32(0x18);
    const matrixTableOffs = view.getUint32(0x1C);
    const displayListOffs = view.getUint32(0x20);
    const shapeMtxInitDataOffs = view.getUint32(0x24);
    const shapeDrawInitDataOffs = view.getUint32(0x28);

    // Ensure identity remap
    for (let i = 0; i < shapeCount; i++) assert(view.getUint16(remapTableOffs + i * 0x02) === i);

    const shapes: Shape[] = [];
    let shapeInitDataIdx = shapeInitDataOffs;
    for (let i = 0; i < shapeCount; i++) {
        const shapeMtxType = view.getUint8(shapeInitDataIdx + 0x00) as ShapeMtxType;
        assert(view.getUint8(shapeInitDataIdx + 0x01) === 0xFF);
        const mtxGroupCount = view.getUint16(shapeInitDataIdx + 0x02);
        const vtxDeclListIndex = view.getUint16(shapeInitDataIdx + 0x04);
        const shapeMtxInitDataIndex = view.getUint16(shapeInitDataIdx + 0x06);
        const shapeDrawInitDataIndex = view.getUint16(shapeInitDataIdx + 0x08);

        const vcd: GX_VtxDesc[] = [];
        const vat: GX_VtxAttrFmt[] = [];
        const vtxArrays: GX_Array[] = [];
        let usesNBT = false;
        let vtxDeclIdx = vtxDeclTableOffs + vtxDeclListIndex;
        while (true) {
            let vtxAttrib: GX.Attr = view.getUint32(vtxDeclIdx + 0x00);
            if (vtxAttrib === GX.Attr.NULL) break;
            const arrayData: ArrayBufferSlice | undefined = bmd.vtx1.arrayData[vtxAttrib];
            if (vtxAttrib === GX.Attr._NBT) {
                usesNBT = true;
                vtxAttrib = GX.Attr.NRM;
                vat[vtxAttrib] = { ... bmd.vtx1.vat[vtxAttrib], compCnt: GX.CompCnt.NRM_NBT };
            } else {
                vat[vtxAttrib] = bmd.vtx1.vat[vtxAttrib];
            }
            if (arrayData !== undefined)
                vtxArrays[vtxAttrib] = { buffer: arrayData!, offs: 0, stride: getAttributeByteSize(vat, vtxAttrib) };
            const indexDataType: GX.AttrType = view.getUint32(vtxDeclIdx + 0x04);
            vcd[vtxAttrib] = { type: indexDataType };
            vtxDeclIdx += 0x08;
        }

        const loadedVertexLayout = compileLoadedVertexLayout(vcd, usesNBT);
        const vtxLoader = compileVtxLoader(vat, vcd);

        let shapeDrawInitDataIdx = shapeDrawInitDataOffs + (shapeDrawInitDataIndex * 0x08);
        const mtxGroups: MtxGroup[] = [];
        let totalIndexCount = 0;
        let totalVertexCount = 0;
        for (let j = 0; j < mtxGroupCount; j++, shapeDrawInitDataIdx += 0x08) {
            const displayListSize = view.getUint32(shapeDrawInitDataIdx + 0x00);
            const displayListStart = displayListOffs + view.getUint32(shapeDrawInitDataIdx + 0x04);
            const mtxGroupDataOffs = shapeMtxInitDataOffs + (shapeMtxInitDataIndex + j) * 0x08;
            const useMtxIndex = view.getUint16(mtxGroupDataOffs + 0x00);
            const useMtxCount = view.getUint16(mtxGroupDataOffs + 0x02);
            const useMtxFirstIndex = view.getUint32(mtxGroupDataOffs + 0x04);
            const useMtxTableOffs = matrixTableOffs + useMtxFirstIndex * 0x02;
            const useMtxTable = buffer.createTypedArray(Uint16Array, useMtxTableOffs, useMtxCount, Endianness.BIG_ENDIAN);
            if (shapeMtxType === ShapeMtxType.Mtx) {
                assert(useMtxCount === 1);
                assert(useMtxIndex === useMtxTable[0]);
            }
            const displayList = buffer.subarray(displayListStart, displayListSize);
            const loadedVertexData = vtxLoader.runVertices(vtxArrays, displayList, { firstVertexId: totalVertexCount });
            const indexOffset = totalIndexCount;
            const indexCount = loadedVertexData.totalIndexCount;
            totalIndexCount += indexCount;
            totalVertexCount += loadedVertexData.totalVertexCount;
            mtxGroups.push({ useMtxTable, indexOffset, indexCount, loadedVertexData });
        }

        const boundingSphereRadius = view.getFloat32(shapeInitDataIdx + 0x0C);
        const bboxMinX = view.getFloat32(shapeInitDataIdx + 0x10);
        const bboxMinY = view.getFloat32(shapeInitDataIdx + 0x14);
        const bboxMinZ = view.getFloat32(shapeInitDataIdx + 0x18);
        const bboxMaxX = view.getFloat32(shapeInitDataIdx + 0x1C);
        const bboxMaxY = view.getFloat32(shapeInitDataIdx + 0x20);
        const bboxMaxZ = view.getFloat32(shapeInitDataIdx + 0x24);
        const bbox = new AABB(bboxMinX, bboxMinY, bboxMinZ, bboxMaxX, bboxMaxY, bboxMaxZ);

        const materialIndex = -1;
        shapes.push({ shapeMtxType, loadedVertexLayout, mtxGroups, bbox, boundingSphereRadius, materialIndex });
        shapeInitDataIdx += 0x28;
    }
    return { shapes };
}

class JSystemFileReaderHelper {
    public view: DataView;
    public magic: string;
    public numChunks: number;
    public subversion: string;
    public offs: number = 0x20;
    constructor(public buffer: ArrayBufferSlice) {
        this.view = this.buffer.createDataView();
        this.magic = readString(this.buffer, 0, 8);
        this.numChunks = this.view.getUint32(0x0C);
        this.subversion = readString(this.buffer, 0x10, 0x10);
    }
    public maybeNextChunk(maybeChunkId: string, sizeBias: number = 0): ArrayBufferSlice | null {
        const chunkStart = this.offs;
        const chunkId = readString(this.buffer, chunkStart + 0x00, 4);
        if (chunkId === maybeChunkId) {
            const chunkSize = this.view.getUint32(chunkStart + 0x04) + sizeBias;
            this.offs += chunkSize;
            return this.buffer.subarray(chunkStart, chunkSize);
        } else {
            return null;
        }
    }
    public nextChunk(expectedChunkId: string, sizeBias: number = 0): ArrayBufferSlice {
        const chunkStart = this.offs;
        const chunkId = readString(this.buffer, chunkStart + 0x00, 4);
        const chunkSize = this.view.getUint32(chunkStart + 0x04) + sizeBias;
        assert(chunkId === expectedChunkId);
        this.offs += chunkSize;
        return this.buffer.subarray(chunkStart, chunkSize);
    }
}

export class MinimalBMD {
    public sourceBuffer!: ArrayBufferSlice;
    public subversion: string = '';
    public inf1!: INF1;
    public vtx1!: VTX1;
    public evp1!: EVP1;
    public drw1!: DRW1;
    public jnt1!: JNT1;
    public shp1!: SHP1;
    public mat3: MAT3 | null = null;

    private constructor(j3d: JSystemFileReaderHelper) {
        this.sourceBuffer = j3d.buffer;
        this.subversion = j3d.subversion;
        this.inf1 = readINF1Chunk(j3d.nextChunk('INF1'));
        this.vtx1 = readVTX1Chunk(j3d.nextChunk('VTX1'));
        this.evp1 = readEVP1Chunk(j3d.nextChunk('EVP1'));
        this.drw1 = readDRW1Chunk(j3d.nextChunk('DRW1'));
        this.jnt1 = readJNT1Chunk(j3d.nextChunk('JNT1'));
        this.shp1 = readSHP1Chunk(j3d.nextChunk('SHP1'), this);
        // Parse MAT3 for texture-to-material mapping
        const mat3Chunk = j3d.maybeNextChunk('MAT3');
        if (mat3Chunk) {
            this.mat3 = readMAT3Chunk(mat3Chunk);
        }
        // Skip other chunks (MAT2, MDL3, TEX1) to avoid render deps
        this.assocHierarchy();
    }

    private assocHierarchy(): void {
        const view = this.inf1.hierarchyData.createDataView();
        let offs = 0x00;
        let currentMaterialIndex = -1;
        while (true) {
            const type = view.getUint16(offs + 0x00);
            const value = view.getUint16(offs + 0x02);
            if (type === 0x00) { // End
                break;
            } else if (type === 0x11) { // Material
                currentMaterialIndex = value;
            } else if (type === 0x12) { // Shape
                const shape = this.shp1.shapes[value];
                assert(currentMaterialIndex !== -1);
                assert(shape.materialIndex === -1);
                shape.materialIndex = currentMaterialIndex;
            }
            offs += 0x04;
        }
        for (let i = 0; i < this.shp1.shapes.length; i++) assert(this.shp1.shapes[i].materialIndex !== -1);
    }

    public static parse(buffer: ArrayBufferSlice): MinimalBMD {
        const j3d = new JSystemFileReaderHelper(buffer);
        assert(j3d.magic === 'J3D2bmd2' || j3d.magic === 'J3D2bmd3' || j3d.magic === 'J3D2bdl4');
        return new MinimalBMD(j3d);
    }
}

export { MinimalBMD as BMD };
