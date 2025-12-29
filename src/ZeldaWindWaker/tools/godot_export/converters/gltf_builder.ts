/**
 * glTF 2.0 Binary Format Builder
 * Constructs GLB files from geometry data
 */

import { Buffer } from 'buffer';

export enum GLTFComponentType {
    BYTE = 5120,
    UNSIGNED_BYTE = 5121,
    SHORT = 5122,
    UNSIGNED_SHORT = 5123,
    UNSIGNED_INT = 5125,
    FLOAT = 5126,
}

export enum GLTFAccessorType {
    SCALAR = 'SCALAR',
    VEC2 = 'VEC2',
    VEC3 = 'VEC3',
    VEC4 = 'VEC4',
    MAT2 = 'MAT2',
    MAT3 = 'MAT3',
    MAT4 = 'MAT4',
}

export enum GLTFBufferTarget {
    ARRAY_BUFFER = 34962,
    ELEMENT_ARRAY_BUFFER = 34963,
}

export interface GLTFBuffer {
    byteLength: number;
    uri?: string;
}

export interface GLTFBufferView {
    buffer: number;
    byteOffset: number;
    byteLength: number;
    byteStride?: number;
    target?: GLTFBufferTarget;
}

export interface GLTFAccessor {
    bufferView: number;
    byteOffset?: number;
    componentType: GLTFComponentType;
    count: number;
    type: GLTFAccessorType;
    min?: number[];
    max?: number[];
    normalized?: boolean;
}

export interface GLTFMeshPrimitive {
    attributes: {
        POSITION: number;
        NORMAL?: number;
        TANGENT?: number;
        TEXCOORD_0?: number;
        TEXCOORD_1?: number;
        COLOR_0?: number;
        JOINTS_0?: number;
        WEIGHTS_0?: number;
    };
    indices?: number;
    material?: number;
    mode?: number; // Default is 4 (TRIANGLES)
}

export interface GLTFMesh {
    name?: string;
    primitives: GLTFMeshPrimitive[];
}

export interface GLTFNode {
    name?: string;
    mesh?: number;
    skin?: number;
    children?: number[];
    matrix?: number[]; // 16 elements
    translation?: number[]; // 3 elements
    rotation?: number[]; // 4 elements (quaternion)
    scale?: number[]; // 3 elements
}

export interface GLTFSkin {
    inverseBindMatrices?: number;
    skeleton?: number;
    joints: number[];
    name?: string;
}

export interface GLTFMaterial {
    name?: string;
    pbrMetallicRoughness?: {
        baseColorFactor?: number[];
        baseColorTexture?: { index: number; texCoord?: number };
        metallicFactor?: number;
        roughnessFactor?: number;
    };
    doubleSided?: boolean;
    alphaMode?: 'OPAQUE' | 'MASK' | 'BLEND';
    alphaCutoff?: number;
}

export interface GLTFImage {
    name?: string;
    mimeType?: string; // e.g., image/png
    bufferView?: number;
    uri?: string;
}

export interface GLTFSampler {
    magFilter?: number; // 9728 NEAREST | 9729 LINEAR
    minFilter?: number; // 9728/9729/9984/9985/9986/9987
    wrapS?: number; // 33071 CLAMP_TO_EDGE | 33648 MIRRORED_REPEAT | 10497 REPEAT
    wrapT?: number;
    name?: string;
}

export interface GLTFTexture {
    name?: string;
    sampler?: number;
    source: number; // index into images
}

export interface GLTFScene {
    name?: string;
    nodes: number[];
}

export interface GLTFAsset {
    version: string;
    generator?: string;
}

export interface GLTF {
    asset: GLTFAsset;
    scene?: number;
    scenes?: GLTFScene[];
    nodes?: GLTFNode[];
    meshes?: GLTFMesh[];
    materials?: GLTFMaterial[];
    images?: GLTFImage[];
    textures?: GLTFTexture[];
    samplers?: GLTFSampler[];
    skins?: GLTFSkin[];
    buffers?: GLTFBuffer[];
    bufferViews?: GLTFBufferView[];
    accessors?: GLTFAccessor[];
}

/**
 * Helper class to build glTF JSON structure and pack into GLB binary format
 */
export class GLTFBuilder {
    private bufferData: Uint8Array[] = [];
    private bufferViews: GLTFBufferView[] = [];
    private accessors: GLTFAccessor[] = [];
    private meshes: GLTFMesh[] = [];
    private nodes: GLTFNode[] = [];
    private skins: GLTFSkin[] = [];
    private materials: GLTFMaterial[] = [];
    private images: GLTFImage[] = [];
    private textures: GLTFTexture[] = [];
    private samplers: GLTFSampler[] = [];
    private scenes: GLTFScene[] = [];
    
    private currentBufferOffset: number = 0;

    /**
     * Add raw binary data to the buffer
     * Returns the buffer view index
     */
    addBufferData(data: Uint8Array, target?: GLTFBufferTarget, byteStride?: number): number {
        const byteOffset = this.currentBufferOffset;
        const byteLength = data.byteLength;
        
        // Align to 4-byte boundary
        const alignedLength = this.alignTo4(byteLength);
        const paddedData = new Uint8Array(alignedLength);
        paddedData.set(data);
        
        this.bufferData.push(paddedData);
        
        const bufferView: GLTFBufferView = {
            buffer: 0, // We only use one buffer
            byteOffset,
            byteLength,
        };
        
        if (target !== undefined) {
            bufferView.target = target;
        }
        if (byteStride !== undefined) {
            bufferView.byteStride = byteStride;
        }
        
        const bufferViewIndex = this.bufferViews.length;
        this.bufferViews.push(bufferView);
        
        this.currentBufferOffset += alignedLength;
        
        return bufferViewIndex;
    }

    /**
     * Add an accessor that references a buffer view
     */
    addAccessor(
        bufferView: number,
        componentType: GLTFComponentType,
        count: number,
        type: GLTFAccessorType,
        min?: number[],
        max?: number[],
        normalized?: boolean
    ): number {
        const accessor: GLTFAccessor = {
            bufferView,
            componentType,
            count,
            type,
        };
        
        if (min !== undefined) accessor.min = min;
        if (max !== undefined) accessor.max = max;
        if (normalized !== undefined) accessor.normalized = normalized;
        
        const accessorIndex = this.accessors.length;
        this.accessors.push(accessor);
        return accessorIndex;
    }

    /**
     * Add a mesh with primitives
     */
    addMesh(mesh: GLTFMesh): number {
        const meshIndex = this.meshes.length;
        this.meshes.push(mesh);
        return meshIndex;
    }

    /**
     * Add a node
     */
    addNode(node: GLTFNode): number {
        const nodeIndex = this.nodes.length;
        this.nodes.push(node);
        return nodeIndex;
    }

    /**
     * Add a skin
     */
    addSkin(skin: GLTFSkin): number {
        const skinIndex = this.skins.length;
        this.skins.push(skin);
        return skinIndex;
    }

    /**
     * Add a material
     */
    addMaterial(material: GLTFMaterial): number {
        const materialIndex = this.materials.length;
        this.materials.push(material);
        return materialIndex;
    }

    /** Add an image from PNG bytes and return its index */
    addImagePNG(name: string, pngBytes: Uint8Array): number {
        const bufferView = this.addBufferData(pngBytes);
        const image: GLTFImage = {
            name,
            mimeType: 'image/png',
            bufferView,
        };
        const idx = this.images.length;
        this.images.push(image);
        return idx;
    }

    /** Add a sampler and return its index */
    addSampler(sampler: GLTFSampler): number {
        const idx = this.samplers.length;
        this.samplers.push(sampler);
        return idx;
    }

    /** Add a texture and return its index */
    addTexture(texture: GLTFTexture): number {
        const idx = this.textures.length;
        this.textures.push(texture);
        return idx;
    }

    /**
     * Add a scene
     */
    addScene(scene: GLTFScene): number {
        const sceneIndex = this.scenes.length;
        this.scenes.push(scene);
        return sceneIndex;
    }

    /**
     * Build the complete glTF JSON structure
     */
    buildJSON(): GLTF {
        // Concatenate all buffer data
        const totalBufferSize = this.bufferData.reduce((sum, buf) => sum + buf.byteLength, 0);
        
        const gltf: GLTF = {
            asset: {
                version: '2.0',
                generator: 'noclip Wind Waker Exporter',
            },
        };
        
        if (this.scenes.length > 0) {
            gltf.scenes = this.scenes;
            gltf.scene = 0;
        }
        
        if (this.nodes.length > 0) gltf.nodes = this.nodes;
        if (this.meshes.length > 0) gltf.meshes = this.meshes;
        if (this.materials.length > 0) gltf.materials = this.materials;
        if (this.images.length > 0) gltf.images = this.images;
        if (this.textures.length > 0) gltf.textures = this.textures;
        if (this.samplers.length > 0) gltf.samplers = this.samplers;
        if (this.skins.length > 0) gltf.skins = this.skins;
        if (this.bufferViews.length > 0) gltf.bufferViews = this.bufferViews;
        if (this.accessors.length > 0) gltf.accessors = this.accessors;
        
        if (totalBufferSize > 0) {
            gltf.buffers = [{
                byteLength: totalBufferSize,
            }];
        }
        
        return gltf;
    }

    /**
     * Pack the glTF JSON and binary data into GLB format
     */
    buildGLB(): Buffer {
        const gltfJson = this.buildJSON();
        const jsonString = JSON.stringify(gltfJson);
        const jsonBuffer = Buffer.from(jsonString, 'utf8');
        const jsonAlignedLength = this.alignTo4(jsonBuffer.byteLength);
        const jsonPadded = Buffer.alloc(jsonAlignedLength, 0x20); // Pad with spaces
        jsonBuffer.copy(jsonPadded);
        
        // Concatenate all buffer data
        const binaryData = Buffer.concat(this.bufferData.map(arr => Buffer.from(arr)));
        const binaryAlignedLength = this.alignTo4(binaryData.byteLength);
        const binaryPadded = Buffer.alloc(binaryAlignedLength, 0x00); // Pad with zeros
        binaryData.copy(binaryPadded);
        
        // GLB header: magic + version + length
        const header = Buffer.alloc(12);
        header.writeUInt32LE(0x46546C67, 0); // 'glTF' magic
        header.writeUInt32LE(2, 4); // version 2
        
        // Calculate total length
        const totalLength = 12 + 8 + jsonAlignedLength + (binaryData.byteLength > 0 ? 8 + binaryAlignedLength : 0);
        header.writeUInt32LE(totalLength, 8);
        
        // JSON chunk header
        const jsonChunkHeader = Buffer.alloc(8);
        jsonChunkHeader.writeUInt32LE(jsonAlignedLength, 0);
        jsonChunkHeader.writeUInt32LE(0x4E4F534A, 4); // 'JSON' type
        
        // Binary chunk header (if we have binary data)
        const chunks = [header, jsonChunkHeader, jsonPadded];
        
        if (binaryData.byteLength > 0) {
            const binaryChunkHeader = Buffer.alloc(8);
            binaryChunkHeader.writeUInt32LE(binaryAlignedLength, 0);
            binaryChunkHeader.writeUInt32LE(0x004E4942, 4); // 'BIN\0' type
            chunks.push(binaryChunkHeader, binaryPadded);
        }
        
        return Buffer.concat(chunks);
    }

    private alignTo4(value: number): number {
        return (value + 3) & ~3;
    }
}
