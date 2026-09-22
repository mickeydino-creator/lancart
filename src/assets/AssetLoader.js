import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";

const loader = new GLTFLoader();
const cache = new Map();

/**
 * Loads a glTF/GLB once and caches the parsed result (promise-cached, so
 * concurrent callers share one network/parse). Every consumer gets its own
 * clone via `cloneScene()` - never mutate the cached original.
 */
export function loadModel(url) {
  if (!cache.has(url)) {
    cache.set(
      url,
      new Promise((resolve, reject) => {
        loader.load(url, resolve, undefined, reject);
      })
    );
  }
  return cache.get(url);
}

/**
 * Clones a loaded glTF scene for independent use. Uses SkeletonUtils so
 * skinned meshes (e.g. the kart's rigged wheel bones) get their own
 * skeleton instead of sharing bones with other instances - required for
 * multiple independently-posed copies (future multiplayer karts).
 */
export function cloneScene(gltf) {
  return cloneSkeleton(gltf.scene);
}

/** Kick off loading every asset the game needs, without blocking navigation. */
export function preloadAssets() {
  return Promise.all([
    loadModel("/models/kart.glb"),
    loadModel("/models/pine_tree.glb"),
    loadModel("/models/coconut_tree.glb"),
    loadModel("/models/terrain.glb"),
  ]);
}
