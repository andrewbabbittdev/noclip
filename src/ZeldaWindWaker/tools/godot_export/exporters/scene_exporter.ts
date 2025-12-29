import { ExportConfig, BaseExporter } from '../types.js';
import { Logger } from '../utils/logger.js';
import { DataLoader } from '../utils/data_loaders.js';
import { DZSLoader, DZSStageData } from '../utils/dzs_loader.js';
import { readdirSync, statSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { readGodotUIDs } from '../utils/godot_uid_reader.js';
import { ObjectNameMapper } from '../utils/object_name_mapper.js';

export class SceneExporter implements BaseExporter {
    private dataLoader: DataLoader;
    private dzsLoader: DZSLoader;
    private objectModelCache: Map<string, string[]> = new Map();
    private objectNameMapper: ObjectNameMapper;

    constructor(private config: ExportConfig, private logger: Logger) {
        this.dataLoader = new DataLoader(logger);
        this.dzsLoader = new DZSLoader(logger);
        this.objectNameMapper = new ObjectNameMapper();
    }
    
    /**
     * Find the primary GLB model file for an object
     * Returns absolute path to the GLB file, or null if not found
     */
    private findObjectModelGLB(objectName: string): string | null {
        const objectNameLower = objectName.toLowerCase();
        
        // Check cache first
        if (this.objectModelCache.has(objectNameLower)) {
            const models = this.objectModelCache.get(objectNameLower)!;
            return models.length > 0 ? models[0] : null;
        }
        
        // Check if this object is known to have no model (tags, triggers, etc.)
        if (this.objectNameMapper.hasNoModel(objectName)) {
            this.objectModelCache.set(objectNameLower, []);
            return null;
        }
        
        // Map the object name to its folder name (handles agb*, KNOB*, etc.)
        const folderName = this.objectNameMapper.getFolderName(objectName);
        if (folderName === null) {
            this.objectModelCache.set(objectNameLower, []);
            return null;
        }
        
        // Try to find the object directory using the mapped folder name
        const objectDir = path.join(this.config.outputBase, 'Object', folderName);
        
        if (!existsSync(objectDir)) {
            // Try case-insensitive search
            const objectsDir = path.join(this.config.outputBase, 'Object');
            if (existsSync(objectsDir)) {
                const dirs = readdirSync(objectsDir);
                const foundDir = dirs.find(d => d.toLowerCase() === folderName.toLowerCase());
                if (foundDir) {
                    const alternateDir = path.join(objectsDir, foundDir);
                    if (existsSync(alternateDir)) {
                        return this.findObjectModelGLBInDir(alternateDir, objectNameLower);
                    }
                }
            }
            this.objectModelCache.set(objectNameLower, []);
            return null;
        }
        
        return this.findObjectModelGLBInDir(objectDir, objectNameLower);
    }
    
    /**
     * Find the primary model GLB in a directory
     */
    private findObjectModelGLBInDir(objectDir: string, objectNameLower: string): string | null {
        const glbFiles = readdirSync(objectDir).filter(f => f.endsWith('.glb'));
        
        if (glbFiles.length === 0) {
            this.objectModelCache.set(objectNameLower, []);
            return null;
        }
        
        // Cache all models
        const fullPaths = glbFiles.map(f => path.join(objectDir, f));
        this.objectModelCache.set(objectNameLower, fullPaths);
        
        // Find primary model - prefer one that matches the object name
        const primaryModel = glbFiles.find(f => {
            const baseName = path.basename(f, '.glb').toLowerCase();
            return baseName === objectNameLower;
        });
        
        if (primaryModel) {
            return path.join(objectDir, primaryModel);
        }
        
        // If no exact match, return the first one
        return fullPaths[0];
    }

    async export(): Promise<void> {
        this.logger.info('Starting scene export (stages to .tscn)...');

        try {
            await this.exportStageScenes();
            this.logger.info('Scene export complete!');
        } catch (error) {
            this.logger.error(`Scene export failed: ${error}`);
            throw error;
        }
    }

    private async exportStageScenes(): Promise<void> {
        const stageDir = path.join(this.config.inputBase, 'Stage');
        
        if (!existsSync(stageDir)) {
            this.logger.warn(`Stage directory not found: ${stageDir}`);
            return;
        }

        const stages = this.config.stages.length > 0
            ? this.config.stages
            : this.getAvailableStages(stageDir);

        this.logger.info(`Exporting ${stages.length} stage scenes...`);

        for (const stageName of stages) {
            await this.exportStageScene(stageName);
        }
    }

    private async exportStageScene(stageName: string): Promise<void> {
        try {
            const stagePath = path.join(this.config.inputBase, 'Stage', stageName);
            const stageArcPath = path.join(stagePath, 'Stage.arc');
            
            if (!existsSync(stageArcPath)) {
                this.logger.debug(`Stage.arc not found for stage: ${stageName}`);
                return;
            }

            // Load stage archive to parse stage.dzs
            this.logger.debug(`Loading stage data for: ${stageName}`);
            const archive = this.dataLoader.loadArchive(stageArcPath);
            
            // Find and parse stage.dzs
            const stageDzsData = archive.findFilenameData('stage.dzs');
            if (!stageDzsData) {
                this.logger.warn(`stage.dzs not found in Stage.arc for: ${stageName}`);
                return;
            }

            const stageData = this.dzsLoader.parseStageFromBuffer(stageName, stageDzsData);

            // Build room list from actual Room*.arc files that exist on disk
            // (Don't rely on RTBL which contains internal game room IDs)
            const actualRooms: any[] = [];
            const roomFiles = readdirSync(stagePath).filter(f => /^Room\d+\.arc$/i.test(f));
            for (const roomFile of roomFiles) {
                const roomNum = parseInt(roomFile.match(/Room(\d+)\.arc/i)![1]);
                
                // Use MULT data to get room positions if available
                let position: [number, number, number] = [0, 0, 0];
                if (stageData.mult && stageData.mult.length > 0) {
                    // Find MULT entry for this room (MULT entries are indexed by room number)
                    const multEntry = stageData.mult.find((m: any) => m.roomNo === roomNum);
                    if (multEntry) {
                        position = [multEntry.transX, 0, multEntry.transZ];
                    }
                }
                
                actualRooms.push({
                    roomId: roomNum,
                    name: `Room${roomNum}`,
                    filename: roomFile,
                    position: position,
                    object_count: 0,
                    objects: []
                });
            }
            stageData.rooms = actualRooms.sort((a, b) => a.roomId - b.roomId);

            // Create scene output directory
            const sceneOutputDir = path.join(this.config.outputBase, 'Stage', stageName);
            if (!existsSync(sceneOutputDir)) {
                mkdirSync(sceneOutputDir, { recursive: true });
            }

            // Generate room scenes FIRST (so they exist when we reference them)
            await this.exportRoomScenes(stageName, stageData);

            // Generate main stage scene (which references the room scenes)
            const mainScenePath = path.join(sceneOutputDir, `${stageName}.tscn`);
            await this.generateStageScene(stageName, stageData, mainScenePath);

            this.logger.info(`✓ Exported stage scene: ${stageName} (${stageData.rooms.length} rooms)`);
        } catch (error) {
            this.logger.error(`Failed to export stage scene ${stageName}: ${error}`);
        }
    }

    private async exportRoomScenes(stageName: string, stageData: DZSStageData): Promise<void> {
        const stagePath = path.join(this.config.inputBase, 'Stage', stageName);

        this.logger.info(`Exporting ${stageData.rooms.length} room scenes for ${stageName}...`);

        let exportedCount = 0;
        let skippedCount = 0;
        for (const room of stageData.rooms) {
            try {
                const roomArcName = `Room${room.roomId}.arc`;
                const roomArcPath = path.join(stagePath, roomArcName);
                
                // Check if excluded
                const relativePath = `Stage/${stageName}/${roomArcName}`;
                if (this.config.excludeArchives.includes(relativePath)) {
                    this.logger.debug(`Skipping excluded archive: ${relativePath}`);
                    skippedCount++;
                    continue;
                }

                if (!existsSync(roomArcPath)) {
                    this.logger.warn(`Room archive not found: ${roomArcName} (expected at ${roomArcPath})`);
                    skippedCount++;
                    continue;
                }

                this.logger.debug(`Loading room archive: ${roomArcName}`);

                // Load room archive
                const roomArchive = this.dataLoader.loadArchive(roomArcPath);
                
                // Parse room DZR file (rooms use room.dzr, not stage.dzs)
                const roomDzrData = roomArchive.findFilenameData('room.dzr');
                if (roomDzrData) {
                    const roomObjects = this.dzsLoader.parseRoomObjectsFromBuffer(room.roomId, roomDzrData);
                    room.objects = roomObjects;
                    room.object_count = roomObjects.length;
                    this.logger.debug(`Found ${roomObjects.length} objects in Room${room.roomId}`);
                } else {
                    this.logger.warn(`No room.dzr found in ${roomArcName}`);
                }

                // Generate room scene
                const roomScenePath = path.join(this.config.outputBase, 'Stage', stageName, `Room${room.roomId}.tscn`);
                this.logger.debug(`Generating room scene: ${roomScenePath}`);
                await this.generateRoomScene(stageName, room.roomId, room, roomScenePath);

                exportedCount++;
                this.logger.debug(`✓ Exported room scene: ${stageName}/Room${room.roomId} (${room.objects.length} objects)`);
            } catch (error) {
                this.logger.error(`Failed to export room ${room.roomId} for ${stageName}: ${error}`);
                if (error instanceof Error && error.stack) {
                    this.logger.error(error.stack);
                }
            }
        }
        
        if (skippedCount > 0) {
            this.logger.info(`⚠ Skipped ${skippedCount} rooms for ${stageName}`);
        }
        this.logger.info(`✓ Exported ${exportedCount} room scenes for ${stageName}`);
    }

    private async generateStageScene(stageName: string, stageData: DZSStageData, outputPath: string): Promise<void> {
        // Collect stage models (don't rely on UIDs - they may not exist yet)
        const stageModelDir = path.join(this.config.outputBase, 'Stage', stageName, 'Stage');
        const stageModelGlbs = existsSync(stageModelDir) 
            ? readdirSync(stageModelDir).filter(f => f.endsWith('.glb')).map(f => path.join(stageModelDir, f))
            : [];
        
        // Try to read UIDs if .import files exist, otherwise use empty strings
        const stageModelUids = readGodotUIDs(stageModelGlbs);

        // Collect room scene paths
        const roomScenePaths: string[] = [];
        for (const room of stageData.rooms) {
            const roomScenePath = path.join(this.config.outputBase, 'Stage', stageName, `Room${room.roomId}.tscn`);
            if (existsSync(roomScenePath)) {
                roomScenePaths.push(roomScenePath);
            }
        }

        const lines: string[] = [];
        const totalResources = stageModelGlbs.length + roomScenePaths.length;
        
        // Header with correct load_steps count
        lines.push(`[gd_scene load_steps=${totalResources + 1} format=3 uid="uid://${this.generateUID()}"]`);
        lines.push('');

        // Define external resources for stage models
        let resourceId = 1;
        const modelResourceIds = new Map<string, number>();
        for (const glbPath of stageModelGlbs) {
            // Path relative to Godot project root (which is config.outputBase)
            const relPath = path.relative(this.config.outputBase, glbPath).replace(/\\/g, '/');
            const uid = stageModelUids.get(glbPath);
            
            // Include uid if available, otherwise Godot will assign one on import
            if (uid) {
                lines.push(`[ext_resource type="PackedScene" uid="${uid}" path="res://${relPath}" id="${resourceId}"]`);
            } else {
                lines.push(`[ext_resource type="PackedScene" path="res://${relPath}" id="${resourceId}"]`);
            }
            modelResourceIds.set(glbPath, resourceId);
            resourceId++;
        }

        // Define external resources for room scenes
        const roomResourceIds = new Map<number, number>();
        for (const room of stageData.rooms) {
            const roomScenePath = path.join(this.config.outputBase, 'Stage', stageName, `Room${room.roomId}.tscn`);
            if (existsSync(roomScenePath)) {
                // Path relative to Godot project root (which is config.outputBase)
                const relPath = path.relative(this.config.outputBase, roomScenePath).replace(/\\/g, '/');
                lines.push(`[ext_resource type="PackedScene" path="res://${relPath}" id="${resourceId}"]`);
                roomResourceIds.set(room.roomId, resourceId);
                resourceId++;
            }
        }

        lines.push('');

        // Root node - 3D scene
        lines.push(`[node name="${stageName}" type="Node3D"]`);
        lines.push('');

        // Add stage models as children (instance the GLB scenes)
        for (const glbPath of stageModelGlbs) {
            const modelName = path.basename(glbPath, '.glb');
            const resId = modelResourceIds.get(glbPath);
            
            lines.push(`[node name="${modelName}" parent="." instance=ExtResource("${resId}")]`);
            lines.push('');
        }

        // Add rooms as child scenes
        for (const room of stageData.rooms) {
            const resId = roomResourceIds.get(room.roomId);
            if (resId !== undefined) {
                lines.push(`[node name="Room${room.roomId}" parent="." instance=ExtResource("${resId}")]`);
                lines.push(`transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, ${room.position[0]}, ${room.position[1]}, ${room.position[2]})`);
                lines.push('');
            }
        }

        // Add lights
        if (stageData.environment.lights) {
            const lights = stageData.environment.lights as Array<{ pos: [number, number, number]; radius: number; color: [number, number, number, number] }>;
            for (let i = 0; i < lights.length; i++) {
                const light = lights[i];
                lines.push(`[node name="Light${i}" type="OmniLight3D" parent="."]`);
                lines.push(`transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, ${light.pos[0]}, ${light.pos[1]}, ${light.pos[2]})`);
                lines.push(`omni_range = ${light.radius}`);
                const r = light.color[0] / 255.0;
                const g = light.color[1] / 255.0;
                const b = light.color[2] / 255.0;
                lines.push(`light_color = Color(${r}, ${g}, ${b}, 1)`);
                lines.push('');
            }
        }

        writeFileSync(outputPath, lines.join('\n'));
    }

    private async generateRoomScene(stageName: string, roomId: number, room: any, outputPath: string): Promise<void> {
        // Collect room models (don't rely on UIDs - they may not exist yet)
        const roomModelDir = path.join(this.config.outputBase, 'Stage', stageName, `Room${roomId}`);
        const roomModelGlbs = existsSync(roomModelDir)
            ? readdirSync(roomModelDir).filter(f => f.endsWith('.glb')).map(f => path.join(roomModelDir, f))
            : [];
        
        // Collect object models for the room
        const objectModelGlbs: string[] = [];
        const objectModelMap = new Map<string, string>(); // maps object name to GLB path
        
        if (room.objects && room.objects.length > 0) {
            const uniqueObjects = new Set<string>();
            for (const obj of room.objects) {
                uniqueObjects.add(obj.name);
            }
            
            for (const objName of uniqueObjects) {
                const glbPath = this.findObjectModelGLB(objName);
                if (glbPath) {
                    objectModelGlbs.push(glbPath);
                    objectModelMap.set(objName, glbPath);
                }
            }
        }
        
        // Try to read UIDs if .import files exist
        const roomModelUids = readGodotUIDs(roomModelGlbs);
        const objectModelUids = readGodotUIDs(objectModelGlbs);

        const lines: string[] = [];
        const totalResources = roomModelGlbs.length + objectModelGlbs.length;
        
        // Header with correct load_steps count
        lines.push(`[gd_scene load_steps=${totalResources + 1} format=3 uid="uid://${this.generateUID()}"]`);
        lines.push('');

        // Define external resources for room models
        let resourceId = 1;
        const modelResourceIds = new Map<string, number>();
        for (const glbPath of roomModelGlbs) {
            // Path relative to Godot project root (which is config.outputBase)
            const relPath = path.relative(this.config.outputBase, glbPath).replace(/\\/g, '/');
            const uid = roomModelUids.get(glbPath);
            
            // Include uid if available, otherwise Godot will assign one on import
            if (uid) {
                lines.push(`[ext_resource type="PackedScene" uid="${uid}" path="res://${relPath}" id="${resourceId}"]`);
            } else {
                lines.push(`[ext_resource type="PackedScene" path="res://${relPath}" id="${resourceId}"]`);
            }
            modelResourceIds.set(glbPath, resourceId);
            resourceId++;
        }
        
        // Define external resources for object models
        const objectResourceIds = new Map<string, number>();
        for (const glbPath of objectModelGlbs) {
            const relPath = path.relative(this.config.outputBase, glbPath).replace(/\\/g, '/');
            const uid = objectModelUids.get(glbPath);
            
            if (uid) {
                lines.push(`[ext_resource type="PackedScene" uid="${uid}" path="res://${relPath}" id="${resourceId}"]`);
            } else {
                lines.push(`[ext_resource type="PackedScene" path="res://${relPath}" id="${resourceId}"]`);
            }
            objectResourceIds.set(glbPath, resourceId);
            resourceId++;
        }

        lines.push('');

        // Root node
        lines.push(`[node name="Room${roomId}" type="Node3D"]`);
        lines.push('');

        // Add room models (instance the GLB scenes)
        for (const glbPath of roomModelGlbs) {
            const modelName = path.basename(glbPath, '.glb');
            const resId = modelResourceIds.get(glbPath);
            
            lines.push(`[node name="${modelName}" parent="." instance=ExtResource("${resId}")]`);
            lines.push('');
        }

        // Add objects (actors, scene objects, etc.)
        if (room.objects && room.objects.length > 0) {
            lines.push(`[node name="Objects" type="Node3D" parent="."]`);
            lines.push('');

            for (let i = 0; i < room.objects.length; i++) {
                const obj = room.objects[i];
                const objName = `${obj.name}_${i}`.replace(/[^a-zA-Z0-9_]/g, '_');
                
                // Check if we have a model for this object
                const objectGlbPath = objectModelMap.get(obj.name);
                const objectResId = objectGlbPath ? objectResourceIds.get(objectGlbPath) : null;
                
                if (objectResId) {
                    // Instance the object model
                    lines.push(`[node name="${objName}" parent="Objects" instance=ExtResource("${objectResId}")]`);
                } else {
                    // Fallback: create empty Node3D if model not found
                    lines.push(`[node name="${objName}" type="Node3D" parent="Objects"]`);
                }
                
                // Create transform with position, rotation, and scale
                // Godot uses Y-up coordinate system like Wind Waker
                lines.push(`transform = Transform3D(${obj.scale[0]}, 0, 0, 0, ${obj.scale[1]}, 0, 0, 0, ${obj.scale[2]}, ${obj.position[0]}, ${obj.position[1]}, ${obj.position[2]})`);
                
                // Add metadata about the object
                lines.push(`metadata/object_name = "${obj.name}"`);
                lines.push(`metadata/object_type = "${obj.type}"`);
                lines.push(`metadata/parameters = ${obj.params.parameter}`);
                lines.push(`metadata/enemy_no = ${obj.params.enemyNo}`);
                lines.push(`metadata/rotation_raw = Vector3i(${obj.rotation[0]}, ${obj.rotation[1]}, ${obj.rotation[2]})`);
                lines.push('');
            }
        }

        writeFileSync(outputPath, lines.join('\n'));
    }

    private getAvailableStages(stageDir: string): string[] {
        try {
            return readdirSync(stageDir)
                .filter(name => {
                    const fullPath = path.join(stageDir, name);
                    return statSync(fullPath).isDirectory();
                });
        } catch (error) {
            this.logger.warn(`Failed to read stage directory: ${error}`);
            return [];
        }
    }

    private generateUID(): string {
        // Generate a random Godot-style UID (base64-like string)
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < 10; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }
}
