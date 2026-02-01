import './style.css';
import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { Water } from 'three/addons/objects/Water.js';
import GUI from 'lil-gui';

// Post-Processing Imports
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// --- WATER & RIVER GLOBALS ---
let water, waterfall, waterfall2, foamSystem, foamUniforms, mistSystem, mistUniforms;
let rocks = [];
const riverParams = {
    speed: 0.7,
    waveHeight: 0.33,
    flowAngle: 0,
    foamAmount: 9000, 
    foamSize: 0.3,
    waterHeight: 30.5,
    waterX: 2,
    waterZ: -1.2,
    width: 11.5,
    length: 100,
    waterfallDrop: 30
};

const foamVertexShader = `
    attribute float life;
    attribute float offset;
    uniform float time;
    uniform float size;
    varying float vLife;
    varying float vOffset;

    void main() {
        vLife = life;
        vOffset = offset;
        vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
        gl_Position = projectionMatrix * mvPosition;

        // Base Size * Pulse * Life Fade * Perspective Scale
        float pulse = 1.0 + 0.3 * sin(time * 10.0 + offset);
        gl_PointSize = size * pulse * vLife * ( 300.0 / -mvPosition.z );
    }
`;

const foamFragmentShader = `
    uniform vec3 color;
    uniform sampler2D map;
    uniform float time;
    varying float vLife;
    varying float vOffset;

    void main() {
        vec4 texColor = texture2D( map, gl_PointCoord );
        if (texColor.a < 0.01) discard;

        // Flicker
        float flicker = 0.7 + 0.3 * sin(time * 20.0 + vOffset * 10.0);
        float alpha = texColor.a * vLife * flicker;

        gl_FragColor = vec4( color, alpha );
    }
`;

// Setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xa0a0a0);
scene.fog = new THREE.FogExp2(0xebe2db, 0.005); // Add soft fog for depth

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 0.5, 1.5); // Closer to the small character

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace; // Important for correct color rendering
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0; // Brighter scene
document.body.appendChild(renderer.domElement);

// Crosshair (Removed)
/*
const crosshair = document.createElement('div');
crosshair.style.position = 'absolute';
crosshair.style.top = '50%';
crosshair.style.left = '50%';
crosshair.style.width = '6px';
crosshair.style.height = '6px';
crosshair.style.background = 'white';
crosshair.style.borderRadius = '50%';
crosshair.style.transform = 'translate(-50%, -50%)';
crosshair.style.pointerEvents = 'none';
crosshair.style.zIndex = '1000';
document.body.appendChild(crosshair);
*/

// --- Post-Processing Setup (SSAO) ---
const composer = new EffectComposer(renderer);

const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);

// SSAO Removed for cleaner look
// const ssaoPass = new SSAOPass(scene, camera, window.innerWidth, window.innerHeight);
// ...
// composer.addPass(ssaoPass);

const outputPass = new OutputPass();
composer.addPass(outputPass);

// Controls
const controls = new PointerLockControls(camera, document.body);

// Click to lock
document.addEventListener('click', (event) => {
    // Prevent locking if clicking on the GUI
    if (event.target.closest('.lil-gui')) return;
    controls.lock();
});

// Lights
const ambientLight = new THREE.AmbientLight(0xffffff, 0.2); // Soft white ambient
scene.add(ambientLight);

// Hemisphere Light - Simulating Sky and Ground bounce
// Less blue, more neutral/white sky, and warmer ground bounce for better outdoor feel
const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0); 
hemiLight.position.set(0, 20, 0);
scene.add(hemiLight);

const dirLight = new THREE.DirectionalLight(0xffdfba, 4.0); // Brighter Warm Sun
dirLight.position.set(5, 15, 5);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 4096; // Higher resolution shadows
dirLight.shadow.mapSize.height = 4096;
dirLight.shadow.bias = -0.00005; // Finely tuned bias
dirLight.shadow.normalBias = 0.05; // Helps significantly with self-shadowing acne
const d = 50; // Larger shadow area to cover trees
dirLight.shadow.camera.left = -d;
dirLight.shadow.camera.right = d;
dirLight.shadow.camera.top = d;
dirLight.shadow.camera.bottom = -d;
dirLight.shadow.camera.far = 100;
scene.add(dirLight);

// --- Sky & Sun ---
const sky = new Sky();
sky.scale.setScalar(450000);
scene.add(sky);

// Removed GridHelper

const sun = new THREE.Vector3();

const effectController = {
    turbidity: 1, // Lower turbidity = cleaner, sharper sky
    rayleigh: 1.2, // Lower rayleigh = deeper blue/violet
    mieCoefficient: 0.05,
    mieDirectionalG: 0.9,
    elevation: 15, // Lower sun = Golden Hour
    azimuth: 180,
    exposure: renderer.toneMappingExposure
};

const uniforms = sky.material.uniforms;
uniforms[ 'turbidity' ].value = effectController.turbidity;
uniforms[ 'rayleigh' ].value = effectController.rayleigh;
uniforms[ 'mieCoefficient' ].value = effectController.mieCoefficient;
uniforms[ 'mieDirectionalG' ].value = effectController.mieDirectionalG;

const phi = THREE.MathUtils.degToRad( 90 - effectController.elevation );
const theta = THREE.MathUtils.degToRad( effectController.azimuth );

sun.setFromSphericalCoords( 1, phi, theta );

uniforms[ 'sunPosition' ].value.copy( sun );

// Match direction light to sun position for consistent shadows
dirLight.position.copy(sun).multiplyScalar(50); // Move light far out

// --- HDRI / IBL Environment ---
// Use the Procedural Sky we created to light the scene massively improving realism.
// The armor will now reflect the sky and sun.
const pmremGenerator = new THREE.PMREMGenerator(renderer);
const renderTarget = pmremGenerator.fromScene(scene);
scene.environment = renderTarget.texture;

// --- WATER SETUP ---
const waterGeometry = new THREE.PlaneGeometry( 9, 60, 60, 100 ); // Hardcoded base size to match scaling logic
water = new Water(
    waterGeometry,
    {
        textureWidth: 512,
        textureHeight: 512,
        waterNormals: new THREE.TextureLoader().load( 'https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/waternormals.jpg', function ( texture ) {
            texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        } ),
        sunDirection: new THREE.Vector3(),
        sunColor: 0xffffff,
        waterColor: 0x003344,
        distortionScale: 3.7,
        fog: scene.fog !== undefined
    }
);
water.rotation.x = - Math.PI / 2;
water.position.y = riverParams.waterHeight;
scene.add( water );
water.material.uniforms[ 'sunDirection' ].value.copy( sun ).normalize();
updateWaterScale(); // Apply initial scale based on riverParams

if (rocks.length > 0) {
    updateRiverHeight(); // Ensure any existing/new markers snap to water height
}

// Foam Markers
createFoamMarker(4.56, 18.45, 0.5);
createFoamMarker(6.03, 19.13, 0.5);
createFoamMarker(5.99, 19.00, 0.5);
createFoamMarker(6.02, 18.16, 0.5);
createFoamMarker(4.72, 18.76, 0.5);
createFoamMarker(5.40, 17.64, 0.5);
createFoamMarker(4.88, 24.58, 0.5);
createFoamMarker(5.55, 24.92, 0.5);
createFoamMarker(3.88, 27.29, 0.5);
createFoamMarker(5.87, 27.47, 0.5);
createFoamMarker(1.79, 35.16, 0.5);
createFoamMarker(1.99, 20.87, 0.5);
createFoamMarker(1.59, 21.58, 0.5);
createFoamMarker(2.62, 22.12, 0.5);
createFoamMarker(-1.73, -5.82, 0.5);
createFoamMarker(-2.54, -8.03, 0.5);
createFoamMarker(2.82, -23.49, 0.5);
createFoamMarker(1.35, -23.70, 0.5);
createFoamMarker(2.36, -24.79, 0.5);
createFoamMarker(-0.48, -1.48, 0.5);
createFoamMarker(-1.90, -3.28, 0.5);
createFoamMarker(-0.42, -3.34, 0.5);
createFoamMarker(-2.15, 0.22, 0.5);
createFoamMarker(4.46, 27.40, 0.5);
createFoamMarker(4.87, 27.69, 0.5);
createFoamMarker(2.03, 20.57, 0.5);
createFoamMarker(1.71, 20.48, 0.5);
createFoamMarker(1.79, 20.65, 0.5);
createFoamMarker(2.79, 21.93, 0.5);
createFoamMarker(2.01, 21.16, 0.5);
createFoamMarker(2.62, 21.11, 0.5);
createFoamMarker(1.32, 21.08, 0.5);
createFoamMarker(2.01, 20.29, 0.5);

// Foam
createFoamSystem();

// Waterfall and Mist
createWaterfall();
createMistSystem();

// --- GUI ---
const gui = new GUI();
gui.add( riverParams, 'speed', 0, 5 ).name('Flow Speed');
gui.add( riverParams, 'waveHeight', 0, 1 ).name('Wave Height');
gui.add( riverParams, 'flowAngle', -180, 180 ).name('Direction');

const folderFoam = gui.addFolder('Foam Settings');
folderFoam.add( riverParams, 'foamAmount', 0, 15000 ).name('Count').onChange( updateFoamCount );
folderFoam.add( riverParams, 'foamSize', 0.01, 2.0 ).name('Particle Size').onChange( (v) => {
    if(foamUniforms) foamUniforms.size.value = v;
});
folderFoam.open();

gui.add( riverParams, 'waterHeight', -20, 50 ).name('Water Y Level').onChange( updateRiverHeight );
gui.add( riverParams, 'waterX', -100, 100 ).name('Water X Pos').onChange( updateRiverHeight );
gui.add( riverParams, 'waterZ', -200, 200 ).name('Water Z Pos').onChange( updateRiverHeight );
gui.add( riverParams, 'width', 1, 300 ).name('Width').onChange( updateWaterScale );
gui.add( riverParams, 'length', 1, 1000 ).name('Length').onChange( updateWaterScale );
gui.add( riverParams, 'waterfallDrop', 5, 200 ).name('Waterfall H').onChange( updateRiverHeight ); // Update height triggers position recalc


// Create Simple Low Poly Clouds
function addClouds() {
    const geo = new THREE.DodecahedronGeometry(1, 0); // Low poly ball
    const mat = new THREE.MeshStandardMaterial({ 
        color: 0xffffff, 
        flatShading: true, 
        roughness: 0.3,  // Shinier clouds
        emissive: 0xffffee, // Slight glow
        emissiveIntensity: 0.1
    });
    
    // Create 20 random cloud clumps
    for (let i = 0; i < 30; i++) {
        const cloud = new THREE.Group();
        
        // Each cloud is made of 3-6 puffs
        const puffs = Math.floor(Math.random() * 4) + 3;
        for(let j=0; j<puffs; j++) {
            const mesh = new THREE.Mesh(geo, mat);
            // Random offset for each puff
            mesh.position.set(
                (Math.random() - 0.5) * 6,
                (Math.random() - 0.5) * 3,
                (Math.random() - 0.5) * 4
            );
            // Random size for each puff
            mesh.scale.setScalar(Math.random() * 2 + 3);
            
            mesh.castShadow = false; // Clouds don't need expensive shadows on ground often
            mesh.receiveShadow = true;
            cloud.add(mesh);
        }
        
        // Random Position in Sky
        // Spread wide (200x200 area) and high (30-60 height)
        cloud.position.set(
            (Math.random() - 0.5) * 400,
            Math.random() * 30 + 30, 
            (Math.random() - 0.5) * 400
        );
        
        scene.add(cloud);
    }
}
addClouds();

// Animation variables
let mixer;
let envMixer;
let terrain;
let player;
const clock = new THREE.Clock();

// Input State
const keys = {
    w: false,
    a: false,
    s: false,
    d: false,
    shift: false,
    space: false
};

const actions = {
    idle: null,
    walk: null,
    run: null,
    strafe_left: null,
    strafe_right: null,
    jump: null
};

let activeAction = null;
let verticalVelocity = 0;
let isGrounded = true;
let lastGroundHeight = 0;

document.addEventListener('keydown', (event) => {
    switch(event.key.toLowerCase()) {
        case 'w': keys.w = true; break;
        case 'a': keys.a = true; break;
        case 's': keys.s = true; break;
        case 'd': keys.d = true; break;
        case 'shift': keys.shift = true; break;
        case ' ': keys.space = true; break;
        // case 'p': placeFoamEmitter(); break;
    }
});

/*
function placeFoamEmitter() {
    // 1. Raycast from Camera Center
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2(0, 0), camera);
    
    // 2. Intersect Water
    const intersects = rc.intersectObject(water, false);
    
    if (intersects.length > 0) {
        const p = intersects[0].point;
        console.log(`Foam Emitter Added: { x: ${p.x.toFixed(2)}, z: ${p.z.toFixed(2)} }`);
        console.log(`Copy/Paste Code: createFoamMarker(${p.x.toFixed(2)}, ${p.z.toFixed(2)}, 0.5);`);
        
        createFoamMarker(p.x, p.z, 0.5);
    }
}
*/

document.addEventListener('keyup', (event) => {
    switch(event.key.toLowerCase()) {
        case 'w': keys.w = false; break;
        case 'a': keys.a = false; break;
        case 's': keys.s = false; break;
        case 'd': keys.d = false; break;
        case 'shift': keys.shift = false; break;
        case ' ': keys.space = false; break;
    }
});

// Loaders
const gltfLoader = new GLTFLoader();
const fbxLoader = new FBXLoader();

// Load Environment (Book)
// Note: We need to see how big the book is. Maybe we need to scale it up.
gltfLoader.load('/models/medieval_fantasy_book.glb', (gltf) => {
    const model = gltf.scene;
    // model.scale.set(10, 10, 10); // Books are usually small, so scale up to be a "land"

    
    // Auto-center and get size to determine scale
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    
    // Scale up if it's too small (assuming we want a walkable area of ~20 units)
    const maxDim = Math.max(size.x, size.y, size.z);
    
    // --- CHANGE HERE ---
    // Target Size: How big do you want the land to be?
    // If the character is 1.8 units tall, a decent small "level" is 100-200 units.
    const targetSize = 150;

    let scaleFactor = 1;
    // We remove the "if (maxDim < 20)" check and just enforce the target size
    // This ensures the book is ALWAYS 150 units wide, regardless of its original size.
    scaleFactor = targetSize / maxDim;
    
    model.scale.set(scaleFactor, scaleFactor, scaleFactor);
    // -------------------
    
    // 2. Update Box AFTER scaling to get correct world dimensions
    model.updateMatrixWorld(true);
    box.setFromObject(model);
    
    const newCenter = box.getCenter(new THREE.Vector3());
    
    // 3. Center X and Z, but put Bottom (min.y) at 0
    model.position.x = -newCenter.x;
    model.position.z = -newCenter.z;
    model.position.y = -box.min.y;

    model.traverse((child) => {
        if (child.isMesh) {
            child.receiveShadow = true;
            child.castShadow = true;
        }
    });

    // Removed Debug Helpers
    
    scene.add(model);
    terrain = model;

    // Check for environment animations (Windmill, Water, etc.)
    if (gltf.animations && gltf.animations.length > 0) {
        envMixer = new THREE.AnimationMixer(model);
        gltf.animations.forEach((clip) => {
            envMixer.clipAction(clip).play();
        });
    }

}, undefined, (error) => {
    console.error('An error occurred loading the book:', error);
});

// Load Character and Animation
// Replaced Fisherman GLB with Paladin FBX
fbxLoader.load('/models/Pro Sword and Shield Pack (1)/Paladin WProp J Nordstrom.fbx', (character) => {
    
    // FBX usually defaults to centimeters, so scale might need adjustment (0.01).
    // Increased from 0.013 to 0.015 for a little bigger character
    character.scale.set(0.015, 0.015, 0.015); 
    
    // Spawn high up to ensure Raycast snaps down correctly (avoids getting stuck below ground)
    character.position.set(0, 50, 0); // Explicitly set X, Y, Z to be sure 

    character.traverse((child) => {
        if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
        }
    });

    scene.add(character);
    player = character;

    mixer = new THREE.AnimationMixer(character);

    // Load Animations
    const animLoader = new FBXLoader();
    animLoader.setPath('/models/Pro Sword and Shield Pack (1)/');

    // Helper to load animation
    const loadAnim = (fileName, name) => {
        animLoader.load(fileName, (anim) => {
            const clip = anim.animations[0];

            // --- Code Fix: Force "In Place" Animation ---
            // Only necessary for moving animations like walk/run
            if (name === 'walk' || name === 'run' || name === 'jump' || name.includes('strafe')) {
                clip.tracks.forEach(track => {
                    // Look for position tracks on the Root/Hips
                    // (Matches "mixamorig:Hips.position", "J_Bip_C_Hips.position", etc.)
                    if (track.name.match(/\.position/i) && track.name.match(/hips|root|pelvis/i)) {
                        const values = track.values;
                        // Get starting position (frame 0)
                        const startX = values[0];
                        const startZ = values[2];

                        // Overwrite X and Z values for all frames to lock character in place
                        // We keep Y (index i+1) so the hips still bob up and down
                        for (let i = 0; i < values.length; i += 3) {
                            values[i] = startX;     // Lock X
                            values[i+2] = startZ;   // Lock Z
                        }
                    }
                });
            }

            const action = mixer.clipAction(clip);
            actions[name] = action;

            if (name === 'jump') {
                action.setLoop(THREE.LoopOnce); // Jump should play once
                action.clampWhenFinished = true;
            }
            
            if (name === 'idle') {
                action.play();
                activeAction = action;
            }
        });
    };

    loadAnim('sword and shield idle.fbx', 'idle');
    loadAnim('sword and shield walk.fbx', 'walk');
    loadAnim('sword and shield run.fbx', 'run');
    loadAnim('sword and shield jump.fbx', 'jump');
    loadAnim('sword and shield strafe.fbx', 'strafe_right');     // Assuming 1 is right
    loadAnim('sword and shield strafe (2).fbx', 'strafe_left');  // Assuming 2 is left

}, undefined, (error) => {
    console.error('An error occurred loading the character:', error);
});

/*
// Old FBX Loading Code
// const characterPath = '/models/Pro Sword and Shield Pack/Paladin WProp J Nordstrom.fbx'; // If you fix the version of this file
// // const characterPath = '/models/Paladin.fbx'; // If you export a new file from Blender
//
// fbxLoader.load(characterPath, (character) => {
//     // Determine scale. FBX often needs 0.01 if units are cms.
//     character.scale.set(0.01, 0.01, 0.01);
//    
//     character.traverse((child) => {
//         if (child.isMesh) {
//             child.castShadow = true;
//             child.receiveShadow = true;
//         }
//     });
//
//     scene.add(character);
//
//     mixer = new THREE.AnimationMixer(character);
//
//     // Load Animation
//     // Make sure to convert this file too if it is old!
//     fbxLoader.load('/models/Pro Sword and Shield Pack/sword and shield run.fbx', (anim) => {
//         if (anim.animations.length > 0) {
//             const action = mixer.clipAction(anim.animations[0]);
//             action.play();
//         } else {
//             console.warn("No animations found in run file");
//         }
//     }, undefined, (e) => console.error("Error loading animation:", e));
//
// }, undefined, (error) => {
//     console.error('An error occurred loading the character:', error);
// });
*/

// Window resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight); // Update Composer
});

// Animation Loop
const raycaster = new THREE.Raycaster();
const downVector = new THREE.Vector3(0, -1, 0);

function animate() {
    requestAnimationFrame(animate);
    
    // Update Water System (from water.html)
    updateWater(performance.now() * 0.001);

    const delta = clock.getDelta();
    if (mixer) mixer.update(delta);
    if (envMixer) envMixer.update(delta);

    // Gravity / Ground Snapping
    if (player && terrain) {
        
        // Update Light (Shadow Camera Only) - Direction is fixed by Sun now
        // We keep the shadow camera following the player, but direction comes from the sun logic above
        dirLight.position.x = player.position.x + sun.x * 20;
        dirLight.position.y = player.position.y + sun.y * 20;
        dirLight.position.z = player.position.z + sun.z * 20;
        
        dirLight.target.position.copy(player.position);
        dirLight.target.updateMatrixWorld();

        // Store position before movement to allow collision reversion
        const oldPosition = player.position.clone();
        
        // Find ground height under current position (before moving) to know "Old Ground Height"
        let oldGroundHeight = player.position.y;
        
        // FIX: Raycast from just above player's head (e.g. +2.0) instead of sky (200)
        // lowered to 0.8 to avoid detecting roofs as floor
        const rayStartHeight = 0.8; 
        raycaster.set(new THREE.Vector3(player.position.x, player.position.y + rayStartHeight, player.position.z), downVector);
        
        let intersects = raycaster.intersectObject(terrain, true);
        if (intersects.length > 0) {
            oldGroundHeight = intersects[0].point.y;
        }

        // 2. Control Application
        if (controls.isLocked) {
           // Get the direction the camera is looking (horizontal only)
           const cameraForward = new THREE.Vector3();
           camera.getWorldDirection(cameraForward);
           cameraForward.y = 0;
           cameraForward.normalize();
           
           // Calculate Camera Angle (Base Rotation)
           let camAngle = 0;
           if (cameraForward.length() > 0) {
               camAngle = Math.atan2(cameraForward.x, cameraForward.z);
           }
           
           // --- Movement & Animation Logic ---
           const isMoving = keys.w || keys.a || keys.s || keys.d;
           const isRunning = keys.shift && isMoving;
           
           // Determine Input Rotation Offset (WASD)
           // W = 0, A = 90, S = 180, D = -90
           let inputAngle = 0;
           if (isMoving) {
               // Calculate input vector (z is forward here for atan2 calculation purposes)
               // Forward (W) -> 1, Backward (S) -> -1
               // Left (A) -> 1, Right (D) -> -1
               const z = Number(keys.w) - Number(keys.s);
               const x = Number(keys.a) - Number(keys.d);
               inputAngle = Math.atan2(x, z); 
           }

           // Apply Rotation: Camera Angle + Input Angle
           // Smoothly rotate towards the target angle
           const targetRotation = camAngle + inputAngle;
           const targetQuaternion = new THREE.Quaternion();
           targetQuaternion.setFromEuler(new THREE.Euler(0, targetRotation, 0));
           
           if (!player.quaternion.equals(targetQuaternion)) {
               // 10.0 is the rotation speed. Higher = snappier, Lower = smoother / heavier
               player.quaternion.slerp(targetQuaternion, 10.0 * delta);
           }
           
           // Jump Input
           if (keys.space && isGrounded) {
               verticalVelocity = 8.0; // Jump force
               isGrounded = false;
               
               // Play jump anim
               if (actions.jump) {
                   activeAction.fadeOut(0.1);
                   actions.jump.reset().fadeIn(0.1).play();
                   activeAction = actions.jump;
               }
           }
           
           // Gravity
           verticalVelocity -= 20.0 * delta; // Gravity scale
           player.position.y += verticalVelocity * delta;

           // Determine Animation & Speed
           let targetActionName = 'idle';
           let moveSpeed = 0;
           
           // calculate speed
           if (isMoving) {
                // If moving, we are ALWAYS facing "Forward" relative to our movement now.
                // So checking keys.s doesn't mean "backward" animation anymore, it means "Turn around and run forward".
                // Exception: If you want S to still be "Backpedal" you need different logic.
                // But you asked for "Rotate character like GTA", which means S turns you around.
                
                // Uniform speed for now (or sprint)
                moveSpeed = isRunning ? 10.0 : 4.0;
                targetActionName = isRunning ? 'run' : 'walk';
           }
           
           if (!isGrounded && activeAction === actions.jump) {
               targetActionName = 'jump';
           } 
           
           // Apply Movement Physics (Always Forward along Player Z)
           if (isMoving) {
                // We rotated the player to face the travel direction.
                // Now we just move "Forward" in local space.
                const worldMoveDir = new THREE.Vector3(0, 0, 1).applyQuaternion(player.quaternion);
                
                // Wall Collision Check (Enhanced with Whiskers)
                let blocked = false;
                
                // We check 3 rays: Center, Left, and Right to handle character width
                const origins = [];
                const pPos = player.position.clone();
                pPos.y += 0.8; // Raised check to chest/head level (avoids small steps)

                // Calculate perpendicular offset for side rays
                // worldMoveDir is (0,0,1) rotated by Quat. We need local X axis.
                const localRight = new THREE.Vector3(1, 0, 0).applyQuaternion(player.quaternion);
                const widthRadius = 0.4; // Detection width

                origins.push(pPos); // Center
                origins.push(pPos.clone().addScaledVector(localRight, widthRadius));  // Right Whisker
                origins.push(pPos.clone().addScaledVector(localRight, -widthRadius)); // Left Whisker

                // Also check Knee level for low obstacles if jumping is involved, 
                // but for now chest level prevents walking into walls.
                
                // Increase check distance slightly to stop before visual clipping
                // 0.8 was too close. 1.0 or 1.2 is safer for this scale.
                const checkDist = 1.1; 

                for (let o of origins) {
                    raycaster.set(o, worldMoveDir);
                    const wallIntersects = raycaster.intersectObject(terrain, true);
                    if (wallIntersects.length > 0 && wallIntersects[0].distance < checkDist) {
                        blocked = true;
                        break;
                    }
                }

                if (!blocked) {
                    // Move in world space based on the calculated direction
                    player.position.addScaledVector(worldMoveDir, moveSpeed * delta);
                }
           }

           // Handle Animation Crossfade (Only if we aren't already jumping/locked)
           // If we land, we switch back.
           if (targetActionName !== 'jump' && actions.jump && activeAction === actions.jump && !isGrounded) {
               // Doing nothing, let jump finish or fall
           } else {
               const targetAction = actions[targetActionName];
               
               // If run/strafe speed up
               if (targetActionName.includes('strafe') && isRunning) {
                   targetAction.timeScale = 2.0;
               } else if (targetAction) {
                   targetAction.timeScale = 1.0;
               }

               if (targetAction && activeAction !== targetAction) {
                   if (activeAction) activeAction.fadeOut(0.2);
                   targetAction.reset().fadeIn(0.2).play();
                   activeAction = targetAction;
               }
           }

           // --- End Movement Logic ---
           
           // Move Camera Pivot Position
           // PointerLockControls rotates the camera purely. 
           // We need to orbit the camera position around the player based on that rotation.
           
           const camDist = 3.5;
           const camHeight = 1.5;

           const camDir = new THREE.Vector3();
           camera.getWorldDirection(camDir);
           camDir.multiplyScalar(-camDist); // Backwards from look direction
           
           // Snap camera to player + offset
           camera.position.copy(player.position);
           camera.position.add(camDir);
           camera.position.y += camHeight;

              // Clamp camera below-ground without raycast (always applied)
              // Keep camera from dropping more than this below the player’s ground height
              const camMinBelowGround = 0.3;
              const minCamY = player.position.y - camMinBelowGround;
              if (camera.position.y < minCamY) camera.position.y = minCamY;
        }

        // Raycast AFTER movement to ensure we snap to the correct ground height for the NEW position
        // FIX: Raycast from just above player (e.g. +2.0) instead of sky (200)
        // Lowered to 0.8
        const rayOrigin = player.position.clone();
        rayOrigin.y += 0.8; 
        
        raycaster.set(rayOrigin, downVector);
        
        // Check intersection with terrain
        intersects = raycaster.intersectObject(terrain, true);
        
        if (intersects.length > 0) {
            const newGroundHeight = intersects[0].point.y;
            lastGroundHeight = newGroundHeight;
            const heightDiff = newGroundHeight - oldGroundHeight;

            // "Don't Climb Props" Logic:
            // Check delta from OLD ground height. 
            // If the ground under our feet spiked up > 0.5m, it is a wall (Collision).
            
            // FIX: If we are JUMPING (player.y > newGroundHeight), ignore the wall check!
            // We only collide if our *feet* are below the new platform level.
            const isClearingObstacle = player.position.y > newGroundHeight;

            // X/Z Revert Logic:
            if (heightDiff > 0.5 && !isClearingObstacle) {
                 // Revert X/Z ONLY. Keep Y (gravity needs to work).
                player.position.x = oldPosition.x;
                player.position.z = oldPosition.z;
                
                // Re-raycast at reverted position to ensure we land on valid ground
                // Lowered from 200 to oldPosition + 0.8
                raycaster.set(new THREE.Vector3(player.position.x, oldPosition.y + 0.8, player.position.z), downVector);
                const wallIntersects = raycaster.intersectObject(terrain, true);
                if (wallIntersects.length > 0) {
                     const validGround = wallIntersects[0].point.y;
                     // Physics Landing Logic
                     if (player.position.y <= validGround + 0.1 && verticalVelocity <= 0) {
                        player.position.y = validGround + 0.1;
                        verticalVelocity = 0;
                        isGrounded = true;
                     } else {
                        isGrounded = false;
                     }
                }
            } else {
                // No wall collision. Valid ground logic.
                // If player feet are below ground, SNAP.
                if (player.position.y <= newGroundHeight + 0.1) {
                    // Only snap if we are falling or barely moving up
                    if (verticalVelocity <= 0) {
                        player.position.y = newGroundHeight + 0.1;
                        verticalVelocity = 0;
                        isGrounded = true;
                    }
                } else {
                    isGrounded = false;
                }
            }
            
            // Emergency Escape (Spawn/Fall through world)
             if (player.position.y < -10) {
                 player.position.y = newGroundHeight + 0.1;
                 verticalVelocity = 0;
                 isGrounded = true;
             }
        }

        // Clamp camera below-ground without extra raycasts
        // Allow a small dip below last known ground to avoid harsh snapping
        const camMinBelowGround = 0.3;
        const minCamY = lastGroundHeight - camMinBelowGround;
        if (camera.position.y < minCamY) camera.position.y = minCamY;
    }
    
    composer.render(); // Use Composer for Post-Processing
}
animate();

// --- WATER IMPLEMENTATION FUNCTIONS ---

function createRock(x, z, radius) {
    const geometry = new THREE.IcosahedronGeometry( radius, 1 );
    const material = new THREE.MeshStandardMaterial( { color: 0x111111, roughness: 0.6, flatShading: true } );
    const mesh = new THREE.Mesh( geometry, material );
    mesh.position.set( x, -0.8, z );
    mesh.rotation.set(Math.random(), Math.random(), Math.random());
    mesh.scale.set(1.3, 0.7, 1.1);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add( mesh );
    rocks.push({ x: x, z: z, radius: radius * 1.5, mesh: mesh });
}

function createFoamMarker(x, z, radius) {
    // Convert World Coordinates (Input) to Water-Relative Coordinates
    // This ensures that even if water is moved, the logic remains consistent
    const relX = x - riverParams.waterX;
    const relZ = z - riverParams.waterZ;

    // Debug Visual (Red Wireframe Sphere)
    const geometry = new THREE.SphereGeometry(radius, 8, 8);
    const material = new THREE.MeshBasicMaterial({ color: 0xff0000, wireframe: true });
    const mesh = new THREE.Mesh(geometry, material);
    
    // Position mesh in World Space initially
    mesh.position.set(x, riverParams.waterHeight, z);
    scene.add(mesh);
    
    // Store Relative coordinates in rocks array
    rocks.push({ x: relX, z: relZ, radius: radius, mesh: mesh });
}

function updateRiverHeight() {
    if (water) {
        water.position.y = riverParams.waterHeight;
        water.position.x = riverParams.waterX;
        water.position.z = riverParams.waterZ;
    }
    if (foamSystem) {
        foamSystem.position.y = riverParams.waterHeight;
        foamSystem.position.x = riverParams.waterX;
        foamSystem.position.z = riverParams.waterZ;
    }
    if (waterfall) {
        // Position waterfall at the "downstream" end (Z- direction from center)
        // Length flows along Z. So edge is at waterZ - length/2
        waterfall.position.x = riverParams.waterX;
        waterfall.position.y = riverParams.waterHeight - (riverParams.waterfallDrop / 2);
        waterfall.position.z = riverParams.waterZ + (riverParams.length / 2); 
    }
    if (waterfall2) {
        waterfall2.position.x = riverParams.waterX;
        waterfall2.position.y = riverParams.waterHeight - (riverParams.waterfallDrop / 2);
        waterfall2.position.z = riverParams.waterZ - (riverParams.length / 2); 
    }
    if (mistSystem) {
        mistSystem.position.x = riverParams.waterX;
        mistSystem.position.y = riverParams.waterHeight;
        mistSystem.position.z = riverParams.waterZ; // Center it
    }
    rocks.forEach(rock => {
        if (rock.mesh) {
             rock.mesh.position.y = riverParams.waterHeight - 0.8;
             rock.mesh.position.x = riverParams.waterX + rock.x;
             rock.mesh.position.z = riverParams.waterZ + rock.z;
        }
    });
}

function updateWaterScale() {
   if(water) {
       // Scale relative to initial geometry dimensions (Width: 9, Length: 60)
       // This ensures visual size matches the slider value
       water.scale.set(
           riverParams.width / 9,  
           riverParams.length / 60, 
           1
       );
   }
   if (waterfall) {
       // Scale Width to match river
       // Scale Height (Y) to match drop parameter (relative to initial 30)
       waterfall.scale.set(
           riverParams.width / 9,
           riverParams.waterfallDrop / 30,
           1
       );
   }
   if (waterfall2) {
       waterfall2.scale.set(
           riverParams.width / 9,
           riverParams.waterfallDrop / 30,
           1
       );
   }
   // Also need to move waterfall/mist because "Length" changed the edge position
   updateRiverHeight();
}

function createWaterfall() {
    // Initial height matches waterfalldrop param (30)
    const geometry = new THREE.PlaneGeometry(9, 30, 10, 10);
    waterfall = new Water(geometry, {
        textureWidth: 512,
        textureHeight: 512,
        waterNormals: new THREE.TextureLoader().load('https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/waternormals.jpg', function ( texture ) {
            texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        }),
        sunDirection: new THREE.Vector3(),
        sunColor: 0xffffff,
        waterColor: 0x004455, // Slightly different color
        distortionScale: 3.7,
        fog: scene.fog !== undefined
    });
    
    // Vertical Plane
    // Default is XY. We want it facing Z (since river flows to Z+ or Z-).
    // Let's face it towards +Z.
    // No rotation needed for XY plane to be vertical.
    
    scene.add(waterfall);
    
    // Create second waterfall for other end
    const geo2 = geometry.clone();
    waterfall2 = new Water(geo2, {
        textureWidth: 512,
        textureHeight: 512,
        waterNormals: new THREE.TextureLoader().load('https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/waternormals.jpg', function ( texture ) {
            texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        }),
        sunDirection: new THREE.Vector3(),
        sunColor: 0xffffff,
        waterColor: 0x004455,
        distortionScale: 3.7,
        fog: scene.fog !== undefined
    });
    waterfall2.rotation.y = Math.PI; // Face the other way
    scene.add(waterfall2);

    updateRiverHeight(); // Position it
    updateWaterScale();  // Scale it
}

function createMistSystem() {
    const canvas = document.createElement('canvas');
    canvas.width = 32; canvas.height = 32;
    const context = canvas.getContext('2d');
    const grad = context.createRadialGradient(16,16,0, 16,16,16);
    grad.addColorStop(0, 'rgba(255,255,255,0.8)'); // More opaque for "cloud" look
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = grad;
    context.fillRect(0,0,32,32);
    const texture = new THREE.CanvasTexture(canvas);

    const count = 5000; // More particles better density
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const lives = new Float32Array(count);
    const offsets = new Float32Array(count);

    for(let i=0; i<count; i++) {
        positions[i*3] = 0; positions[i*3+1] = -500; positions[i*3+2] = 0; // Hide initially
        lives[i] = Math.random();
        offsets[i] = Math.random() * 100;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('life', new THREE.BufferAttribute(lives, 1));
    geometry.setAttribute('offset', new THREE.BufferAttribute(offsets, 1));

    mistUniforms = {
        time: { value: 0 },
        size: { value: 6.0 }, // Much Huge particles to cover edge
        color: { value: new THREE.Color(0xffffff) },
        map: { value: texture }
    };

    const material = new THREE.ShaderMaterial({
        uniforms: mistUniforms,
        vertexShader: foamVertexShader, // Reuse foam shader
        fragmentShader: foamFragmentShader,
        transparent: true,
        depthWrite: false,
        blending: THREE.NormalBlending
    });

    mistSystem = new THREE.Points(geometry, material);
    scene.add(mistSystem);
    updateRiverHeight();
}

function createFoamSystem() {
    const canvas = document.createElement('canvas');
    canvas.width = 32; canvas.height = 32;
    const context = canvas.getContext('2d');
    const grad = context.createRadialGradient(16,16,0, 16,16,16);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = grad;
    context.fillRect(0,0,32,32);
    const texture = new THREE.CanvasTexture(canvas);

    const geometry = new THREE.BufferGeometry();
    const count = riverParams.foamAmount;
    
    const positions = new Float32Array(count * 3);
    const lives = new Float32Array(count);
    const offsets = new Float32Array(count);
    
    // Pre-calculate limits for seeding
    const currentWidth = riverParams.width;
    const currentLength = riverParams.length;
    const edgeLimit = currentWidth * 0.5;
    const lengthLimit = currentLength * 0.5;

    for(let i=0; i<count; i++) {
        // Pre-seed positions so foam appears immediately
        if(Math.random() < 0.6 && rocks.length > 0) {
            const rock = rocks[Math.floor(Math.random() * rocks.length)];
            const r = rock.radius + (Math.random() * 0.5);
            const a = Math.random() * Math.PI * 2;
            positions[i*3] = rock.x + Math.cos(a) * r; 
            positions[i*3+2] = rock.z + Math.sin(a) * r;
        } else {
            const side = Math.random() > 0.5 ? 1 : -1;
            const edgeX = (edgeLimit - 0.2) * side; 
            const edgeZ = (Math.random() * currentLength) - lengthLimit;
            positions[i*3] = edgeX + (Math.random() * 0.5 * -side); 
            positions[i*3+2] = edgeZ;
        }
        positions[i*3+1] = 0.05; // Initial relative height

        lives[i] = Math.random(); 
        offsets[i] = Math.random() * 100;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('life', new THREE.BufferAttribute(lives, 1));
    geometry.setAttribute('offset', new THREE.BufferAttribute(offsets, 1));

    foamUniforms = {
        time: { value: 0 },
        size: { value: riverParams.foamSize }, // Use current param value
        color: { value: new THREE.Color( 0xffffff ) },
        map: { value: texture }
    };

    const material = new THREE.ShaderMaterial({
        uniforms: foamUniforms,
        vertexShader: foamVertexShader,
        fragmentShader: foamFragmentShader,
        transparent: true,
        depthWrite: false,
        blending: THREE.NormalBlending
    });

    foamSystem = new THREE.Points(geometry, material);
    // Ensure position matches current water params
    foamSystem.position.set(riverParams.waterX, riverParams.waterHeight, riverParams.waterZ);
    scene.add(foamSystem);
}

function updateFoamCount() {
    scene.remove(foamSystem);
    createFoamSystem();
}

function getWaveHeight(x, z, time, dirX, dirY) {
    const flowDist  = (x * dirX) + (z * dirY);
    const crossDist = (x * dirY) - (z * dirX);
    
    let h = 0;
    h += Math.sin( flowDist * 0.8 + time * riverParams.speed ) * 0.5;
    h += Math.sin( flowDist * 1.5 + crossDist * 1.2 + time * riverParams.speed * 1.2 ) * 0.3;
    h += Math.sin( flowDist * 3.0 + time * riverParams.speed * 2.0 ) * 0.1;
    return h * riverParams.waveHeight;
}

function updateWater(time) {
    const rad = THREE.MathUtils.degToRad( riverParams.flowAngle );
    const dirX = Math.sin( rad );
    const dirY = Math.cos( rad );

    // 1. UPDATE WATER
    if (water) {
        const position = water.geometry.attributes.position;
        for ( let i = 0; i < position.count; i ++ ) {
            const x = position.getX( i );
            const y = position.getY( i ); 
            let h = getWaveHeight(x, y, time, dirX, dirY);
            // Rock push
            for(let r=0; r<rocks.length; r++) {
                const dx = x - rocks[r].x;
                const dy = y - rocks[r].z;
                const dist = Math.sqrt(dx*dx + dy*dy);
                if( dist < rocks[r].radius * 2.5 ) {
                    h += (1.0 - (dist / (rocks[r].radius * 2.5))) * 0.6;
                }
            }
            position.setZ( i, h );
        }
        water.geometry.attributes.position.needsUpdate = true;
        water.geometry.computeVertexNormals();
        
        water.material.uniforms[ 'time' ].value += 1.0 / 60.0;
    }

    // 2. UPDATE FOAM
    if(foamSystem) {
        foamSystem.material.uniforms.time.value = time;
        const positions = foamSystem.geometry.attributes.position.array;
        const lives = foamSystem.geometry.attributes.life.array;
        const offsets = foamSystem.geometry.attributes.offset.array;
        
        // Dynamic Edge Limits based on current Width/Length
        const currentWidth = riverParams.width;
        const currentLength = riverParams.length;
        const edgeLimit = currentWidth * 0.5;
        const lengthLimit = currentLength * 0.5;

        for(let i=0; i<riverParams.foamAmount; i++) {
            
            lives[i] -= 0.01 * riverParams.speed;

            if(lives[i] <= 0) {
                // Respawn
                lives[i] = 1.0;
                
                let spawnedOnPlayer = false;
                if (player) {
                    const pRelX = player.position.x - riverParams.waterX;
                    const pRelZ = player.position.z - riverParams.waterZ;
                    
                    // Check if player is strictly within water bounds
                    if (Math.abs(pRelX) < edgeLimit && Math.abs(pRelZ) < lengthLimit) {
                        // Check height (feet roughly around water level)
                        if (Math.abs(player.position.y - riverParams.waterHeight) < 2.5) {
                            if (Math.random() < 0.08) { // 8% chance (Reduced to avoid being too much)
                                spawnedOnPlayer = true;
                                const r = 0.3 + Math.random() * 0.5; // Tighter radius
                                const a = Math.random() * Math.PI * 2;
                                positions[i*3] = pRelX + Math.cos(a) * r;
                                positions[i*3+2] = pRelZ + Math.sin(a) * r;
                            }
                        }
                    }
                }

                if (!spawnedOnPlayer) {
                    if(Math.random() < 0.6 && rocks.length > 0) {
                        const rock = rocks[Math.floor(Math.random() * rocks.length)];
                        const r = rock.radius + (Math.random() * 0.5);
                        const a = Math.random() * Math.PI * 2;
                        positions[i*3] = rock.x + Math.cos(a) * r; 
                        positions[i*3+2] = rock.z + Math.sin(a) * r;
                    } else {
                        const side = Math.random() > 0.5 ? 1 : -1;
                        const edgeX = (edgeLimit - 0.2) * side; 
                        const edgeZ = (Math.random() * currentLength) - lengthLimit;
                        positions[i*3] = edgeX + (Math.random() * 0.5 * -side); 
                        positions[i*3+2] = edgeZ;
                    }
                }
            } else {
                // Move
                positions[i*3]   += dirX * 0.08 * riverParams.speed; 
                positions[i*3+2] += dirY * 0.08 * riverParams.speed; 
                const noise = Math.sin(time * 5 + offsets[i]) * 0.02; 
                positions[i*3]   += -dirY * noise; 
                positions[i*3+2] += dirX * noise;
            }
            
            // Lock to wave height
            const waterH = getWaveHeight(positions[i*3], positions[i*3+2], time, dirX, dirY);
            positions[i*3+1] = waterH + 0.05; 
        }
        
        foamSystem.geometry.attributes.position.needsUpdate = true;
        foamSystem.geometry.attributes.life.needsUpdate = true;
    }

    // 3. UPDATE MIST
    if (mistSystem) {
        mistSystem.material.uniforms.time.value = time;
        const positions = mistSystem.geometry.attributes.position.array;
        const lives = mistSystem.geometry.attributes.life.array;
        const offsets = mistSystem.geometry.attributes.offset.array;
        const count = positions.length / 3;
        
        const currentWidth = riverParams.width;
        const halfLength = riverParams.length / 2;

        for (let i = 0; i < count; i++) {
            lives[i] -= 0.015; // Fade slower (linger longer)
            
            if (lives[i] <= 0) {
                lives[i] = 1.0;
                // Respawn at TOP of waterfall (BOTH ENDS)
                const side = Math.random() > 0.5 ? 1 : -1;
                const zPos = halfLength * side;

                // Local X: Random(-width/2, width/2)
                // Local Y: Spread around the lip (slightly up and down)
                // Local Z: Spread thick around the edge (+/- 1.5 units)
                positions[i*3] = (Math.random() - 0.5) * currentWidth;
                positions[i*3+1] = (Math.random() * 1.5) - 0.5; 
                positions[i*3+2] = zPos + ((Math.random() - 0.5) * 3.0); 
            } else {
                // Fall Down Slower (Float like smoke)
                positions[i*3+1] -= 0.15; 
                
                // Expand outward slightly
                positions[i*3] += (Math.random() - 0.5) * 0.05;
            }
        }
        
        mistSystem.geometry.attributes.position.needsUpdate = true;
        mistSystem.geometry.attributes.life.needsUpdate = true;
    }

    // 4. UPDATE WATERFALL SHADER
    if (waterfall) {
         waterfall.material.uniforms['time'].value += 1.0 / 20.0; 
    }
    if (waterfall2) {
         waterfall2.material.uniforms['time'].value += 1.0 / 20.0; 
    }
}
