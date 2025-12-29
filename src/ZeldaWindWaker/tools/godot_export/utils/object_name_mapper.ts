/**
 * Maps Wind Waker object names (from DZS files) to their actual Object folder names.
 * 
 * Many objects in Wind Waker use prefixed names (like agbF, agbMARK, KNOB00) where
 * the object models live in a parent folder (Agb, Knob, etc.).
 * 
 * This mapper is built from analysis of the game's l_objectName table and object archives.
 */

export class ObjectNameMapper {
    private nameToFolderMap: Map<string, string> = new Map();
    
    constructor() {
        this.buildMappings();
    }
    
    private buildMappings(): void {
        // AGBrelated objects (all agb* variants) -> Agb folder
        const agbObjects = [
            'agbA', 'agbA2', 'agbB', 'agbCSW', 'agbE', 'agbF', 'agbFA', 'agbH', 'agbMARK',
            'agbMK', 'agbR', 'agbSW0', 'agbSW1', 'agbSW2', 'agbTBOX'
        ];
        for (const obj of agbObjects) {
            this.nameToFolderMap.set(obj, 'Agb');
        }
        
        // KNOB related objects -> Knob folder
        const knobObjects = ['KNOB00', 'KNOB01', 'KNOB02', 'KNOB03', 'KNOB04'];
        for (const obj of knobObjects) {
            this.nameToFolderMap.set(obj, 'Knob');
        }
        
        // Grass/Kusa variants -> Kusa folder
        const kusaObjects = ['kusax1', 'kusax3', 'kusax5', 'kusax7', 'kusax9', 'kusax11', 
                            'kusax13', 'kusax15', 'kusax17', 'kusax19', 'kusax21'];
        for (const obj of kusaObjects) {
            this.nameToFolderMap.set(obj, 'Kusa');
        }
        
        // Wood/Tree variants -> Kwood_00 or Lwood
        const woodObjects = ['swood', 'swood2', 'swood3', 'swood4', 'swood5', 'woodb', 'woodbx'];
        for (const obj of woodObjects) {
            this.nameToFolderMap.set(obj, 'Kwood_00');
        }
        const lwoodObjects = ['lwood'];
        for (const obj of lwoodObjects) {
            this.nameToFolderMap.set(obj, 'Lwood');
        }
        
        // Flower variants -> Pflower or specific flower types
        const flowerObjects = ['pflower', 'flwr7', 'flwr17'];
        for (const obj of flowerObjects) {
            this.nameToFolderMap.set(obj, 'Pf'); // Pf is likely the flower folder
        }
        
        // Pot/Jar variants -> Ptubo
        const tuboObjects = ['kotubo', 'ootubo', 'ootubo1', 'ootubo2'];
        for (const obj of tuboObjects) {
            this.nameToFolderMap.set(obj, 'Ptubo');
        }
        
        // Raft variants -> IkadaH
        const ikadaObjects = ['ikada', 'ikada_h'];
        for (const obj of ikadaObjects) {
            this.nameToFolderMap.set(obj, 'IkadaH');
        }
        
        // Item variants -> Sitem
        const itemObjects = ['item'];
        for (const obj of itemObjects) {
            this.nameToFolderMap.set(obj, 'Sitem');
        }
        
        // Salvage variants -> Salvage
        const salvageObjects = ['Salvag2', 'SalvagE'];
        for (const obj of salvageObjects) {
            this.nameToFolderMap.set(obj, 'Salvage');
        }
        
        // Pig variants -> P1 or P2
        const pigObjects = ['Pig'];
        for (const obj of pigObjects) {
            this.nameToFolderMap.set(obj, 'P1');
        }
        
        // Various people/NPC variants
        this.nameToFolderMap.set('P1a', 'P1');
        this.nameToFolderMap.set('P2b', 'P2');
        this.nameToFolderMap.set('Bm1', 'Bm');
        this.nameToFolderMap.set('Ym1', 'Ym');
        this.nameToFolderMap.set('Ym2', 'Ym');
        this.nameToFolderMap.set('Yw1', 'Yw');
        this.nameToFolderMap.set('Aj1', 'Aj');
        this.nameToFolderMap.set('Ko1', 'Ko');
        this.nameToFolderMap.set('Ko2', 'Ko');
        this.nameToFolderMap.set('Zl1', 'Zl');
        this.nameToFolderMap.set('Zl2', 'Zl2');
        
        // Enemy variants
        this.nameToFolderMap.set('c', 'Cc'); // Chu-Chu or similar enemy
        this.nameToFolderMap.set('keeth', 'Kb'); // Keeth -> Kb (Keese Bird)
        this.nameToFolderMap.set('kani', 'Kanat'); // Crab -> Kanat
        this.nameToFolderMap.set('Throck', 'Bo'); // Bomb rock
        
        // ITat objects
        this.nameToFolderMap.set('ITat00', 'Itact');
        
        // Hypoi objects
        this.nameToFolderMap.set('HyoiKam', 'Vhyoi');
        
        // AND_SW variants (switches)
        this.nameToFolderMap.set('AND_SW2', 'Bmsw');
        
        // Akabe (red switch blocks)
        this.nameToFolderMap.set('Akabe', 'Bjd'); // or another mapping
        
        // These are abstract/tag objects with no visual models
        const noModelObjects = [
            'TagSo', 'TagMSo', 'NpcSo', 'TagEv', 'TagKb', 'TagMsg', 'TagMsg2',
            'TagHt', 'TagEv2', 'AttTag', 'ky_tag1', 'ky_tag2', 'ky_tag3', 'ky_tag4',
            'ky_tag5', 'ky_tag6', 'ky_tag7', 'kytag00', 'kytag01', 'kytag02',
            'kytag03', 'kytag04', 'kytag05', 'kytag06', 'kytag07',
            'Com_A', 'Com_B', 'Com_C', 'Com_D', 'Com_G',
            'SW', 'SW_00', 'SW_A00', 'SW_A01', 'SW_B00', 'SW_C00', 'SW_D00',
            'SwSlvg', 'MhmrSW0', 'MhmrSW1', 'MjFlag',
            'Warpmj', 'WarpGn', 'WarpOb',
            'Pirates',
            'nezuana', // Hole/warp
            'Gaship1', 'Gaship2', // Ship tags
            'Ocanon', // Cannon tag
            'moZOU', // Tag
            'Bitem', // Item tag
            'SMBdor', // Door tag
            'bonbori', // Lantern tag
            'FgTrap', // Trap tag
            'Puti', // Tag
        ];
        for (const obj of noModelObjects) {
            this.nameToFolderMap.set(obj, null!); // null = no model
        }
    }
    
    /**
     * Get the Object folder name for a given object name from a DZS file.
     * @param objectName The object name from the DZS (e.g., "agbF", "KNOB00", "Ah")
     * @returns The Object folder name (e.g., "Agb", "Knob", "Ah"), or null if no model exists
     */
    public getFolderName(objectName: string): string | null {
        // Check if we have an explicit mapping
        if (this.nameToFolderMap.has(objectName)) {
            return this.nameToFolderMap.get(objectName) || null;
        }
        
        // Default: assume the object name is the folder name (most objects work this way)
        return objectName;
    }
    
    /**
     * Check if an object is known to have no visual model (tags, triggers, etc.)
     */
    public hasNoModel(objectName: string): boolean {
        return this.nameToFolderMap.has(objectName) && this.nameToFolderMap.get(objectName) === null;
    }
}
