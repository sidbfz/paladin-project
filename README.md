# Medieval Realm - 3D Audio Visual Experience

A cinematic 3D environment built with **Three.js**. This project features an immersive medieval scene with dynamic time-of-day lighting, spatial audio soundscapes, and a third-person character controller.

## Features

- **Immersive 3D World**: Detailed environment with a castle, bridge, ocean, and terrain.
- **Third-Person Controller**: Character movement and camera controls.
- **Dynamic Time of Day**: Real-time lighting presets (Sunrise, Noon, Sunset, Night) that affect fog, sun position, and ambient light.
- **Spatial 3D Audio**:
  - Distance-based sound attenuation.
  - Directional audio listeners attached to the character.
  - Dynamic Biome Audio (Ocean waves near water, Wind/Birds on land).
  - Footstep SFX synchronized with movement.
- **Cinematic Visuals**: Custom shaders for vignetting, color grading, and bloom.

## Controls

- **W / A / S / D**: Move Character
- **Space**: Jump
- **Shift**: Sprint

## Tech Stack

- **Three.js**: 3D Rendering Engine
- **Vite**: Build Tool
- **Lil-Gui**: Debug/Control UI

## Setup & Run

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Run Development Server**:
   ```bash
   npm run dev
   ```

3. **Build for Production**:
   ```bash
   npm run build
   ```
