# Third-party notices

The browser-side physics implementation in `app/physics.ts` adapts motion,
cue–ball impact, squirt, ball–ball collision, and friction equations from
[pooltool](https://github.com/ekiefl/pooltool), version 0.6.0.

- Copyright: Evan Kiefl and pooltool contributors
- License: [Apache License 2.0](https://github.com/ekiefl/pooltool/blob/main/LICENSE.txt)
- Modifications: TypeScript/Web Worker port, fixed-step browser evolution,
  simplified cushion and pocket geometry, reference-trajectory calibration,
  and quaternion output for WebGL rendering.

The 3D renderer uses [Three.js](https://github.com/mrdoob/three.js), distributed
under the MIT License.
