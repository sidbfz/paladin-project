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
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

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

// Cinematic Parameters
const cinematicParams = {
    bloomStrength: 0.3,
    bloomRadius: 0.6,
    bloomThreshold: 0.7,
    vignetteIntensity: 0.4,
    saturation: 1.1,
    contrast: 1.05
};

// Lighting Presets
let currentPreset = 'goldenHour';
const lightingPresets = {
    goldenHour: {
        name: 'Sunrise (East)',
        sky: { turbidity: 2.5, rayleigh: 1.8, mieCoefficient: 0.08, mieDirectionalG: 0.95, elevation: 8, azimuth: 90 },  // East
        fog: { color: 0xe8d8c8, density: 0.008 },
        background: 0xd4c4b0,
        dirLight: { color: 0xffd090, intensity: 5.0 },
        hemiLight: { skyColor: 0xffffff, groundColor: 0x444444, intensity: 1.0 },
        rimLight: { color: 0x8090ff, intensity: 1.5 },
        ambient: { color: 0xffffff, intensity: 0.2 },
        bloom: { strength: 0.3, threshold: 0.7 },
        exposure: 1.2,
        waterColor: 0x001122
    },
    sunset: {
        name: 'Sunset (West)',
        sky: { turbidity: 4.0, rayleigh: 2.5, mieCoefficient: 0.1, mieDirectionalG: 0.85, elevation: 3, azimuth: 270 },  // West
        fog: { color: 0xd4a574, density: 0.01 },
        background: 0xc07050,
        dirLight: { color: 0xff6030, intensity: 4.0 },
        hemiLight: { skyColor: 0xff9060, groundColor: 0x3a2a4a, intensity: 0.8 },
        rimLight: { color: 0x6040a0, intensity: 2.0 },
        ambient: { color: 0xff8866, intensity: 0.15 },
        bloom: { strength: 0.5, threshold: 0.6 },
        exposure: 1.0,
        waterColor: 0x1a0a2a
    },
    night: {
        name: 'Night',
        sky: { turbidity: 0.1, rayleigh: 0.1, mieCoefficient: 0.005, mieDirectionalG: 0.8, elevation: -5, azimuth: 270 },  // Moon in west
        fog: { color: 0x151530, density: 0.006 },
        background: 0x0a0a20,
        dirLight: { color: 0x80a0ee, intensity: 3.5 },  // Brighter moonlight
        hemiLight: { skyColor: 0x3040aa, groundColor: 0x151525, intensity: 0.8 },
        rimLight: { color: 0x6080cc, intensity: 2.5 },  // Stronger blue rim
        ambient: { color: 0x2030aa, intensity: 0.8 },  // Much brighter ambient
        bloom: { strength: 0.8, threshold: 0.4 },  // More bloom for glow
        exposure: 1.1,  // Much higher exposure
        waterColor: 0x0a1030
    }
};

// Vignette + Color Grading Shader
const CinematicShader = {
    uniforms: {
        'tDiffuse': { value: null },
        'vignetteIntensity': { value: 0.4 },
        'saturation': { value: 1.1 },
        'contrast': { value: 1.05 },
        'time': { value: 0.0 }
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float vignetteIntensity;
        uniform float saturation;
        uniform float contrast;
        uniform float time;
        varying vec2 vUv;
        
        void main() {
            vec4 color = texture2D(tDiffuse, vUv);
            
            // Vignette
            vec2 center = vUv - 0.5;
            float dist = length(center);
            float vignette = 1.0 - smoothstep(0.3, 0.9, dist * vignetteIntensity * 2.0);
            color.rgb *= vignette;
            
            // Saturation
            float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
            color.rgb = mix(vec3(gray), color.rgb, saturation);
            
            // Contrast
            color.rgb = (color.rgb - 0.5) * contrast + 0.5;
            
            // Subtle warm tint for golden hour
            color.r *= 1.02;
            color.b *= 0.97;
            
            // Film grain (very subtle)
            float grain = fract(sin(dot(vUv * time, vec2(12.9898, 78.233))) * 43758.5453);
            color.rgb += (grain - 0.5) * 0.015;
            
            gl_FragColor = color;
        }
    `
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
scene.background = new THREE.Color(0xd4c4b0); // Warmer background
scene.fog = new THREE.FogExp2(0xe8d8c8, 0.008); // Thicker warm fog for cinematic depth

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 0.5, 1.5); // Closer to the small character

// --- AUDIO LISTENER ---
const listener = new THREE.AudioListener();
camera.add( listener );

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace; // Important for correct color rendering
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2; // Cinematic exposure
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

// Cinematic Bloom Pass
const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    cinematicParams.bloomStrength,
    cinematicParams.bloomRadius,
    cinematicParams.bloomThreshold
);
composer.addPass(bloomPass);

// Cinematic Vignette + Color Grading Pass
const cinematicPass = new ShaderPass(CinematicShader);
cinematicPass.uniforms['vignetteIntensity'].value = cinematicParams.vignetteIntensity;
cinematicPass.uniforms['saturation'].value = cinematicParams.saturation;
cinematicPass.uniforms['contrast'].value = cinematicParams.contrast;
composer.addPass(cinematicPass);

const outputPass = new OutputPass();
composer.addPass(outputPass);

// Controls
const controls = new PointerLockControls(camera, document.body);

// Click to lock
document.addEventListener('click', (event) => {
    // Resume Audio Context if suspended (Fixes "AudioContext was not allowed to start" warning)
    if (listener.context.state === 'suspended') {
        listener.context.resume();
    }

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

const dirLight = new THREE.DirectionalLight(0xffd090, 5.0); // Warmer, stronger golden sun
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

// Cinematic Rim Light (backlight for dramatic silhouettes)
const rimLight = new THREE.DirectionalLight(0x8090ff, 1.5);
rimLight.position.set(-10, 8, -10);
scene.add(rimLight);

// Subtle fill light from opposite side
const fillLight = new THREE.DirectionalLight(0xffeedd, 0.3);
fillLight.position.set(-5, 3, 5);
scene.add(fillLight);

// --- Sky & Sun ---
const sky = new Sky();
sky.scale.setScalar(450000);
scene.add(sky);

// Removed GridHelper

const sun = new THREE.Vector3();

const effectController = {
    turbidity: 2.5, // Slightly hazy for cinematic atmosphere
    rayleigh: 1.8, // Richer sky colors
    mieCoefficient: 0.08, // More sun glow
    mieDirectionalG: 0.95, // Tighter sun disc
    elevation: 8, // Very low sun = Deep Golden Hour
    azimuth: 160, // Angled for dramatic shadows
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

// --- Moon, Sun & Stars (for time of day) ---
let moon, moonGlow, stars, sunSphere;

// Create Moon
function createMoon() {
    // Main moon sphere - bright white
    const moonGeo = new THREE.SphereGeometry(12, 32, 32);
    const moonMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        toneMapped: false  // Bypass tone mapping so it stays bright
    });
    moon = new THREE.Mesh(moonGeo, moonMat);
    moon.visible = false;
    scene.add(moon);
    
    // Moon glow effect - larger transparent sphere
    const glowGeo = new THREE.SphereGeometry(25, 32, 32);
    const glowMat = new THREE.ShaderMaterial({
        uniforms: {
            glowColor: { value: new THREE.Color(0xaaccff) },
            viewVector: { value: new THREE.Vector3() }
        },
        vertexShader: `
            varying vec3 vNormal;
            void main() {
                vNormal = normalize(normalMatrix * normal);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform vec3 glowColor;
            varying vec3 vNormal;
            void main() {
                float intensity = pow(0.7 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.0);
                gl_FragColor = vec4(glowColor, intensity * 0.6);
            }
        `,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false
    });
    moonGlow = new THREE.Mesh(glowGeo, glowMat);
    moonGlow.visible = false;
    scene.add(moonGlow);
}

// Create Sun Sphere (visible sun disc in sky)
function createSunSphere() {
    const sunGeo = new THREE.SphereGeometry(20, 32, 32);
    const sunMat = new THREE.MeshBasicMaterial({
        color: 0xffdd88,
        transparent: true,
        opacity: 0.95
    });
    sunSphere = new THREE.Mesh(sunGeo, sunMat);
    sunSphere.visible = true; // Visible by default (Golden Hour starts)
    scene.add(sunSphere);
    
    // Position sun initially
    sunSphere.position.copy(sun).multiplyScalar(380);
}

// Create Starfield
function createStars() {
    const starCount = 3000;
    const starGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(starCount * 3);
    const sizes = new Float32Array(starCount);
    
    for (let i = 0; i < starCount; i++) {
        // Distribute on a sphere
        const radius = 400;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos((Math.random() * 2) - 1);
        
        positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
        positions[i * 3 + 1] = Math.abs(radius * Math.cos(phi)); // Only upper hemisphere
        positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
        
        sizes[i] = Math.random() * 2 + 0.5;
    }
    
    starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    starGeo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    
    const starMat = new THREE.ShaderMaterial({
        uniforms: {
            time: { value: 0 },
            color: { value: new THREE.Color(0xffffff) }
        },
        vertexShader: `
            attribute float size;
            uniform float time;
            varying float vTwinkle;
            void main() {
                vTwinkle = 0.5 + 0.5 * sin(time * 2.0 + position.x * 0.1 + position.z * 0.1);
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                gl_PointSize = size * vTwinkle * (200.0 / -mvPosition.z);
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: `
            uniform vec3 color;
            varying float vTwinkle;
            void main() {
                float dist = length(gl_PointCoord - vec2(0.5));
                if (dist > 0.5) discard;
                float alpha = 1.0 - smoothstep(0.0, 0.5, dist);
                gl_FragColor = vec4(color, alpha * vTwinkle);
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });
    
    stars = new THREE.Points(starGeo, starMat);
    stars.visible = false; // Hidden by default
    scene.add(stars);
}

createMoon();
createStars();
createSunSphere();

// --- HDRI / IBL Environment ---
// Use the Procedural Sky we created to light the scene massively improving realism.
// The armor will now reflect the sky and sun.
const pmremGenerator = new THREE.PMREMGenerator(renderer);
let renderTarget = pmremGenerator.fromScene(scene);
scene.environment = renderTarget.texture;

// --- Lighting Preset System ---
function applyPreset(presetName) {
    const preset = lightingPresets[presetName];
    if (!preset) return;
    
    // If loading for the first time or switching presets
    if (presetName !== currentPreset) {
         currentPreset = presetName; // Update global state
    }
    
    // Update Sky
    const skyUniforms = sky.material.uniforms;
    skyUniforms['turbidity'].value = preset.sky.turbidity;
    skyUniforms['rayleigh'].value = preset.sky.rayleigh;
    skyUniforms['mieCoefficient'].value = preset.sky.mieCoefficient;
    skyUniforms['mieDirectionalG'].value = preset.sky.mieDirectionalG;
    
    const phi = THREE.MathUtils.degToRad(90 - preset.sky.elevation);
    const theta = THREE.MathUtils.degToRad(preset.sky.azimuth);
    sun.setFromSphericalCoords(1, phi, theta);
    skyUniforms['sunPosition'].value.copy(sun);
    
    // Update Fog
    scene.fog.color.setHex(preset.fog.color);
    scene.fog.density = preset.fog.density;
    scene.background.setHex(preset.background);
    
    // Update Lights
    dirLight.color.setHex(preset.dirLight.color);
    dirLight.intensity = preset.dirLight.intensity;
    dirLight.position.copy(sun).multiplyScalar(50);
    
    hemiLight.color.setHex(preset.hemiLight.skyColor);
    hemiLight.groundColor.setHex(preset.hemiLight.groundColor);
    hemiLight.intensity = preset.hemiLight.intensity;
    
    rimLight.color.setHex(preset.rimLight.color);
    rimLight.intensity = preset.rimLight.intensity;
    
    ambientLight.color.setHex(preset.ambient.color);
    ambientLight.intensity = preset.ambient.intensity;
    
    // Update Bloom
    bloomPass.strength = preset.bloom.strength;
    bloomPass.threshold = preset.bloom.threshold;
    
    // Update Exposure
    renderer.toneMappingExposure = preset.exposure;
    
    // Update Water Color
    if (water) {
        water.material.uniforms['waterColor'].value.setHex(preset.waterColor);
        water.material.uniforms['sunDirection'].value.copy(sun).normalize();
    }
    if (waterfall) {
        waterfall.material.uniforms['waterColor'].value.setHex(preset.waterColor);
    }
    if (waterfall2) {
        waterfall2.material.uniforms['waterColor'].value.setHex(preset.waterColor);
    }
    
    // Show/Hide Moon, Sun & Stars based on time of day
    const isNight = presetName === 'night';
    const isSunset = presetName === 'sunset';
    
    // Sun Sphere visibility and position
    if (sunSphere) {
        sunSphere.visible = !isNight;
        if (!isNight) {
            // Position sun in sky based on current sun direction
            sunSphere.position.copy(sun).multiplyScalar(380);
            
            // Change sun color based on time
            if (isSunset) {
                sunSphere.material.color.setHex(0xff6030); // Deep orange/red for sunset
                sunSphere.scale.setScalar(1.5); // Bigger sun at sunset
            } else {
                sunSphere.material.color.setHex(0xffdd88); // Golden for golden hour
                sunSphere.scale.setScalar(1.0);
            }
        }
    }
    
    // Moon visibility and position
    if (moon) {
        moon.visible = isNight;
        if (moonGlow) moonGlow.visible = isNight;
        
        if (isNight) {
            // Position moon based on light direction (opposite side for nice lighting)
            const moonPhi = THREE.MathUtils.degToRad(90 - 25); // 25 degrees up
            const moonTheta = THREE.MathUtils.degToRad(preset.sky.azimuth + 30);
            const moonDir = new THREE.Vector3();
            moonDir.setFromSphericalCoords(1, moonPhi, moonTheta);
            moon.position.copy(moonDir).multiplyScalar(350);
            
            // Position glow at same location
            if (moonGlow) moonGlow.position.copy(moon.position);
            
            // Update directional light to come from moon
            dirLight.position.copy(moonDir).multiplyScalar(50);
        }
    }
    if (stars) {
        stars.visible = isNight;
    }
    
    // Regenerate environment map for reflections
    renderTarget.dispose();
    renderTarget = pmremGenerator.fromScene(scene);
    scene.environment = renderTarget.texture;
    
    // Update button text
    if (presetButton) {
        presetButton.textContent = preset.name;
    }
}

function togglePreset() {
    const presets = Object.keys(lightingPresets);
    const currentIndex = presets.indexOf(currentPreset);
    const nextIndex = (currentIndex + 1) % presets.length;
    applyPreset(presets[nextIndex]);
}

// --- Preset Toggle Button ---
const presetButton = document.createElement('button');
presetButton.textContent = 'Golden Hour';
presetButton.style.cssText = `
    position: fixed;
    top: 20px;
    left: 20px;
    padding: 12px 24px;
    font-size: 16px;
    font-weight: bold;
    color: white;
    background: linear-gradient(135deg, #ff8c42, #d4556a, #9b59b6);
    border: none;
    border-radius: 25px;
    cursor: pointer;
    z-index: 1000;
    box-shadow: 0 4px 15px rgba(0,0,0,0.3);
    transition: transform 0.2s, box-shadow 0.2s;
    font-family: 'Segoe UI', Arial, sans-serif;
`;
presetButton.addEventListener('mouseenter', () => {
    presetButton.style.transform = 'scale(1.05)';
    presetButton.style.boxShadow = '0 6px 20px rgba(0,0,0,0.4)';
});
presetButton.addEventListener('mouseleave', () => {
    presetButton.style.transform = 'scale(1)';
    presetButton.style.boxShadow = '0 4px 15px rgba(0,0,0,0.3)';
});
presetButton.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePreset();
});
document.body.appendChild(presetButton);

// --- Audio Toggle Button ---
let isAudioMuted = false;
const audioButton = document.createElement('button');
audioButton.textContent = '🔊 Sound On';
audioButton.style.cssText = `
    position: fixed;
    top: 80px;
    left: 20px;
    padding: 12px 24px;
    font-size: 16px;
    font-weight: bold;
    color: white;
    background: linear-gradient(135deg, #2ecc71, #27ae60);
    border: none;
    border-radius: 25px;
    cursor: pointer;
    z-index: 1000;
    box-shadow: 0 4px 15px rgba(0,0,0,0.3);
    transition: transform 0.2s, box-shadow 0.2s;
    font-family: 'Segoe UI', Arial, sans-serif;
`;
audioButton.addEventListener('mouseenter', () => {
    audioButton.style.transform = 'scale(1.05)';
    audioButton.style.boxShadow = '0 6px 20px rgba(0,0,0,0.4)';
});
audioButton.addEventListener('mouseleave', () => {
    audioButton.style.transform = 'scale(1)';
    audioButton.style.boxShadow = '0 4px 15px rgba(0,0,0,0.3)';
});
audioButton.addEventListener('click', (e) => {
    e.stopPropagation();
    isAudioMuted = !isAudioMuted;
    if (isAudioMuted) {
        listener.setMasterVolume(0);
        audioButton.textContent = '🔇 Sound Off';
        audioButton.style.background = 'linear-gradient(135deg, #95a5a6, #7f8c8d)';
    } else {
        listener.setMasterVolume(1);
        audioButton.textContent = '🔊 Sound On';
        audioButton.style.background = 'linear-gradient(135deg, #2ecc71, #27ae60)';
    }
});
document.body.appendChild(audioButton);

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
        sunColor: 0xffffee,
        waterColor: 0x001122,
        distortionScale: 5.0,
        fog: scene.fog !== undefined,
        alpha: 0.9
    }
);
water.rotation.x = - Math.PI / 2;
water.position.y = riverParams.waterHeight;
scene.add( water );
water.material.uniforms[ 'sunDirection' ].value.copy( sun ).normalize();

// Boost water reflectivity for cinematic shine
water.material.uniforms[ 'size' ].value = 2.0; // Smaller ripples = sharper reflections
updateWaterScale(); // Apply initial scale based on riverParams

// --- AUDIO: RIVER ---
const audioLoader = new THREE.AudioLoader();
const riverSound = new THREE.PositionalAudio( listener );
audioLoader.load( 'sounds/river-flow.mp3', function( buffer ) {
    riverSound.setBuffer( buffer );
    riverSound.setRefDistance( 15 ); // Distance where volume starts to drop
    riverSound.setRolloffFactor( 1 ); // Rate of volume drop
    riverSound.setLoop( true );
    if (buffer.duration > 1.0) {
        riverSound.setLoopStart(0.5);
        riverSound.setLoopEnd(buffer.duration - 0.5); 
    }
    riverSound.setVolume( 1.0 );
    riverSound.play();
});
scene.add( riverSound ); // Attach to scene so we can move it freely along the river path

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
gui.hide(); // Hide the control box by default
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

const folderCinematic = gui.addFolder('Cinematic');
folderCinematic.add(cinematicParams, 'bloomStrength', 0, 2).name('Bloom').onChange(v => bloomPass.strength = v);
folderCinematic.add(cinematicParams, 'bloomThreshold', 0, 1).name('Bloom Thresh').onChange(v => bloomPass.threshold = v);
folderCinematic.add(cinematicParams, 'vignetteIntensity', 0, 1).name('Vignette').onChange(v => cinematicPass.uniforms['vignetteIntensity'].value = v);
folderCinematic.add(cinematicParams, 'saturation', 0.5, 1.5).name('Saturation').onChange(v => cinematicPass.uniforms['saturation'].value = v);
folderCinematic.add(cinematicParams, 'contrast', 0.8, 1.3).name('Contrast').onChange(v => cinematicPass.uniforms['contrast'].value = v);
folderCinematic.open();


// Improved Clouds
function addClouds() {
    // Smoother, fluffier geometry (Icosahedron)
    const geo = new THREE.IcosahedronGeometry(1, 0); 
    const mat = new THREE.MeshStandardMaterial({ 
        color: 0xffffff, 
        flatShading: true, 
        roughness: 0.9,
        metalness: 0.1,
        transparent: true,
        opacity: 0.6 // Reduced opacity
    });
    
    // Create random cloud clumps
    for (let i = 0; i < 50; i++) {
        const cloud = new THREE.Group();
        
        // More puffs for denser, less blocky look
        const puffs = 7 + Math.floor(Math.random() * 6); 
        for(let j=0; j<puffs; j++) {
            const mesh = new THREE.Mesh(geo, mat);
            // Tighter packing to merge shapes
            mesh.position.set(
                (Math.random() - 0.5) * 5,
                (Math.random() - 0.5) * 3,
                (Math.random() - 0.5) * 4
            );
            // Varied sizes
            const size = 3 + Math.random() * 5;
            mesh.scale.setScalar(size);
            
            // Random rotation
            mesh.rotation.set(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI);

            mesh.castShadow = false; 
            mesh.receiveShadow = false;
            cloud.add(mesh);
        }
        
        // Form way higher in the sky (120+)
        cloud.position.set(
            (Math.random() - 0.5) * 400, // Spread over land
            120 + Math.random() * 100, 
            (Math.random() - 0.5) * 400
        );
        
        // Slowly float uniformly
        cloud.userData = { speed: 0.5 + Math.random() * 1.5 };
        
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

let gameActive = false;
const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

// --- MOBILE CONTROLS LOGIC ---
const joystickVector = { x: 0, y: 0 };

function initMobileControls() {
    const joystickZone = document.getElementById('joystick-zone');
    const joystickKnob = document.getElementById('joystick-knob');
    const jumpBtn = document.getElementById('mobile-jump-btn');

    if (!joystickZone || !joystickKnob || !jumpBtn) return;

    // Joystick Touch
    let startX = 0, startY = 0;
    
    // Prevent default touch actions (scrolling)
    document.getElementById('mobile-controls').addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });

    joystickZone.addEventListener('touchstart', (e) => {
        const touch = e.changedTouches[0];
        const rect = joystickZone.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        
        startX = centerX;
        startY = centerY;
        
        updateJoystick(touch.clientX, touch.clientY, centerX, centerY);
    }, { passive: false });

    joystickZone.addEventListener('touchmove', (e) => {
        const touch = e.changedTouches[0];
        // Recalculate center incase of scroll/resize (though fixed pos)
        const rect = joystickZone.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        
        updateJoystick(touch.clientX, touch.clientY, centerX, centerY);
    }, { passive: false });

    joystickZone.addEventListener('touchend', (e) => {
        joystickVector.x = 0;
        joystickVector.y = 0;
        joystickKnob.style.transform = `translate(-50%, -50%)`;
    });

    function updateJoystick(clientX, clientY, centerX, centerY) {
        let dx = clientX - centerX;
        let dy = clientY - centerY;
        
        const maxRadius = 50; // Half of base width (100px)
        const distance = Math.min(Math.sqrt(dx*dx + dy*dy), maxRadius);
        const angle = Math.atan2(dy, dx);
        
        // Clamp visual knob
        const knobX = Math.cos(angle) * distance;
        const knobY = Math.sin(angle) * distance;
        joystickKnob.style.transform = `translate(calc(-50% + ${knobX}px), calc(-50% + ${knobY}px))`;
        
        // Normalize vector (-1 to 1)
        joystickVector.x = knobX / maxRadius;
        joystickVector.y = knobY / maxRadius;
    }

    // Jump Button
    jumpBtn.addEventListener('touchstart', (e) => {
        keys.space = true;
        jumpBtn.style.background = 'rgba(255, 215, 0, 0.5)';
        jumpBtn.style.transform = 'scale(0.95)';
    });
    
    jumpBtn.addEventListener('touchend', (e) => {
        keys.space = false;
        jumpBtn.style.background = 'rgba(255, 215, 0, 0.2)';
        jumpBtn.style.transform = 'scale(1)';
    });

    // Touch Look (Right side Only)
    let lastTouchX = 0;
    let lastTouchY = 0;
    let lookTouchId = null;

    document.addEventListener('touchstart', (e) => {
        // Ignore if touching controls or Left Side of Screen
        // Let's reserve the Left 40% of screen for Joystick/Movement
        // And Right 60% for Camera
        
        for (let i = 0; i < e.changedTouches.length; i++) {
            const touch = e.changedTouches[i];
            
            // If dragging on UI, ignore
            if (e.target.closest('#joystick-zone') || e.target.closest('#action-zone')) continue;
            
            // Check if touch is on the RIGHT side of the screen
            if (touch.clientX > window.innerWidth * 0.4) {
                if (lookTouchId === null) {
                    lookTouchId = touch.identifier;
                    lastTouchX = touch.clientX;
                    lastTouchY = touch.clientY;
                }
            }
        }
    }, { passive: false });

    document.addEventListener('touchmove', (e) => {
        if (lookTouchId === null) return;

        for (let i = 0; i < e.changedTouches.length; i++) {
            const touch = e.changedTouches[i];
            
            if (touch.identifier === lookTouchId) {
                const movementX = touch.clientX - lastTouchX;
                const movementY = touch.clientY - lastTouchY;
                
                lastTouchX = touch.clientX;
                lastTouchY = touch.clientY;

                // Adjust Sensitivity - Mobile needs to be faster
                const sensitivity = 0.004;

                // Rotate Camera
                // Note: Standard PointerLockControls rotates the 'camera' object directly 
                // but we need to implement the Euler rotation manually here.
                
                // Yaw (Camera Y) - Inversed
                camera.rotation.y -= movementX * sensitivity;
                
                // Pitch (Camera X)
                camera.rotation.x -= movementY * sensitivity;
                camera.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, camera.rotation.x));
            }
        }
    }, { passive: false });
    
    document.addEventListener('touchend', (e) => {
        for (let i = 0; i < e.changedTouches.length; i++) {
             if (e.changedTouches[i].identifier === lookTouchId) {
                 lookTouchId = null;
             }
        }
    });
}
// Initialize after DOM load
setTimeout(initMobileControls, 500);

const keyStates = {};
const actions = {
    idle: null,
    walk: null,
    run: null,
    strafe_left: null,
    strafe_right: null,
    jump: null
};

// Global for footsteps
let footstepSound, jumpStartSound, jumpEndSound;
let lastStepTime = 0;

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

        // Coordinate Logger for Sound Placement
        case 'l': 
            if (player) {
                console.log(`Pos: ${player.position.x.toFixed(2)}, ${player.position.y.toFixed(2)}, ${player.position.z.toFixed(2)}`);
            }
            break;
    }
});

// --- AUDIO: FISHERMAN SETUP ---
const fishermanPos = new THREE.Vector3(2.70, 31.94, 38.55);
// Adjust Y up slightly so sound comes from head/mouth level
const fishermanSoundPos = fishermanPos.clone().add(new THREE.Vector3(0, 1.5, 0)); 
let fishermanSound;
let fishermanPlayed = false;
const fishermanTriggerDist = 8.0; // Play when closer than 8 units
const fishermanResetDist = 20.0;  // Reset only when further than 20 units

// Load Fisherman Sound
const fmLoader = new THREE.AudioLoader();
fishermanSound = new THREE.PositionalAudio( listener );
fmLoader.load( 'sounds/fisherman.mp3', function( buffer ) {
    fishermanSound.setBuffer( buffer );
    fishermanSound.setRefDistance( 5 ); 
    fishermanSound.setRolloffFactor( 2 );
    fishermanSound.setLoop( false ); // One shot
    fishermanSound.setVolume( 1.5 );
    
    // Attach to Scene (Static location)
    fishermanSound.position.copy(fishermanSoundPos);
    scene.add(fishermanSound); 
});

// --- AUDIO: OXEN SETUP ---
const oxenPos = new THREE.Vector3(36.43, 30.87, -1.83);
let oxenSound;
let oxenPlayed = false;
const oxenTriggerDist = 10.0; // Slightly larger for a big animal
const oxenResetDist = 25.0; 

// Load Oxen Sound
const oxLoader = new THREE.AudioLoader();
oxenSound = new THREE.PositionalAudio( listener );
oxLoader.load( 'sounds/oxen.mp3', function( buffer ) {
    oxenSound.setBuffer( buffer );
    oxenSound.setRefDistance( 5 ); 
    oxenSound.setRolloffFactor( 2 );
    oxenSound.setLoop( false ); // One shot trigger
    oxenSound.setVolume( 1.5 );
    
    // Attach to Scene
    oxenSound.position.copy(oxenPos);
    scene.add(oxenSound); 

});

// --- AUDIO: COWS SETUP ---
const cow1Pos = new THREE.Vector3(38.29, 30.43, -8.97);
const cow2Pos = new THREE.Vector3(36.58, 30.85, -9.31);
const cow3Pos = new THREE.Vector3(43.06, 29.01, -25.18);
let cow1Sound, cow2Sound, cow3Sound;
let cow1Played = false, cow2Played = false, cow3Played = false;
const cowTriggerDist = 8.0; 
const cowResetDist = 20.0;
const mooLoader = new THREE.AudioLoader();

// Cow 1
cow1Sound = new THREE.PositionalAudio( listener );
mooLoader.load( 'sounds/moo.mp3', function( buffer ) {
    cow1Sound.setBuffer( buffer );
    cow1Sound.setRefDistance( 5 ); 
    cow1Sound.setRolloffFactor( 2 ); 
    cow1Sound.setLoop( false ); 
    cow1Sound.setVolume( 1.0 ); // Reduce vol
    cow1Sound.position.copy(cow1Pos);
    scene.add(cow1Sound);  

    // Periodic Background Cow 1
    const scheduleCow1 = () => {
        if (!cow1Sound.isPlaying) {
             cow1Sound.setPlaybackRate(0.95 + Math.random() * 0.1); 
             cow1Sound.play();
        }
        const nextDelay = (Math.random() * 40000) + 40000; 
        setTimeout(scheduleCow1, nextDelay);
    };
    setTimeout(scheduleCow1, Math.random() * 20000);
});

// Cow 2
cow2Sound = new THREE.PositionalAudio( listener );
mooLoader.load( 'sounds/moo.mp3', function( buffer ) {
    cow2Sound.setBuffer( buffer );
    cow2Sound.setRefDistance( 5 ); 
    cow2Sound.setRolloffFactor( 2 ); 
    cow2Sound.setLoop( false ); 
    cow2Sound.setVolume( 1.0 ); // Reduce vol
    cow2Sound.position.copy(cow2Pos);
    scene.add(cow2Sound);  

    // Periodic Background Cow 2
    const scheduleCow2 = () => {
        if (!cow2Sound.isPlaying) {
             cow2Sound.setPlaybackRate(0.95 + Math.random() * 0.1); 
             cow2Sound.play();
        }
        const nextDelay = (Math.random() * 40000) + 40000; 
        setTimeout(scheduleCow2, nextDelay);
    };
    setTimeout(scheduleCow2, Math.random() * 20000);
});

// Cow 3
cow3Sound = new THREE.PositionalAudio( listener );
mooLoader.load( 'sounds/moo.mp3', function( buffer ) {
    cow3Sound.setBuffer( buffer );
    cow3Sound.setRefDistance( 5 ); 
    cow3Sound.setRolloffFactor( 2 ); 
    cow3Sound.setLoop( false ); 
    cow3Sound.setVolume( 1.0 ); // Reduce vol
    cow3Sound.position.copy(cow3Pos);
    scene.add(cow3Sound);  

    // Periodic Background Cow 3
    const scheduleCow3 = () => {
        if (!cow3Sound.isPlaying) {
             cow3Sound.setPlaybackRate(0.95 + Math.random() * 0.1); 
             cow3Sound.play();
        }
        const nextDelay = (Math.random() * 40000) + 40000; 
        setTimeout(scheduleCow3, nextDelay);
    };
    setTimeout(scheduleCow3, Math.random() * 20000);
});

// --- AUDIO: SHEEP SETUP ---
const sheepPositions = [
    new THREE.Vector3(37.02, 30.57, 17.99),
    new THREE.Vector3(33.81, 31.31, 22.18),
    new THREE.Vector3(37.06, 30.56, 17.65),
    new THREE.Vector3(36.83, 30.62, 21.41),
    new THREE.Vector3(38.99, 30.18, 22.75),
    new THREE.Vector3(36.58, 30.68, 25.11),
    new THREE.Vector3(41.56, 29.61, 22.60),
    new THREE.Vector3(52.17, 28.40, 28.19)
];

const sheepData = [];
// Global for Deer Proximity
let deerData = null; 

const sheepLoader = new THREE.AudioLoader();
sheepPositions.forEach((pos) => {
    const sound = new THREE.PositionalAudio(listener);
    // Store in array to manage update logic
    sheepData.push({
        sound: sound,
        pos: pos,
        played: false,
        triggerDist: 6.0,  // Sheep are smaller, trigger closer
        resetDist: 15.0
    });

    sheepLoader.load('sounds/sheep.mp3', function(buffer) {
        sound.setBuffer(buffer);
        sound.setRefDistance(4);
        sound.setRolloffFactor(2.5);
        sound.setLoop(false);
        sound.setVolume(0.5); // Baa is quiet
        sound.position.copy(pos);
        scene.add(sound);

        // Periodic Background "Baa" (Herd Ambience)
        const scheduleBaa = () => {
            if (!sound.isPlaying) {
                 sound.setPlaybackRate(0.9 + Math.random() * 0.2); // Random pitch
                 sound.play();
            }
            // Schedule next baa between 60s and 180s (1-3 mins)
            const nextDelay = (Math.random() * 60000) + 120000; 
            setTimeout(scheduleBaa, nextDelay);
        };
        
        // Start with random offset so they don't all bleat at once
        setTimeout(scheduleBaa, Math.random() * 20000);
    });
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
const loadingManager = new THREE.LoadingManager();

loadingManager.onProgress = function ( url, itemsLoaded, itemsTotal ) {
    const loadingBar = document.getElementById('loading-bar');
    
    if (loadingBar && itemsTotal > 0) {
        const progress = (itemsLoaded / itemsTotal) * 100;
        loadingBar.style.width = progress + '%';
    }
};

loadingManager.onLoad = function () {
    const loaderContainer = document.getElementById('loader-container');
    const startContainer = document.getElementById('start-container');
    const enterButton = document.getElementById('enter-button');
    const loadingScreen = document.getElementById('loading-screen');
    
    if (loaderContainer) loaderContainer.style.display = 'none';
    if (startContainer) startContainer.style.display = 'flex';
    
    if (enterButton) {
        enterButton.addEventListener('click', () => {
            // Request Fullscreen on Mobile
            if (isMobile) {
                const docEl = document.documentElement;
                if (docEl.requestFullscreen) {
                    docEl.requestFullscreen();
                } else if (docEl.webkitRequestFullscreen) { /* Safari */
                    docEl.webkitRequestFullscreen();
                } else if (docEl.msRequestFullscreen) { /* IE11 */
                    docEl.msRequestFullscreen();
                }
            }

            // Resume Audio Context
            if (listener.context.state === 'suspended') {
                listener.context.resume().then(() => {
                    console.log('AudioContext resumed');
                });
            }
            
            // Hide loading screen
            if (loadingScreen) {
                loadingScreen.style.opacity = '0';
                setTimeout(() => {
                    loadingScreen.remove();
                    gameActive = true; // Start game loop logic
                }, 1500); 
            }
        });
    }

    // Initialize the default preset (including audio) when loading is done
    applyPreset(currentPreset);
};

const gltfLoader = new GLTFLoader(loadingManager);
const fbxLoader = new FBXLoader(loadingManager);

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

        // --- AUDIO: WINDMILL ---
        // Moved outside isMesh check because 'Mill-wind-wheel' might be a Group, not a Mesh
        if (child.name === 'Mill-wind-wheel') {
            const windLoader = new THREE.AudioLoader();
            const windSound = new THREE.PositionalAudio( listener );
            windLoader.load( 'sounds/windmill.mp3', function( buffer ) {
                windSound.setBuffer( buffer );
                windSound.setRefDistance( 10 );
                windSound.setRolloffFactor( 2 ); 
                windSound.setLoop( true );
                if (buffer.duration > 1.0) {
                    windSound.setLoopStart(0.5);
                    windSound.setLoopEnd(buffer.duration - 0.5); 
                }
                windSound.setVolume( 1.5 );
                windSound.play();
            });
            child.add( windSound );
        }

        // --- AUDIO: WATERMILL ---
        if (child.name === 'Mill-water-wheel') {
            const wmLoader = new THREE.AudioLoader();
            const wmSound = new THREE.PositionalAudio( listener );
            wmLoader.load( 'sounds/watermill.mp3', function( buffer ) {
                wmSound.setBuffer( buffer );
                wmSound.setRefDistance( 8 ); // Slightly lower ref distance for water
                wmSound.setRolloffFactor( 2.5 ); 
                wmSound.setLoop( true );
                if (buffer.duration > 1.0) {
                    wmSound.setLoopStart(0.5);
                    wmSound.setLoopEnd(buffer.duration - 0.5); 
                }
                wmSound.setVolume( 1.2 );
                wmSound.play();
            });
            child.add( wmSound );
        }

        // --- AUDIO: DEER (Proximity + Random) ---
        if (child.name === 'deers') {
            const deerLoader = new THREE.AudioLoader();
            const deerSound = new THREE.PositionalAudio( listener );
            
            // Expose for animate loop
            deerData = {
                sound: deerSound,
                mesh: child, // Attach to child directly
                played: false
            };

            deerLoader.load( 'sounds/deer.mp3', function( buffer ) {
                deerSound.setBuffer( buffer );
                deerSound.setRefDistance( 12 );
                deerSound.setRolloffFactor( 2.0 );
                deerSound.setLoop( false ); 
                deerSound.setVolume( 0.75 );
                
                // Periodic Background "Call"
                const scheduleDeer = () => {
                    if (!deerSound.isPlaying) {
                        deerSound.play();
                    }
                    // Deer calls are sparse (40-100s)
                    const nextDelay = (Math.random() * 40000) + 60000;
                    setTimeout(scheduleDeer, nextDelay);
                };
                setTimeout(scheduleDeer, Math.random() * 10000);
            });
            child.add( deerSound );
        }

        // --- AUDIO: FLAGS ---
        if (child.name === 'flag' || child.name === 'flag-second') {
            const flagLoader = new THREE.AudioLoader();
            const flagSound = new THREE.PositionalAudio( listener );
            flagLoader.load( 'sounds/flag.mp3', function( buffer ) {
                flagSound.setBuffer( buffer );
                flagSound.setRefDistance( 5 ); 
                flagSound.setRolloffFactor( 2 ); 
                flagSound.setLoop( true ); // Loop continuously
                if (buffer.duration > 1.0) {
                    flagSound.setLoopStart(0.5);
                    flagSound.setLoopEnd(buffer.duration - 0.5); 
                }
                flagSound.setVolume( 1.5 ); 
                // Random start time to avoid phasing if identical flags
                setTimeout(() => {
                    if(!flagSound.isPlaying) flagSound.play();
                }, Math.random() * 2000);
            });
            child.add( flagSound );
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
    
    // Set spawn point as requested
    character.position.set(1.19, 29.99, -3.95); 
    character.rotation.y = Math.PI; // Turn 180 degrees to face opposite direction

    character.traverse((child) => {
        if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
        }
    });

    scene.add(character);
    player = character;

    // Immediately update camera to follow character spawn
    // Character is now facing +Z (Math.PI). We want camera BEHIND them (at -Z).
    const camDist = 3.5;
    const camHeight = 1.5;
    
    camera.position.copy(player.position);
    camera.position.y += camHeight;
    camera.position.z -= camDist; // Move behind character (who is facing +Z)
    
    camera.lookAt(player.position.x, player.position.y + 1.0, player.position.z);

    // --- AUDIO: FOOTSTEPS ---
    const stepLoader = new THREE.AudioLoader();
    footstepSound = new THREE.PositionalAudio( listener );
    stepLoader.load( 'sounds/footstep.mp3', function( buffer ) {
        footstepSound.setBuffer( buffer );
        footstepSound.setRefDistance( 2 ); 
        footstepSound.setRolloffFactor( 2 );
        footstepSound.setLoop( false );
        footstepSound.setVolume( 1.3 ); // Not too loud
        player.add( footstepSound );
    });

    // --- AUDIO: JUMP ---
    // Start Jump
    const jumpStartLoader = new THREE.AudioLoader();
    jumpStartSound = new THREE.PositionalAudio( listener );
    jumpStartLoader.load( 'sounds/jump-start.mp3', function( buffer ) {
        jumpStartSound.setBuffer( buffer );
        jumpStartSound.setRefDistance( 5 ); 
        jumpStartSound.setRolloffFactor( 1 );
        jumpStartSound.setLoop( false );
        jumpStartSound.setVolume( 1.5 ); 
        player.add( jumpStartSound );
    });

    // Land Jump
    const jumpEndLoader = new THREE.AudioLoader();
    jumpEndSound = new THREE.PositionalAudio( listener );
    jumpEndLoader.load( 'sounds/jump-end.mp3', function( buffer ) {
        jumpEndSound.setBuffer( buffer );
        jumpEndSound.setRefDistance( 5 );
        jumpEndSound.setRolloffFactor( 1 );
        jumpEndSound.setLoop( false );
        jumpEndSound.setVolume( 1.5 ); 
        player.add( jumpEndSound );
    });

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
    
    // --- FISHERMAN AUDIO LOGIC ---
    if (player && fishermanSound && fishermanSound.buffer) { // Ensure player & sound loaded
        const dist = player.position.distanceTo(fishermanPos);
        
        if (!fishermanPlayed && dist < fishermanTriggerDist) {
            // Player entered zone -> Play Sound
            if (!fishermanSound.isPlaying) {
                fishermanSound.play();
            }
            fishermanPlayed = true; 
        } else if (fishermanPlayed && dist > fishermanResetDist) {
            // Player left zone -> Reset Trigger
            fishermanPlayed = false;
        }
    }

    // --- OXEN AUDIO LOGIC ---
    if (player && oxenSound && oxenSound.buffer) { 
        const dist = player.position.distanceTo(oxenPos);
        
        if (!oxenPlayed && dist < oxenTriggerDist) {
            // Player entered zone -> Play Sound
            if (!oxenSound.isPlaying) {
                oxenSound.play();
            }
            oxenPlayed = true; 
        } else if (oxenPlayed && dist > oxenResetDist) {
            // Player left zone -> Reset Trigger
            oxenPlayed = false;
        }
    }

    // --- COW AUDIO LOGIC ---
    // Cow 1
    if (player && cow1Sound && cow1Sound.buffer) { 
        const dist = player.position.distanceTo(cow1Pos);
        if (!cow1Played && dist < cowTriggerDist) {
            if (!cow1Sound.isPlaying) cow1Sound.play();
            cow1Played = true; 
        } else if (cow1Played && dist > cowResetDist) {
            cow1Played = false;
        }
    }
    // Cow 2
    if (player && cow2Sound && cow2Sound.buffer) { 
        const dist = player.position.distanceTo(cow2Pos);
        if (!cow2Played && dist < cowTriggerDist) {
            if (!cow2Sound.isPlaying) cow2Sound.play();
            cow2Played = true; 
        } else if (cow2Played && dist > cowResetDist) {
            cow2Played = false;
        }
    }
    // Cow 3
    if (player && cow3Sound && cow3Sound.buffer) { 
        const dist = player.position.distanceTo(cow3Pos);
        if (!cow3Played && dist < cowTriggerDist) {
            if (!cow3Sound.isPlaying) cow3Sound.play();
            cow3Played = true; 
        } else if (cow3Played && dist > cowResetDist) {
            cow3Played = false;
        }
    }

    // --- SHEEP AUDIO LOGIC ---
    if (player && sheepData.length > 0) {
        sheepData.forEach(sheep => {
            if (sheep.sound && sheep.sound.buffer) {
                const dist = player.position.distanceTo(sheep.pos);
                if (!sheep.played && dist < sheep.triggerDist) {
                    // Randomize pitch slightly for variety? Optional but nice.
                    if (!sheep.sound.isPlaying) {
                        // random playback rate 0.9 to 1.1 = different baa pitch
                        sheep.sound.setPlaybackRate(0.9 + Math.random() * 0.2);
                        sheep.sound.play();
                    }
                    sheep.played = true;
                } else if (sheep.played && dist > sheep.resetDist) {
                    sheep.played = false;
                }
            }
        });
    }

    // --- DEER AUDIO LOGIC ---
    if (player && deerData && deerData.sound && deerData.sound.buffer) {
        // Deer is inside a scaled group, so we need World Position
        const deerWorldPos = new THREE.Vector3();
        deerData.mesh.getWorldPosition(deerWorldPos);

        const dist = player.position.distanceTo(deerWorldPos);
        const deerTriggerDist = 12.0; 
        const deerResetDist = 30.0;

        if (!deerData.played && dist < deerTriggerDist) {
             if (!deerData.sound.isPlaying) {
                 deerData.sound.play();
             }
             deerData.played = true;
        } else if (deerData.played && dist > deerResetDist) {
             deerData.played = false;
        }
    }

    // --- FOOTSTEP LOGIC ---
    // Check if moving on ground
    if (player && footstepSound && footstepSound.buffer && isGrounded) {
       const isMoving = keys.w || keys.a || keys.s || keys.d;
       if (isMoving) {
           const isRunning = keys.shift;
           const now = performance.now();
           // Walk: 500ms, Run: 300ms
           const stepInterval = isRunning ? 300 : 500; 
           
           if (now - lastStepTime > stepInterval) {
               if (footstepSound.isPlaying) footstepSound.stop();
               // Slight pitch variation (0.9 - 1.1) to avoid robotic repetition
               footstepSound.setPlaybackRate(0.9 + Math.random() * 0.2);
               footstepSound.play();
               lastStepTime = now;
           }
       }
    }

    // Update Cinematic Shader Time (for film grain)
    if (cinematicPass) {
        cinematicPass.uniforms['time'].value = performance.now() * 0.001;
    }
    
    // Update River Sound Position (Follow Player along River Axis)
    if (riverSound && player) {
        // Clamp Z to the river's extent
        const halfLength = riverParams.length / 2;
        const minZ = riverParams.waterZ - halfLength;
        const maxZ = riverParams.waterZ + halfLength;
        
        // Find closest point on river centerline to player
        let targetZ = player.position.z;
        targetZ = Math.max(minZ, Math.min(maxZ, targetZ));
        
        riverSound.position.set(riverParams.waterX, riverParams.waterHeight, targetZ);
    }

    // Update Stars Twinkle
    if (stars && stars.visible) {
        stars.material.uniforms.time.value = performance.now() * 0.001;
    }
    
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
        
        // FIX: Raycast from lower height (0.6 - knee/waist) instead of head (2.0)
        // This ensures the sensor is UNDER any roof/beam the player is standing under, preventing it from snapping up to the roof.
        const rayStartHeight = 0.6; 
        raycaster.set(new THREE.Vector3(player.position.x, player.position.y + rayStartHeight, player.position.z), downVector);
        
        let intersects = raycaster.intersectObject(terrain, true);
        if (intersects.length > 0) {
            oldGroundHeight = intersects[0].point.y;
        }

        // 2. Control Application
        if (controls.isLocked || (gameActive && isMobile)) {
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
           const isMoving = keys.w || keys.a || keys.s || keys.d || Math.abs(joystickVector.x) > 0.1 || Math.abs(joystickVector.y) > 0.1;
           const isRunning = keys.shift && isMoving; // Mobile sprint not implemented yet (maybe double tap?)
           
           // Determine Input Rotation Offset (WASD + Joystick)
           // W = 0, A = 90, S = 180, D = -90
           let inputAngle = 0;
           if (isMoving) {
               // Calculate input vector
               // Keyboard: W=1, S=-1. Joystick: Up (neg y)=1, Down (pos y)=-1
               let z = Number(keys.w) - Number(keys.s);
               z -= joystickVector.y; 

               // Keyboard: A=1, D=-1. Joystick: Left (neg x)=1, Right (pos x)=-1
               let x = Number(keys.a) - Number(keys.d);
               x -= joystickVector.x;

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
               verticalVelocity = 10.0; // Jump force
               isGrounded = false;

                // Play Jump Sound
                if (jumpStartSound && jumpStartSound.buffer && !jumpStartSound.isPlaying) {
                    jumpStartSound.play();
                }

                // Schedule Land Sound (Approximate time for flat ground jump)
                setTimeout(() => {
                    if (jumpEndSound && jumpEndSound.buffer) {
                        if (jumpEndSound.isPlaying) jumpEndSound.stop();
                        jumpEndSound.play();
                    }
                }, 700); 
               
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
                
                // --- RIVER PHYSICS: Flow Speed Modification ---
                if (water) {
                    const halfWidth = riverParams.width / 2;
                    const halfLength = riverParams.length / 2;
                    const pRelX = player.position.x - riverParams.waterX;
                    const pRelZ = player.position.z - riverParams.waterZ;
                    
                    // Check if player is within the river bounds
                    if (Math.abs(pRelX) < halfWidth && Math.abs(pRelZ) < halfLength) {
                        // Check Vertical: Are feet below water level? (+0.5 buffer for splashing)
                        if (player.position.y < riverParams.waterHeight + 0.5) {
                            
                            // Calculate Flow Direction Vector
                            const rad = THREE.MathUtils.degToRad(riverParams.flowAngle);
                            const flowDir = new THREE.Vector3(Math.sin(rad), 0, Math.cos(rad));
                            
                            // Dot Product: 1.0 = With Flow, -1.0 = Against Flow
                            const alignment = worldMoveDir.dot(flowDir);
                            
                            // Apply Speed Modifier
                            // With Flow = Faster (+50%)
                            // Against Flow = Slower (-50%)
                            const flowEffect = 0.5;
                            moveSpeed *= (1.0 + (alignment * flowEffect));
                        }
                    }
                }
                
                // Wall Collision Check (Frontal)
                // Check HEAD and KNEE to avoid walking into low beams or high ledges
                let blocked = false;
                
                // 1. Knee Check
                const wallRayOriginKnee = player.position.clone();
                wallRayOriginKnee.y += 0.5; 
                raycaster.set(wallRayOriginKnee, worldMoveDir);
                const kneeIntersects = raycaster.intersectObject(terrain, true);
                if (kneeIntersects.length > 0 && kneeIntersects[0].distance < 0.8) {
                    blocked = true;
                }

                // 2. Neck Check
                if (!blocked) {
                    const wallRayOriginNeck = player.position.clone();
                    wallRayOriginNeck.y += 1; // Neck/Shoulder height
                    raycaster.set(wallRayOriginNeck, worldMoveDir);
                    const neckIntersects = raycaster.intersectObject(terrain, true);
                    if (neckIntersects.length > 0 && neckIntersects[0].distance < 0.8) {
                        blocked = true;
                    }
                }

                // 3. Head Check
                if (!blocked) {
                    const wallRayOriginHead = player.position.clone();
                    wallRayOriginHead.y += 1.7; // Head height
                    raycaster.set(wallRayOriginHead, worldMoveDir);
                    const headIntersects = raycaster.intersectObject(terrain, true);
                    if (headIntersects.length > 0 && headIntersects[0].distance < 0.8) {
                        blocked = true;
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
        // FIX: Raycast from Knee Height (0.6) so we stay UNDER roofs
        const rayOrigin = player.position.clone();
        rayOrigin.y += 0.6; 
        
        raycaster.set(rayOrigin, downVector);
        
        // Check intersection with terrain
        intersects = raycaster.intersectObject(terrain, true);

        // CEILING CHECK: Prevent clipping through floors from below
        // Cast a ray UPWARD from feet to detect if there's a floor above us that we shouldn't pass through
        const upVector = new THREE.Vector3(0, 1, 0);
        const ceilingRayOrigin = player.position.clone();
        ceilingRayOrigin.y += 0.2; // Start just above feet
        raycaster.set(ceilingRayOrigin, upVector);
        const ceilingIntersects = raycaster.intersectObject(terrain, true);
        
        if (ceilingIntersects.length > 0 && ceilingIntersects[0].distance < 1.8) {
            // There's a ceiling/floor very close above our head
            // Push player down to stay below it
            const ceilingHeight = ceilingIntersects[0].point.y;
            const maxPlayerY = ceilingHeight - 1.9; // Keep head 1.9 units below ceiling
            if (player.position.y > maxPlayerY) {
                player.position.y = maxPlayerY;
                // Also stop upward velocity if we hit our head
                if (verticalVelocity > 0) {
                    verticalVelocity = 0;
                }
            }
        }

        // Reset raycaster for ground check
        raycaster.set(rayOrigin, downVector);
        
        if (intersects.length > 0) {
            const newGroundHeight = intersects[0].point.y;
            lastGroundHeight = newGroundHeight;
            const heightDiff = newGroundHeight - oldGroundHeight;

            // "Don't Climb Props" Logic:
            // Check delta from OLD ground height. 
            // If the ground under our feet spiked up > step height, it is a wall (Collision).
            const maxStepHeight = 0.6; // Increased from 0.3 to allow stepping over small bumps
            
            // FIX: Allow climbing if:
            // 1. Player is jumping (has upward velocity)
            // 2. Player is already above the obstacle (clearing it)
            // 3. Player is in the air (not grounded)
            const isJumping = verticalVelocity > 0;
            const isClearingObstacle = player.position.y > newGroundHeight;
            const isInAir = !isGrounded;

            // X/Z Revert Logic - Only block if it's a real wall and we're not jumping over it
            if (heightDiff > maxStepHeight && !isClearingObstacle && !isJumping && !isInAir) {
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
        sunColor: 0xffffee,
        waterColor: 0x002233,
        distortionScale: 6.0,
        fog: scene.fog !== undefined,
        alpha: 0.85
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
        sunColor: 0xffffee,
        waterColor: 0x002233,
        distortionScale: 6.0,
        fog: scene.fog !== undefined,
        alpha: 0.85
    });
    waterfall2.rotation.y = Math.PI; // Face the other way
    scene.add(waterfall2);

    // --- AUDIO: WATERFALL ---
    // Load once, attach to both ends
    const wfLoader = new THREE.AudioLoader();
    wfLoader.load( 'sounds/waterfall.mp3', function( buffer ) {
        
        // Waterfall 1 Sound
        const wfSound1 = new THREE.PositionalAudio( listener );
        wfSound1.setBuffer( buffer );
        wfSound1.setRefDistance( 5 ); // Reduced ref distance to make falloff sharper
        wfSound1.setRolloffFactor( 5 ); // High rolloff so sound dies quickly away from source
        wfSound1.setLoop( true );
        if (buffer.duration > 1.0) {
            wfSound1.setLoopStart(0.5);
            wfSound1.setLoopEnd(buffer.duration - 0.5); 
        }
        wfSound1.setVolume( 1.5 );
        wfSound1.play();
        waterfall.add( wfSound1 ); // Attached to mesh

        // Waterfall 2 Sound
        const wfSound2 = new THREE.PositionalAudio( listener );
        wfSound2.setBuffer( buffer );
        wfSound2.setRefDistance( 5 );
        wfSound2.setRolloffFactor( 5 );
        wfSound2.setLoop( true );
        if (buffer.duration > 1.0) {
            wfSound2.setLoopStart(0.5);
            wfSound2.setLoopEnd(buffer.duration - 0.5); 
        }
        wfSound2.setVolume( 1.5 );
        wfSound2.play();
        waterfall2.add( wfSound2 ); // Attached to mesh
    });

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
