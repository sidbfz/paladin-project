import './style.css';
import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { Sky } from 'three/addons/objects/Sky.js';

// Post-Processing Imports
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

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
document.addEventListener('click', () => {
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
    }
});

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
    
    // 1. Determine Scale
    let scaleFactor = 1;
    if (maxDim < 20) {
        scaleFactor = 20 / maxDim;
        model.scale.set(scaleFactor, scaleFactor, scaleFactor);
    }
    
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
    character.scale.set(0.01, 0.01, 0.01); 
    
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
        // This allows us to walk UNDER roofs and bridges without detecting them as the floor.
        const rayStartHeight = 2.0; 
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
                moveSpeed = isRunning ? 6.0 : 2.0; 
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
                
                // Wall Collision Check (Frontal)
                let blocked = false;
                const wallRayOrigin = player.position.clone();
                wallRayOrigin.y += 0.5; 
                raycaster.set(wallRayOrigin, worldMoveDir);
                const wallIntersects = raycaster.intersectObject(terrain, true);
                if (wallIntersects.length > 0 && wallIntersects[0].distance < 0.8) {
                    blocked = true;
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
        const rayOrigin = player.position.clone();
        rayOrigin.y += 2.0; 
        
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
                raycaster.set(new THREE.Vector3(player.position.x, 200, player.position.z), downVector);
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
