/**
 * World scale. 1 world unit (u) is displayed as 100 m.
 *
 * The ship is ~0.27 u long (~27 m) and a person ~0.018 u (~1.8 m), so a 1,000 u
 * rocky planet is a ~100 km radius world: big enough to feel like a place when you
 * are standing on it, small enough to fly around.
 */
export const KM_PER_UNIT = 0.1;

// Uniform scale applied to the ship model (it was modelled ~2.7 u long)
export const SHIP_SCALE = 0.1;

// On foot
export const PLAYER_EYE_HEIGHT = 0.016;
export const PLAYER_WALK_SPEED = 0.03;
export const PLAYER_RUN_SPEED = 0.08;
export const PLAYER_JUMP_SPEED = 0.05;
export const SURFACE_GRAVITY = 0.098; // u/s² on a 1,000 u planet (9.8 m/s²); scales with radius

// Finest terrain vertex spacing near the camera (u). Sets the quadtree depth.
export const TERRAIN_MIN_SPACING = 0.04;
