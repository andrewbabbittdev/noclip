/**
 * J3D to GLB Converter
 * Extracts geometry, skeleton, and material data from J3D models and exports to glTF 2.0 format
 */

import { writeFileSync } from 'fs';
import { mat4, vec3, quat } from 'gl-matrix';
import { BMD, Shape, Joint } from '../vendor/minimal_j3d.js';
import { Logger } from '../utils/logger.js';
import {
    GLTFBuilder,
    GLTFComponentType,
    GLTFAccessorType,
    GLTFBufferTarget,
    GLTFMeshPrimitive,
    GLTFMesh,
    GLTFNode,
} from './gltf_builder.js';
import * as GX from '../../../../gx/gx_enum.js';
import { extractTEX1Textures } from '../utils/tex1_extractor.js';
import { BTIToPNGConverter } from './bti_to_png.js';
import { initRustForNode } from '../utils/rust_node_init.js';

interface VertexAttributes {
    positions: Float32Array;
    normals?: Float32Array;
    texCoords0?: Float32Array;
    colorsU8?: Uint8Array;
    indices: Uint16Array;
    posMin: vec3;
    posMax: vec3;
}

export class J3DToGLBConverter {
    constructor(private logger: Logger) {}

    /**
     * Convert a BMD model to GLB and write to disk
     */
    async convert(bmd: BMD, outputPath: string, modelName: string = 'model'): Promise<void> {
        this.logger.debug(`Converting J3D model to GLB: ${outputPath}`);

        try {
            const builder = new GLTFBuilder();

            // Initialize Rust/WASM decoder for texture work
            await initRustForNode();

            // Extract embedded TEX1 textures and embed as images in GLB (PNG)
            // Build texture index -> gltf texture mapping
            const textureIndexToGLTF = new Map<number, number>();
            try {
                const modelData: any = bmd as any;
                const sourceBuf = modelData.sourceBuffer;
                if (sourceBuf) {
                    const textures = extractTEX1Textures(sourceBuf);
                    const samplerCache = new Map<string, number>();
                    
                    // Embed all textures (not just the first one)
                    for (let i = 0; i < textures.length; i++) {
                        const tex = textures[i];
                        if (!tex.data) continue;
                        try {
                            const png = await BTIToPNGConverter.convertToPNG(tex);
                            const imageIdx = builder.addImagePNG(tex.name, png);

                            // Create or reuse sampler for this texture
                            const samplerKey = `${tex.minFilter}|${tex.magFilter}|${tex.wrapS}|${tex.wrapT}`;
                            let samplerIdx = samplerCache.get(samplerKey);
                            if (samplerIdx === undefined) {
                                samplerIdx = builder.addSampler({
                                    magFilter: this.mapMagFilter(tex.magFilter),
                                    minFilter: this.mapMinFilter(tex.minFilter),
                                    wrapS: this.mapWrap(tex.wrapS),
                                    wrapT: this.mapWrap(tex.wrapT),
                                });
                                samplerCache.set(samplerKey, samplerIdx);
                            }

                            // Create texture object linking image+sampler
                            const textureIdx = builder.addTexture({
                                name: tex.name,
                                source: imageIdx,
                                sampler: samplerIdx,
                            });

                            // Map TEX1 index to GLTF texture index
                            textureIndexToGLTF.set(i, textureIdx);
                        } catch (e) {
                            this.logger.warn(`Failed to embed texture ${tex.name}: ${e}`);
                        }
                    }
                }
            } catch (e) {
                this.logger.warn(`Texture embedding skipped: ${e}`);
            }

            // Determine per-material UV usage to avoid unused materials
            const usage = this.computeMaterialUsage(bmd);
            // Extract materials (create only those needed)
            const materialIndices = this.extractMaterials(bmd, builder, textureIndexToGLTF, usage);

            // Extract meshes from shapes
            const meshIndices = this.extractMeshes(bmd, builder, materialIndices);

            // Extract skeleton and build skin with a common root
            const { skinIndex, skeletonRootIndex } = this.buildSkinAndJoints(bmd, builder);

            // Create mesh nodes
            const meshNodes: number[] = [];
            for (let i = 0; i < meshIndices.length; i++) {
                const node: GLTFNode = {
                    name: `Shape_${i}`,
                    mesh: meshIndices[i],
                    skin: skinIndex,
                };
                meshNodes.push(builder.addNode(node));
            }

            // Create scene: put skeleton root (if any) and skinned meshes at the scene root
            const sceneNodes: number[] = [];
            if (skeletonRootIndex !== undefined) sceneNodes.push(skeletonRootIndex);
            sceneNodes.push(...meshNodes);
            builder.addScene({ name: 'Scene', nodes: sceneNodes });

            // Build and write GLB
            const glbBuffer = builder.buildGLB();
            writeFileSync(outputPath, glbBuffer);
            
            this.logger.debug(`Successfully wrote GLB: ${outputPath} (${glbBuffer.byteLength} bytes)`);
        } catch (error) {
            this.logger.error(`Failed to convert J3D to GLB: ${error}`);
            throw error;
        }
    }

    /**
     * Extract materials from BMD
     */
    private extractMaterials(
        bmd: BMD,
        builder: GLTFBuilder,
        textureIndexToGLTF: Map<number, number>,
        usage: { withUV: Set<number>; withoutUV: Set<number> }
    ): { textured: number[]; untextured: number[] } {
        // Create placeholder materials based on material indices referenced by shapes
        const usedMaterialIndices = new Set<number>();
        for (const shape of bmd.shp1.shapes) usedMaterialIndices.add(shape.materialIndex);
        const sorted = Array.from(usedMaterialIndices.values()).sort((a,b)=>a-b);
        const textured: number[] = [];
        const untextured: number[] = [];
        
        for (const idx of sorted) {
            // Get the texture index for this material from MAT3 (if available)
            let gltfTextureIndex: number | undefined = undefined;
            if (bmd.mat3 && idx < bmd.mat3.materialEntries.length) {
                const matEntry = bmd.mat3.materialEntries[idx];
                // Use the first valid texture index from this material's texture slots
                for (const texIdx of matEntry.textureIndexes) {
                    if (texIdx >= 0 && textureIndexToGLTF.has(texIdx)) {
                        gltfTextureIndex = textureIndexToGLTF.get(texIdx);
                        break;
                    }
                }
            }
            
            const base = {
                name: `Material_${idx}`,
                pbrMetallicRoughness: {
                    baseColorFactor: [1.0, 1.0, 1.0, 1.0],
                    metallicFactor: 0.0,
                    roughnessFactor: 0.9,
                },
                doubleSided: true,
                alphaMode: 'OPAQUE' as const,
            };
            
            if (usage.withoutUV.has(idx)) {
                const matNoTex = builder.addMaterial(base);
                untextured[idx] = matNoTex;
            }
            if (usage.withUV.has(idx)) {
                const matWithTex = builder.addMaterial(gltfTextureIndex !== undefined ? {
                    ...base,
                    pbrMetallicRoughness: {
                        ...base.pbrMetallicRoughness,
                        baseColorTexture: { index: gltfTextureIndex, texCoord: 0 },
                    },
                } : base);
                textured[idx] = matWithTex;
            }
        }
        return { textured, untextured };
    }

    private computeMaterialUsage(bmd: BMD): { withUV: Set<number>; withoutUV: Set<number> } {
        const withUV = new Set<number>();
        const withoutUV = new Set<number>();
        for (const shape of bmd.shp1.shapes) {
            const hasUV = shape.loadedVertexLayout.vertexAttributeOffsets[GX.Attr.TEX0] !== undefined;
            if (hasUV) withUV.add(shape.materialIndex); else withoutUV.add(shape.materialIndex);
        }
        return { withUV, withoutUV };
    }

    /**
     * Extract meshes from shapes
     */
    private extractMeshes(bmd: BMD, builder: GLTFBuilder, materialIndices: { textured: number[]; untextured: number[] }): number[] {
        const meshIndices: number[] = [];

        if (!bmd.shp1) {
            return meshIndices;
        }

        for (let i = 0; i < bmd.shp1.shapes.length; i++) {
            const shape = bmd.shp1.shapes[i];
            
            try {
                const vertexData = this.extractShapeVertices(shape, bmd);
                const meshIndex = this.buildMesh(builder, vertexData, shape, materialIndices);
                if (meshIndex !== null) meshIndices.push(meshIndex);
            } catch (error) {
                this.logger.warn(`Failed to extract shape ${i}: ${error}`);
            }
        }

        return meshIndices;
    }

    /**
     * Extract vertex data from a shape
     */
    private extractShapeVertices(shape: Shape, bmd: BMD): VertexAttributes {
        // Collect all vertex data from all matrix groups
        const allPositions: number[] = [];
        const allNormals: number[] = [];
        const allTexCoords: number[] = [];
        const allColors: number[] = [];
        const allIndices: number[] = [];
        const allJoints: number[] = [];
        const allWeights: number[] = [];

        let currentVertexOffset = 0;
        let posMin = vec3.fromValues(Infinity, Infinity, Infinity);
        let posMax = vec3.fromValues(-Infinity, -Infinity, -Infinity);

        for (const mtxGroup of shape.mtxGroups) {
            const vtxData = mtxGroup.loadedVertexData;
            const layout = shape.loadedVertexLayout;
            const stride = layout.vertexBufferStrides[0] || 0;
            const vb = vtxData.vertexBuffers[0];
            const u8 = new Uint8Array(vb as ArrayBufferLike);
            const view = new DataView(u8.buffer);
            const littleEndian = true;

            // Compute a safe vertex count based on buffer size and stride
            const vbByteLength = u8.byteLength;
            const safeVertexCount = stride > 0 ? Math.min(vtxData.totalVertexCount, Math.floor(vbByteLength / stride)) : 0;

            // Helper to compute how many vertices fit for a given attribute
            const computeFitCount = (bytesNeeded: number, attrOffs: number | undefined): number => {
                if (stride <= 0 || attrOffs === undefined) return 0;
                // If even the first vertex doesn't fit, return 0
                if (attrOffs + bytesNeeded > vbByteLength) return 0;
                const remaining = vbByteLength - attrOffs - bytesNeeded;
                return Math.min(safeVertexCount, Math.floor(remaining / stride) + 1);
            };

            // Resolve skinning for this matrix group
            const jointsForGroup: number[] = [0, 0, 0, 0];
            const weightsForGroup: number[] = [1, 0, 0, 0];
            if (mtxGroup.useMtxTable && mtxGroup.useMtxTable.length > 0 && bmd.drw1) {
                const matIndex = mtxGroup.useMtxTable[0];
                const def = bmd.drw1.matrixDefinitions[matIndex];
                if (def) {
                    if ((def as any).jointIndex !== undefined) {
                        jointsForGroup[0] = (def as any).jointIndex >>> 0;
                        weightsForGroup[0] = 1.0;
                        weightsForGroup[1] = weightsForGroup[2] = weightsForGroup[3] = 0.0;
                    } else if ((def as any).envelopeIndex !== undefined && bmd.evp1) {
                        const env = bmd.evp1.envelopes[(def as any).envelopeIndex];
                        if (env && env.weightedBones && env.weightedBones.length > 0) {
                            const sorted = [...env.weightedBones].sort((a, b) => b.weight - a.weight).slice(0, 4);
                            for (let k = 0; k < 4; k++) {
                                jointsForGroup[k] = sorted[k]?.jointIndex ?? 0;
                                weightsForGroup[k] = sorted[k]?.weight ?? 0.0;
                            }
                            // Normalize weights to sum 1.0
                            const sum = weightsForGroup.reduce((s, v) => s + v, 0);
                            if (sum > 0) {
                                for (let k = 0; k < 4; k++) weightsForGroup[k] /= sum;
                            } else {
                                weightsForGroup[0] = 1.0; weightsForGroup[1] = weightsForGroup[2] = weightsForGroup[3] = 0.0;
                            }
                        }
                    }
                }
            }

            // Positions
            const posOffs = layout.vertexAttributeOffsets[GX.Attr.POS];
            const groupVertexCount = computeFitCount(12, posOffs);
            if (stride > 0 && posOffs !== undefined && groupVertexCount > 0) {
                for (let v = 0; v < groupVertexCount; v++) {
                    const base = v * stride + posOffs;
                    const x = view.getFloat32(base + 0, littleEndian);
                    const y = view.getFloat32(base + 4, littleEndian);
                    const z = view.getFloat32(base + 8, littleEndian);
                    allPositions.push(x, y, z);
                    posMin[0] = Math.min(posMin[0], x);
                    posMin[1] = Math.min(posMin[1], y);
                    posMin[2] = Math.min(posMin[2], z);
                    posMax[0] = Math.max(posMax[0], x);
                    posMax[1] = Math.max(posMax[1], y);
                    posMax[2] = Math.max(posMax[2], z);
                    // Add skinning for this vertex
                    allJoints.push(jointsForGroup[0], jointsForGroup[1], jointsForGroup[2], jointsForGroup[3]);
                    allWeights.push(weightsForGroup[0], weightsForGroup[1], weightsForGroup[2], weightsForGroup[3]);
                }
            }

            // Normals
            const nrmOffs = layout.vertexAttributeOffsets[GX.Attr.NRM];
            const nrmCount = computeFitCount(12, nrmOffs);
            if (stride > 0 && nrmOffs !== undefined && nrmCount > 0) {
                for (let v = 0; v < Math.min(nrmCount, groupVertexCount); v++) {
                    const base = v * stride + nrmOffs;
                    allNormals.push(
                        view.getFloat32(base + 0, littleEndian),
                        view.getFloat32(base + 4, littleEndian),
                        view.getFloat32(base + 8, littleEndian),
                    );
                }
            }

            // TEXCOORD_0
            const tex0Offs = layout.vertexAttributeOffsets[GX.Attr.TEX0];
            const texCount = computeFitCount(8, tex0Offs);
            if (stride > 0 && tex0Offs !== undefined && texCount > 0) {
                for (let v = 0; v < Math.min(texCount, groupVertexCount); v++) {
                    const base = v * stride + tex0Offs;
                    allTexCoords.push(
                        view.getFloat32(base + 0, littleEndian),
                        view.getFloat32(base + 4, littleEndian),
                    );
                }
            }

            // Colors (optional, read as floats if present)
            const clrOffs = layout.vertexAttributeOffsets[GX.Attr.CLR0];
            // Colors are packed in the compiled buffer as U8 RGBA normalized. Read 4 bytes per vertex.
            const clrCount = computeFitCount(4, clrOffs);
            if (stride > 0 && clrOffs !== undefined && clrCount > 0) {
                for (let v = 0; v < Math.min(clrCount, groupVertexCount); v++) {
                    const base = v * stride + clrOffs;
                    allColors.push(
                        u8[base + 0],
                        u8[base + 1],
                        u8[base + 2],
                        u8[base + 3],
                    );
                }
            }

            // Extract indices (clamp to available vertices)
            // Process indices in groups of 3 (triangles) to maintain validity
            for (const draw of vtxData.draws) {
                const indexBuffer = new Uint16Array(vtxData.indexData);
                const maxReadable = Math.max(0, indexBuffer.length - draw.indexOffset);
                const count = Math.min(draw.indexCount, maxReadable);
                // Process complete triangles only (groups of 3 indices)
                const completeTriangleCount = Math.floor(count / 3);
                for (let tri = 0; tri < completeTriangleCount; tri++) {
                    const idx0 = indexBuffer[draw.indexOffset + tri * 3 + 0];
                    const idx1 = indexBuffer[draw.indexOffset + tri * 3 + 1];
                    const idx2 = indexBuffer[draw.indexOffset + tri * 3 + 2];
                    // Only add triangle if all indices are valid
                    if (idx0 < groupVertexCount && idx1 < groupVertexCount && idx2 < groupVertexCount) {
                        allIndices.push(idx0 + currentVertexOffset);
                        allIndices.push(idx1 + currentVertexOffset);
                        allIndices.push(idx2 + currentVertexOffset);
                    }
                }
            }

            // Update vertex offset for next matrix group
            if (stride > 0 && posOffs !== undefined) {
                currentVertexOffset += groupVertexCount;
            }
        }

        // Normalize normals to unit length for validator expectations
        if (allNormals.length > 0) {
            for (let i = 0; i < allNormals.length; i += 3) {
                const x = allNormals[i + 0];
                const y = allNormals[i + 1];
                const z = allNormals[i + 2];
                const len = Math.sqrt(x*x + y*y + z*z) || 1;
                allNormals[i + 0] = x / len;
                allNormals[i + 1] = y / len;
                allNormals[i + 2] = z / len;
            }
        }

        return {
            positions: new Float32Array(allPositions),
            normals: allNormals.length > 0 ? new Float32Array(allNormals) : undefined,
            texCoords0: allTexCoords.length > 0 ? new Float32Array(allTexCoords) : undefined,
            colorsU8: allColors.length > 0 ? new Uint8Array(allColors) : undefined,
            indices: new Uint16Array(allIndices),
            posMin,
            posMax,
            // @ts-ignore - extend at runtime
            joints: allJoints.length > 0 ? new Uint16Array(allJoints) : undefined,
            // @ts-ignore - extend at runtime
            weights: allWeights.length > 0 ? new Float32Array(allWeights) : undefined,
        };
    }

    /**
     * Build a glTF mesh from vertex data
     */
    private buildMesh(
        builder: GLTFBuilder,
        vertexData: VertexAttributes,
        shape: Shape,
        materialIndices: { textured: number[]; untextured: number[] }
    ): number | null {
        if (vertexData.positions.length === 0 || vertexData.indices.length === 0) {
            return null;
        }
        const primitive: GLTFMeshPrimitive = {
            attributes: {
                POSITION: -1, // Will be set below
            },
            mode: 4,
        };

        // Add position accessor
        const posBufferView = builder.addBufferData(
            new Uint8Array(vertexData.positions.buffer),
            GLTFBufferTarget.ARRAY_BUFFER
        );
        primitive.attributes.POSITION = builder.addAccessor(
            posBufferView,
            GLTFComponentType.FLOAT,
            vertexData.positions.length / 3,
            GLTFAccessorType.VEC3,
            Array.from(vertexData.posMin),
            Array.from(vertexData.posMax)
        );

        // Add normal accessor if available
        if (vertexData.normals) {
            const nrmBufferView = builder.addBufferData(
                new Uint8Array(vertexData.normals.buffer),
                GLTFBufferTarget.ARRAY_BUFFER
            );
            primitive.attributes.NORMAL = builder.addAccessor(
                nrmBufferView,
                GLTFComponentType.FLOAT,
                vertexData.normals.length / 3,
                GLTFAccessorType.VEC3
            );
        }

        // Add texture coordinate accessor if available
        if (vertexData.texCoords0) {
            const texBufferView = builder.addBufferData(
                new Uint8Array(vertexData.texCoords0.buffer),
                GLTFBufferTarget.ARRAY_BUFFER
            );
            primitive.attributes.TEXCOORD_0 = builder.addAccessor(
                texBufferView,
                GLTFComponentType.FLOAT,
                vertexData.texCoords0.length / 2,
                GLTFAccessorType.VEC2
            );
        }

        // Add color accessor if available (U8 normalized RGBA)
        if (vertexData.colorsU8) {
            const colBufferView = builder.addBufferData(
                new Uint8Array(vertexData.colorsU8.buffer),
                GLTFBufferTarget.ARRAY_BUFFER
            );
            primitive.attributes.COLOR_0 = builder.addAccessor(
                colBufferView,
                GLTFComponentType.UNSIGNED_BYTE,
                vertexData.colorsU8.length / 4,
                GLTFAccessorType.VEC4,
                undefined,
                undefined,
                true
            );
        }

        // Add joints/weights if available
        const anyVD: any = vertexData as any;
        if (anyVD.joints && anyVD.weights) {
            const jBufferView = builder.addBufferData(new Uint8Array(anyVD.joints.buffer), GLTFBufferTarget.ARRAY_BUFFER);
            primitive.attributes.JOINTS_0 = builder.addAccessor(
                jBufferView,
                GLTFComponentType.UNSIGNED_SHORT,
                anyVD.joints.length / 4,
                GLTFAccessorType.VEC4
            );
            const wBufferView = builder.addBufferData(new Uint8Array(anyVD.weights.buffer), GLTFBufferTarget.ARRAY_BUFFER);
            primitive.attributes.WEIGHTS_0 = builder.addAccessor(
                wBufferView,
                GLTFComponentType.FLOAT,
                anyVD.weights.length / 4,
                GLTFAccessorType.VEC4
            );
        }

        // Add index accessor
        const indexBufferView = builder.addBufferData(
            new Uint8Array(vertexData.indices.buffer),
            GLTFBufferTarget.ELEMENT_ARRAY_BUFFER
        );
        primitive.indices = builder.addAccessor(
            indexBufferView,
            GLTFComponentType.UNSIGNED_SHORT,
            vertexData.indices.length,
            GLTFAccessorType.SCALAR
        );

        // Assign material if available
        if (shape.materialIndex >= 0) {
            const useTex = vertexData.texCoords0 && vertexData.texCoords0.length > 0;
            const list = useTex ? materialIndices.textured : materialIndices.untextured;
            if (shape.materialIndex < list.length) primitive.material = list[shape.materialIndex];
        }

        // Create mesh
        const mesh: GLTFMesh = {
            name: `Mesh_${shape.materialIndex}`,
            primitives: [primitive],
        };

        return builder.addMesh(mesh);
    }

    /**
     * Extract skeleton (joint hierarchy) from BMD
     */
    private buildSkinAndJoints(bmd: BMD, builder: GLTFBuilder): { skinIndex: number | undefined; skeletonRootIndex?: number } {
        const jointNodeIndices: number[] = [];
        if (!bmd.jnt1 || bmd.jnt1.joints.length === 0) {
            return { skinIndex: undefined };
        }

        // Create joint nodes (flat for now)
        for (let i = 0; i < bmd.jnt1.joints.length; i++) {
            const joint = bmd.jnt1.joints[i];
            const node = this.createJointNode(joint);
            jointNodeIndices.push(builder.addNode(node));
        }

        // Create a skeleton root node that is a common ancestor of all joints
        const skeletonRootIndex = builder.addNode({ name: 'Skeleton', children: jointNodeIndices });

        // Build inverse bind matrices buffer
        const jointCount = bmd.jnt1.joints.length;
        const ibm = new Float32Array(jointCount * 16);
        for (let i = 0; i < jointCount; i++) {
            const m = bmd.evp1 && bmd.evp1.inverseBinds[i] ? bmd.evp1.inverseBinds[i] : mat4.create();
            ibm.set(m, i * 16);
        }
        const ibmBufferView = builder.addBufferData(new Uint8Array(ibm.buffer));
        const ibmAccessor = builder.addAccessor(
            ibmBufferView,
            GLTFComponentType.FLOAT,
            jointCount,
            GLTFAccessorType.MAT4
        );

        const skinIndex = builder.addSkin({
            inverseBindMatrices: ibmAccessor,
            joints: jointNodeIndices,
            skeleton: skeletonRootIndex,
        });
        return { skinIndex, skeletonRootIndex };
    }

    /**
     * Create a glTF node from a joint
     */
    private createJointNode(joint: Joint): GLTFNode {
        const node: GLTFNode = {
            name: joint.name || 'Joint',
            translation: Array.from(joint.transform.translation),
            rotation: Array.from(joint.transform.rotation),
            scale: Array.from(joint.transform.scale),
        };

        return node;
    }

    private mapWrap(w: GX.WrapMode | undefined): number | undefined {
        if (w === undefined) return undefined;
        switch (w) {
            case GX.WrapMode.CLAMP: return 33071; // CLAMP_TO_EDGE
            case GX.WrapMode.REPEAT: return 10497; // REPEAT
            case GX.WrapMode.MIRROR: return 33648; // MIRRORED_REPEAT
            default: return undefined;
        }
    }

    private mapMagFilter(f: GX.TexFilter | undefined): number | undefined {
        if (f === undefined) return undefined;
        switch (f) {
            case GX.TexFilter.NEAR: return 9728; // NEAREST
            case GX.TexFilter.LINEAR:
            case GX.TexFilter.LIN_MIP_NEAR:
            case GX.TexFilter.LIN_MIP_LIN:
                return 9729; // LINEAR
            case GX.TexFilter.NEAR_MIP_NEAR:
            case GX.TexFilter.NEAR_MIP_LIN:
                return 9728; // NEAREST
            default: return undefined;
        }
    }

    private mapMinFilter(f: GX.TexFilter | undefined): number | undefined {
        if (f === undefined) return undefined;
        switch (f) {
            case GX.TexFilter.NEAR: return 9728; // NEAREST
            case GX.TexFilter.LINEAR: return 9729; // LINEAR
            case GX.TexFilter.NEAR_MIP_NEAR: return 9984; // NEAREST_MIPMAP_NEAREST
            case GX.TexFilter.LIN_MIP_NEAR: return 9985; // LINEAR_MIPMAP_NEAREST
            case GX.TexFilter.NEAR_MIP_LIN: return 9986; // NEAREST_MIPMAP_LINEAR
            case GX.TexFilter.LIN_MIP_LIN: return 9987; // LINEAR_MIPMAP_LINEAR
            default: return undefined;
        }
    }
}
